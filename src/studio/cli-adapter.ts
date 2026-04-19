// ---------------------------------------------------------------------------
// Oscorpex — Multi-CLI Adapter (Faz 4.1)
// CLITool bazlı adapter pattern: her CLI aracı için ayrı implementasyon.
// ---------------------------------------------------------------------------

import type { CLIExecutionResult } from "./cli-runtime.js";
import { executeWithCLI, isClaudeCliAvailable } from "./cli-runtime.js";
import type { AgentCliTool } from "./types.js";

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface CLIAdapterOptions {
	projectId: string;
	agentId: string;
	agentName: string;
	repoPath: string;
	prompt: string;
	systemPrompt: string;
	timeoutMs: number;
	allowedTools?: string[];
	model?: string;
	signal?: AbortSignal;
}

export interface CLIAdapter {
	readonly name: string;
	isAvailable(): Promise<boolean>;
	execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult>;
}

// ---------------------------------------------------------------------------
// ClaudeAdapter — mevcut executeWithCLI üzerinden çalışır
// ---------------------------------------------------------------------------

export class ClaudeAdapter implements CLIAdapter {
	readonly name = "claude-code";

	async isAvailable(): Promise<boolean> {
		return isClaudeCliAvailable();
	}

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		return executeWithCLI(opts);
	}
}

// ---------------------------------------------------------------------------
// CodexAdapter — OpenAI Codex CLI
// ---------------------------------------------------------------------------

export class CodexAdapter implements CLIAdapter {
	readonly name = "codex";

	async isAvailable(): Promise<boolean> {
		try {
			const { execFileSync } = await import("node:child_process");
			execFileSync("codex", ["--version"], { timeout: 5_000, stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	}

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		const { spawn } = await import("node:child_process");
		const startTime = Date.now();

		const args = ["--quiet", "--full-auto"];
		if (opts.model) args.push("--model", opts.model);
		args.push(opts.prompt);

		return new Promise((resolve, reject) => {
			const proc = spawn("codex", args, {
				cwd: opts.repoPath,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});

			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => {
				proc.kill("SIGKILL");
				reject(new Error("Codex CLI timed out"));
			}, opts.timeoutMs ?? 120_000);

			proc.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			proc.stderr?.on("data", (d) => {
				stderr += d.toString();
			});

			if (opts.signal) {
				opts.signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
			}

			// Send system prompt via stdin if provided
			if (opts.systemPrompt) {
				proc.stdin?.write(opts.systemPrompt + "\n\n");
			}
			proc.stdin?.end();

			proc.on("close", (code) => {
				clearTimeout(timer);
				const durationMs = Date.now() - startTime;
				if (code !== 0) {
					reject(new Error(`Codex exited with code ${code}: ${stderr.slice(0, 500)}`));
					return;
				}
				// Try to parse JSON output, fall back to raw text
				try {
					const obj = JSON.parse(stdout);
					const usage = obj.usage ?? {};
					const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
					const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
					// OpenAI pricing estimate: gpt-4o ~$5/1M input, ~$15/1M output
					const totalCostUsd = (inputTokens * 5 + outputTokens * 15) / 1_000_000;
					resolve({
						text: obj.output ?? obj.result ?? obj.text ?? stdout,
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens,
						outputTokens,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCostUsd,
						durationMs,
						model: obj.model ?? opts.model ?? "codex",
					});
				} catch {
					resolve({
						text: stdout.trim(),
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens: 0,
						outputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCostUsd: 0,
						durationMs,
						model: opts.model ?? "codex",
					});
				}
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}
}

// ---------------------------------------------------------------------------
// CursorAdapter — Cursor Agent CLI
// ---------------------------------------------------------------------------

export class CursorAdapter implements CLIAdapter {
	readonly name = "cursor";

	async isAvailable(): Promise<boolean> {
		try {
			const { execSync } = await import("node:child_process");
			execSync("cursor agent --version", { timeout: 5_000, stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	}

	async execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult> {
		const { spawn } = await import("node:child_process");
		const startTime = Date.now();
		const args = ["agent", "-p", "--output-format", "json", "--trust", "--force"];
		if (opts.model) args.push("--model", opts.model);

		return new Promise((resolve, reject) => {
			const proc = spawn("cursor", args, {
				cwd: opts.repoPath,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});

			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => {
				proc.kill("SIGKILL");
				reject(new Error("Cursor agent timed out"));
			}, opts.timeoutMs ?? 120_000);

			proc.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			proc.stderr?.on("data", (d) => {
				stderr += d.toString();
			});

			if (opts.signal) {
				opts.signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
			}

			const fullPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt;
			proc.stdin?.write(fullPrompt);
			proc.stdin?.end();

			proc.on("close", (code) => {
				clearTimeout(timer);
				const durationMs = Date.now() - startTime;
				if (code !== 0) {
					reject(new Error(`Cursor agent exited with code ${code}: ${stderr.slice(0, 500)}`));
					return;
				}
				try {
					const obj = JSON.parse(stdout);
					const usage = obj.usage ?? {};
					resolve({
						text: obj.result ?? obj.text ?? stdout,
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens: usage.input_tokens ?? 0,
						outputTokens: usage.output_tokens ?? 0,
						cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
						cacheReadTokens: usage.cache_read_input_tokens ?? 0,
						totalCostUsd: 0,
						durationMs,
						model: obj.model ?? opts.model ?? "cursor",
					});
				} catch {
					resolve({
						text: stdout.trim(),
						filesCreated: [],
						filesModified: [],
						logs: [],
						inputTokens: 0,
						outputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCostUsd: 0,
						durationMs,
						model: opts.model ?? "cursor",
					});
				}
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Factory — CLITool tipine göre adapter döndürür
// ---------------------------------------------------------------------------

const adapters: Record<string, CLIAdapter> = {
	"claude-code": new ClaudeAdapter(),
	codex: new CodexAdapter(),
	cursor: new CursorAdapter(),
};

export function getAdapter(cliTool: AgentCliTool): CLIAdapter {
	const adapter = adapters[cliTool];
	if (!adapter) {
		// Bilinmeyen veya 'none' → default olarak Claude kullan
		return adapters["claude-code"];
	}
	return adapter;
}

export function getAdapterChain(primary: AgentCliTool, fallbacks?: AgentCliTool[]): CLIAdapter[] {
	const chain: CLIAdapter[] = [getAdapter(primary)];
	if (fallbacks) {
		for (const fb of fallbacks) {
			const adapter = adapters[fb];
			if (adapter && adapter.name !== primary) {
				chain.push(adapter);
			}
		}
	}
	return chain;
}
