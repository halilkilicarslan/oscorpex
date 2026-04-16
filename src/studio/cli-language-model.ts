// ---------------------------------------------------------------------------
// Oscorpex — CLI LanguageModel Adapter
// Wraps local CLI tools (claude, codex, gemini) as a LanguageModelV3 so they
// can be used via AI SDK generateText/streamText without API keys.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3Content,
	LanguageModelV3GenerateResult,
	LanguageModelV3Prompt,
	LanguageModelV3StreamPart,
	LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { CliTool } from "./types.js";

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function resolveBinary(tool: CliTool): string {
	const envKey = `${tool.toUpperCase()}_CLI_PATH`;
	const fromEnv = process.env[envKey];
	if (fromEnv) return fromEnv;

	const commonPaths: Record<CliTool, string[]> = {
		claude: ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"],
		codex: ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/usr/bin/codex"],
		gemini: ["/opt/homebrew/bin/gemini", "/usr/local/bin/gemini", "/usr/bin/gemini"],
		cursor: ["/usr/local/bin/cursor", "/opt/homebrew/bin/cursor"],
	};

	for (const p of commonPaths[tool] ?? []) {
		if (existsSync(p)) return p;
	}
	return tool;
}

// ---------------------------------------------------------------------------
// Prompt flattening — convert LanguageModelV3Prompt to plain text
// ---------------------------------------------------------------------------

function flattenPrompt(prompt: LanguageModelV3Prompt): { system: string; user: string } {
	let system = "";
	const userParts: string[] = [];

	for (const msg of prompt) {
		if (msg.role === "system") {
			system += (system ? "\n\n" : "") + msg.content;
			continue;
		}

		const roleLabel =
			msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";

		const textChunks: string[] = [];
		if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "text") {
					textChunks.push(part.text);
				} else if (part.type === "tool-call") {
					textChunks.push(`[tool-call: ${part.toolName}(${JSON.stringify(part.input)})]`);
				} else if (part.type === "tool-result") {
					const output = "output" in part ? JSON.stringify(part.output) : "";
					textChunks.push(`[tool-result: ${part.toolName} → ${output}]`);
				}
			}
		} else if (typeof msg.content === "string") {
			textChunks.push(msg.content);
		}

		if (textChunks.length > 0) {
			userParts.push(`${roleLabel}: ${textChunks.join("\n")}`);
		}
	}

	return { system, user: userParts.join("\n\n") };
}

// ---------------------------------------------------------------------------
// CLI invocation — tool-specific command construction
// ---------------------------------------------------------------------------

interface CliInvocation {
	bin: string;
	args: string[];
	parseOutput: (stdout: string) => { text: string; inputTokens?: number; outputTokens?: number };
}

function buildInvocation(tool: CliTool, model: string, system: string): CliInvocation {
	const bin = resolveBinary(tool);

	switch (tool) {
		case "claude": {
			// claude -p --output-format json --model <model> --system-prompt <system>
			// prompt body goes on stdin
			const args = [
				"-p",
				"--output-format",
				"json",
				"--model",
				model || "sonnet",
				"--permission-mode",
				"bypassPermissions",
				"--disable-slash-commands",
				"--no-session-persistence",
			];
			if (system) args.push("--system-prompt", system);
			return {
				bin,
				args,
				parseOutput: (stdout) => {
					try {
						const obj = JSON.parse(stdout);
						const text = typeof obj.result === "string"
							? obj.result
							: typeof obj.text === "string"
								? obj.text
								: stdout;
						const usage = obj.usage ?? {};
						return {
							text,
							inputTokens: usage.input_tokens,
							outputTokens: usage.output_tokens,
						};
					} catch {
						return { text: stdout.trim() };
					}
				},
			};
		}
		case "cursor": {
			// cursor agent -p --output-format json --model <model> --trust
			// prompt body goes on stdin
			const args = [
				"agent",
				"-p",
				"--output-format",
				"json",
				"--trust",
				"--force",
			];
			if (model) args.push("--model", model);
			return {
				bin,
				args,
				parseOutput: (stdout) => {
					try {
						const obj = JSON.parse(stdout);
						const text = typeof obj.result === "string"
							? obj.result
							: typeof obj.text === "string"
								? obj.text
								: stdout;
						const usage = obj.usage ?? {};
						return {
							text,
							inputTokens: usage.input_tokens,
							outputTokens: usage.output_tokens,
						};
					} catch {
						return { text: stdout.trim() };
					}
				},
			};
		}
		case "codex": {
			// codex exec <prompt> --output-schema text — not yet stable; use print mode with stdin
			// We assume `codex -` or `codex chat -` style; keep it minimal.
			const args = ["exec", "-"];
			if (model) args.push("--model", model);
			return {
				bin,
				args,
				parseOutput: (stdout) => ({ text: stdout.trim() }),
			};
		}
		case "gemini": {
			// gemini CLI: `gemini -p <prompt>` (or read from stdin via `gemini -`)
			const args = ["-"];
			if (model) args.push("--model", model);
			return {
				bin,
				args,
				parseOutput: (stdout) => ({ text: stdout.trim() }),
			};
		}
		default:
			throw new Error(`Unsupported CLI tool: ${tool}`);
	}
}

// ---------------------------------------------------------------------------
// Spawn + collect output
// ---------------------------------------------------------------------------

interface CliResult {
	text: string;
	inputTokens: number;
	outputTokens: number;
}

async function runCli(
	tool: CliTool,
	model: string,
	system: string,
	userPrompt: string,
	abortSignal?: AbortSignal,
	timeoutMs = 120_000,
): Promise<CliResult> {
	const { bin, args, parseOutput } = buildInvocation(tool, model, system);

	return new Promise((resolvePromise, rejectPromise) => {
		const proc = spawn(bin, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (err: Error | null, result?: CliResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (err) rejectPromise(err);
			else if (result) resolvePromise(result);
		};

		const timer = setTimeout(() => {
			proc.kill("SIGKILL");
			finish(new Error(`CLI ${tool} timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		let abortHandler: (() => void) | undefined;
		if (abortSignal) {
			abortHandler = () => {
				proc.kill("SIGTERM");
				finish(new Error("aborted"));
			};
			abortSignal.addEventListener("abort", abortHandler, { once: true });
		}

		const MAX_OUTPUT = 80_000;
		proc.stdout?.on("data", (d) => {
			if (stdout.length < MAX_OUTPUT) stdout += d.toString();
		});
		proc.stderr?.on("data", (d) => {
			if (stderr.length < MAX_OUTPUT) stderr += d.toString();
		});

		proc.on("error", (err) => {
			finish(new Error(`CLI ${tool} spawn failed: ${err.message}`));
		});

		proc.on("close", (code) => {
			clearTimeout(timer);
			if (abortSignal && abortHandler) abortSignal.removeEventListener("abort", abortHandler);
			if (code !== 0) {
				finish(
					new Error(
						`CLI ${tool} exited with code ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`,
					),
				);
				return;
			}
			try {
				const parsed = parseOutput(stdout);
				finish(null, {
					text: parsed.text,
					inputTokens: parsed.inputTokens ?? 0,
					outputTokens: parsed.outputTokens ?? 0,
				});
			} catch (e) {
				finish(e instanceof Error ? e : new Error(String(e)));
			}
		});

		// Send user prompt via stdin
		proc.stdin?.write(userPrompt);
		proc.stdin?.end();
	});
}

// ---------------------------------------------------------------------------
// LanguageModelV3 implementation
// ---------------------------------------------------------------------------

export class CliLanguageModel implements LanguageModelV3 {
	readonly specificationVersion = "v3" as const;
	readonly provider: string;
	readonly modelId: string;
	readonly supportedUrls = {};

	private readonly cliTool: CliTool;

	constructor(cliTool: CliTool, modelId: string) {
		this.cliTool = cliTool;
		this.modelId = modelId;
		this.provider = `cli-${cliTool}`;
	}

	async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
		const { system, user } = flattenPrompt(options.prompt);
		const result = await runCli(this.cliTool, this.modelId, system, user, options.abortSignal);

		const content: LanguageModelV3Content[] = [{ type: "text", text: result.text }];

		return {
			content,
			finishReason: { unified: "stop", raw: "stop" },
			usage: {
				inputTokens: {
					total: result.inputTokens,
					noCache: result.inputTokens,
					cacheRead: undefined,
					cacheWrite: undefined,
				},
				outputTokens: {
					total: result.outputTokens,
					text: result.outputTokens,
					reasoning: undefined,
				},
			},
			warnings: [],
		};
	}

	async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
		// Fallback: run non-streaming, emit as a single text chunk
		const result = await this.doGenerate(options);
		const text = result.content.find((c) => c.type === "text");
		const modelId = this.modelId;
		const responseId = `cli-${Date.now()}`;
		const timestamp = new Date();

		const stream = new ReadableStream<LanguageModelV3StreamPart>({
			start(controller) {
				controller.enqueue({ type: "stream-start", warnings: [] });
				controller.enqueue({
					type: "response-metadata",
					id: responseId,
					timestamp,
					modelId,
				});
				if (text && text.type === "text") {
					const id = `txt-${Date.now()}`;
					controller.enqueue({ type: "text-start", id });
					controller.enqueue({ type: "text-delta", id, delta: text.text });
					controller.enqueue({ type: "text-end", id });
				}
				controller.enqueue({
					type: "finish",
					finishReason: result.finishReason,
					usage: result.usage,
				});
				controller.close();
			},
		});

		return { stream };
	}
}

// ---------------------------------------------------------------------------
// Default model id per CLI tool
// ---------------------------------------------------------------------------

export function defaultModelForCliTool(tool: CliTool): string {
	switch (tool) {
		case "claude":
			return "sonnet";
		case "codex":
			return "gpt-5-codex";
		case "gemini":
			return "gemini-2.0-flash";
		case "cursor":
			return "sonnet-4";
		default:
			return "sonnet";
	}
}
