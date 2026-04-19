import { spawn } from "node:child_process";
import { streamWithCLI } from "./cli-runtime.js";

export type PlannerCLIProvider = "claude-code" | "codex" | "gemini";
export type PlannerReasoningEffort = "low" | "medium" | "high" | "max" | "xhigh";

export interface PlannerCLIProviderInfo {
	id: PlannerCLIProvider;
	label: string;
	binary: string;
	available: boolean;
	version?: string;
	models: string[];
	defaultModel: string;
	efforts: PlannerReasoningEffort[];
	defaultEffort?: PlannerReasoningEffort;
}

const CLI_PROVIDER_DEFS: Record<
	PlannerCLIProvider,
	{
		label: string;
		binary: string;
		versionArgs: string[];
		models: string[];
		defaultModel: string;
		efforts: PlannerReasoningEffort[];
		defaultEffort?: PlannerReasoningEffort;
	}
> = {
	"claude-code": {
		label: "Claude CLI",
		binary: "claude",
		versionArgs: ["--version"],
		models: ["haiku", "sonnet", "opus"],
		defaultModel: "sonnet",
		efforts: ["low", "medium", "high", "max"],
		defaultEffort: "high",
	},
	codex: {
		label: "Codex CLI",
		binary: "codex",
		versionArgs: ["--version"],
		models: ["gpt-5.4", "o4-mini", "o3", "gpt-4o", "gpt-4.1"],
		defaultModel: "gpt-5.4",
		efforts: ["low", "medium", "high", "xhigh"],
		defaultEffort: "xhigh",
	},
	gemini: {
		label: "Gemini CLI",
		binary: "gemini",
		versionArgs: ["--version"],
		models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
		defaultModel: "gemini-2.5-flash",
		efforts: [],
	},
};

export interface PlannerStreamCallbacks {
	onTextDelta: (text: string) => void;
	onDone: (fullText: string) => void;
	onError: (error: Error) => void;
}

function summarizeCLIError(
	provider: string,
	model: string,
	effort: string | null | undefined,
	stderr: string,
	stdout: string,
	exitCode: number | null,
): Error {
	const merged = `${stderr}\n${stdout}`
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const lastMeaningful = merged
		.filter((line) => !line.startsWith("(node:") && !line.startsWith("OpenAI Codex") && !line.startsWith("Usage:"))
		.slice(-6);
	const detail = lastMeaningful.join(" | ");
	const suffix = detail ? ` — ${detail}` : "";
	return new Error(
		`${provider} CLI exited with code ${exitCode ?? 1} [model=${model}${effort ? ` effort=${effort}` : ""}]${suffix}`,
	);
}

function probeBinary(binary: string, args: string[]): Promise<{ available: boolean; version?: string }> {
	return new Promise((resolve) => {
		let settled = false;
		let stdout = "";
		let stderr = "";

		const done = (result: { available: boolean; version?: string }) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		const proc = spawn(binary, args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			env: { ...process.env, PATH: process.env.PATH },
		});

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf-8");
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf-8");
		});

		proc.on("close", (code) => {
			if (code === 0) {
				const version = stdout.trim() || stderr.trim() || undefined;
				done({ available: true, version });
				return;
			}
			done({ available: false });
		});

		proc.on("error", () => {
			done({ available: false });
		});

		setTimeout(() => {
			try {
				proc.kill();
			} catch {
				// ignore
			}
			done({ available: false });
		}, 5_000);
	});
}

export async function listPlannerCLIProviders(): Promise<PlannerCLIProviderInfo[]> {
	const entries = await Promise.all(
		(Object.entries(CLI_PROVIDER_DEFS) as [PlannerCLIProvider, (typeof CLI_PROVIDER_DEFS)[PlannerCLIProvider]][]).map(
			async ([id, def]) => {
				const probe = await probeBinary(def.binary, def.versionArgs);
				return {
					id,
					label: def.label,
					binary: def.binary,
					available: probe.available,
					version: probe.version,
					models: def.models,
					defaultModel: def.defaultModel,
					efforts: def.efforts,
					defaultEffort: def.defaultEffort,
				} satisfies PlannerCLIProviderInfo;
			},
		),
	);

	return entries;
}

export async function isAnyPlannerCLIAvailable(): Promise<boolean> {
	const providers = await listPlannerCLIProviders();
	return providers.some((provider) => provider.available);
}

function streamWithCodex(
	opts: {
		repoPath: string;
		prompt: string;
		systemPrompt: string;
		model?: string;
		effort?: PlannerReasoningEffort;
		timeoutMs?: number;
	},
	callbacks: PlannerStreamCallbacks,
): () => void {
	const { repoPath, prompt, systemPrompt, model = "o4-mini", effort = "xhigh", timeoutMs = 120_000 } = opts;
	const fullPrompt = `${systemPrompt}\n\n${prompt}`;

	const proc = spawn(
		"codex",
		[
			"exec",
			"-c",
			`model_reasoning_effort="${effort}"`,
			"--model",
			model,
			"--skip-git-repo-check",
			"--sandbox",
			"read-only",
			"-C",
			repoPath,
			"-",
		],
		{
			cwd: repoPath,
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			env: { ...process.env, PATH: process.env.PATH },
		},
	);

	proc.stdin?.write(fullPrompt);
	proc.stdin?.end();

	let buffer = "";
	let fullText = "";
	let stderrText = "";
	let settled = false;

	const finish = (fn: () => void) => {
		if (settled) return;
		settled = true;
		fn();
	};

	const timer = setTimeout(() => {
		try {
			proc.kill();
		} catch {
			// ignore
		}
		finish(() => callbacks.onError(new Error(`Planner CLI timed out after ${timeoutMs}ms`)));
	}, timeoutMs);

	proc.stdout?.on("data", (chunk: Buffer) => {
		const text = chunk.toString("utf-8");
		buffer += text;
		fullText += text;
		callbacks.onTextDelta(text);
	});

	proc.stderr?.on("data", (chunk: Buffer) => {
		stderrText += chunk.toString("utf-8");
	});

	proc.on("close", (code) => {
		clearTimeout(timer);
		if (code === 0) {
			finish(() => callbacks.onDone(fullText.trim() || buffer.trim()));
			return;
		}
		finish(() => callbacks.onError(summarizeCLIError("Codex", model, effort, stderrText, fullText, code)));
	});

	proc.on("error", (err) => {
		clearTimeout(timer);
		finish(() => callbacks.onError(err));
	});

	return () => {
		try {
			proc.kill();
		} catch {
			// ignore
		}
	};
}

function streamWithGemini(
	opts: {
		repoPath: string;
		prompt: string;
		systemPrompt: string;
		model?: string;
		effort?: PlannerReasoningEffort;
		timeoutMs?: number;
	},
	callbacks: PlannerStreamCallbacks,
): () => void {
	const { repoPath, prompt, systemPrompt, model = "gemini-2.5-flash", effort, timeoutMs = 120_000 } = opts;
	const fullPrompt = `${systemPrompt}\n\n${prompt}`;

	const proc = spawn("gemini", ["-p", fullPrompt, "-m", model, "--approval-mode", "plan", "-o", "text"], {
		cwd: repoPath,
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
		env: { ...process.env, PATH: process.env.PATH },
	});

	let fullText = "";
	let stderrText = "";
	let settled = false;

	const finish = (fn: () => void) => {
		if (settled) return;
		settled = true;
		fn();
	};

	const timer = setTimeout(() => {
		try {
			proc.kill();
		} catch {
			// ignore
		}
		finish(() => callbacks.onError(new Error(`Planner CLI timed out after ${timeoutMs}ms`)));
	}, timeoutMs);

	proc.stdout?.on("data", (chunk: Buffer) => {
		const text = chunk.toString("utf-8");
		fullText += text;
		callbacks.onTextDelta(text);
	});

	proc.stderr?.on("data", (chunk: Buffer) => {
		stderrText += chunk.toString("utf-8");
	});

	proc.on("close", (code) => {
		clearTimeout(timer);
		if (code === 0) {
			finish(() => callbacks.onDone(fullText.trim()));
			return;
		}
		finish(() => callbacks.onError(summarizeCLIError("Gemini", model, effort, stderrText, fullText, code)));
	});

	proc.on("error", (err) => {
		clearTimeout(timer);
		finish(() => callbacks.onError(err));
	});

	return () => {
		try {
			proc.kill();
		} catch {
			// ignore
		}
	};
}

export function streamPlannerWithCLI(
	opts: {
		repoPath: string;
		prompt: string;
		systemPrompt: string;
		provider: PlannerCLIProvider;
		model?: string;
		effort?: PlannerReasoningEffort;
		timeoutMs?: number;
	},
	callbacks: PlannerStreamCallbacks,
): () => void {
	switch (opts.provider) {
		case "codex":
			return streamWithCodex(opts, callbacks);
		case "gemini":
			return streamWithGemini(opts, callbacks);
		case "claude-code":
		default:
			return streamWithCLI(
				{
					repoPath: opts.repoPath,
					prompt: opts.prompt,
					systemPrompt: opts.systemPrompt,
					model: opts.model ?? "sonnet",
					timeoutMs: opts.timeoutMs,
				},
				callbacks,
			);
	}
}
