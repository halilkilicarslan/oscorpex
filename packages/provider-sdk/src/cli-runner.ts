// @oscorpex/provider-sdk — Shared CLI runner for provider adapters
// Wraps child_process.spawn with timeout, signal, stdout/stderr capture,
// exit-code classification, and JSON parsing fallback.

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CLIRunOptions {
	binary: string;
	args: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	signal?: AbortSignal;
	stdin?: string;
	onStdoutChunk?: (chunk: string) => void;
	onStderrChunk?: (chunk: string) => void;
}

export interface CLIRunResult {
	exitCode: number | null;
	signal: string | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	killedByTimeout: boolean;
	killedBySignal: boolean;
}

export type ExitClassification =
	| "success"
	| "cli_error"
	| "timeout"
	| "killed"
	| "spawn_failure"
	| "unknown";

export interface ClassifiedExit {
	classification: ExitClassification;
	message: string;
	retryable: boolean;
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export function runCLI(opts: CLIRunOptions): Promise<CLIRunResult> {
	return new Promise((resolve, reject) => {
		const startTime = Date.now();
		const proc = spawn(opts.binary, opts.args, {
			cwd: opts.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: opts.env ?? process.env,
		});

		let stdout = "";
		let stderr = "";
		let timer: ReturnType<typeof setTimeout> | null = null;
		let killedByTimeout = false;
		let killedBySignal = false;

		const cleanup = () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		};

		// Timeout handler
		if (opts.timeoutMs && opts.timeoutMs > 0) {
			timer = setTimeout(() => {
				killedByTimeout = true;
				proc.kill("SIGKILL");
			}, opts.timeoutMs);
		}

		// AbortSignal handler
		if (opts.signal) {
			opts.signal.addEventListener(
				"abort",
				() => {
					killedBySignal = true;
					proc.kill("SIGTERM");
				},
				{ once: true },
			);
		}

		proc.stdout?.on("data", (d) => {
			const chunk = d.toString();
			stdout += chunk;
			opts.onStdoutChunk?.(chunk);
		});
		proc.stderr?.on("data", (d) => {
			const chunk = d.toString();
			stderr += chunk;
			opts.onStderrChunk?.(chunk);
		});

		// Send stdin if provided
		if (opts.stdin) {
			proc.stdin?.write(opts.stdin);
			proc.stdin?.end();
		} else {
			proc.stdin?.end();
		}

		proc.on("close", (code, sig) => {
			cleanup();
			resolve({
				exitCode: code,
				signal: sig ?? null,
				stdout,
				stderr,
				durationMs: Date.now() - startTime,
				killedByTimeout,
				killedBySignal,
			});
		});

		proc.on("error", (err) => {
			cleanup();
			reject(err);
		});
	});
}

// ---------------------------------------------------------------------------
// Exit code classification
// ---------------------------------------------------------------------------

export function classifyExit(result: CLIRunResult): ClassifiedExit {
	if (result.killedByTimeout) {
		return {
			classification: "timeout",
			message: `CLI timed out after ${result.durationMs}ms`,
			retryable: true,
		};
	}
	if (result.killedBySignal) {
		return {
			classification: "killed",
			message: `CLI killed by signal (${result.signal ?? "unknown"})`,
			retryable: true,
		};
	}
	if (result.exitCode === 0) {
		return {
			classification: "success",
			message: "CLI exited successfully",
			retryable: false,
		};
	}
	if (result.exitCode === null) {
		return {
			classification: "spawn_failure",
			message: `CLI spawn failed: ${result.stderr.slice(0, 200)}`,
			retryable: true,
		};
	}
	// Known provider exit codes
	if (result.exitCode === 1) {
		return {
			classification: "cli_error",
			message: `CLI exited with code 1: ${result.stderr.slice(0, 500)}`,
			retryable: true,
		};
	}
	if (result.exitCode === 2) {
		return {
			classification: "cli_error",
			message: `CLI exited with code 2 (misuse): ${result.stderr.slice(0, 500)}`,
			retryable: false,
		};
	}
	if (result.exitCode === 127 || result.exitCode === 126) {
		return {
			classification: "spawn_failure",
			message: `CLI not found or not executable (exit ${result.exitCode})`,
			retryable: false,
		};
	}
	return {
		classification: "unknown",
		message: `CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
		retryable: true,
	};
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

export interface ParsedOutput<T = unknown> {
	ok: boolean;
	data?: T;
	raw: string;
	error?: string;
}

export function tryParseJson<T = unknown>(stdout: string): ParsedOutput<T> {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return { ok: false, raw: trimmed, error: "Empty stdout" };
	}
	try {
		const data = JSON.parse(trimmed) as T;
		return { ok: true, data, raw: trimmed };
	} catch {
		// Try to extract JSON from the last line (some CLIs mix logs + JSON)
		const lines = trimmed.split("\n").filter((l) => l.trim());
		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				const data = JSON.parse(lines[i]!) as T;
				return { ok: true, data, raw: trimmed };
			} catch {
				// continue
			}
		}
		return { ok: false, raw: trimmed, error: "Invalid JSON in stdout" };
	}
}

/**
 * Extract token usage from various provider JSON shapes.
 */
export interface ExtractedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
}

export function extractUsage(obj: unknown): ExtractedUsage {
	if (!obj || typeof obj !== "object") {
		return { inputTokens: 0, outputTokens: 0 };
	}
	const record = obj as Record<string, unknown>;

	// OpenAI / Codex shape
	const usage = record.usage as Record<string, unknown> | undefined;
	if (usage) {
		return {
			inputTokens: (usage.prompt_tokens as number) ?? (usage.input_tokens as number) ?? 0,
			outputTokens: (usage.completion_tokens as number) ?? (usage.output_tokens as number) ?? 0,
			cacheCreationTokens: (usage.cache_creation_input_tokens as number) ?? 0,
			cacheReadTokens: (usage.cache_read_input_tokens as number) ?? 0,
		};
	}

	// Anthropic / Claude shape (flat on record)
	return {
		inputTokens: (record.input_tokens as number) ?? (record.inputTokens as number) ?? 0,
		outputTokens: (record.output_tokens as number) ?? (record.outputTokens as number) ?? 0,
		cacheCreationTokens: (record.cache_creation_input_tokens as number) ?? (record.cacheCreationTokens as number) ?? 0,
		cacheReadTokens: (record.cache_read_input_tokens as number) ?? (record.cacheReadTokens as number) ?? 0,
	};
}

/**
 * Extract text output from various provider JSON shapes.
 */
export function extractText(obj: unknown): string {
	if (!obj || typeof obj !== "object") return "";
	const record = obj as Record<string, unknown>;
	return (
		(record.output as string) ??
		(record.result as string) ??
		(record.text as string) ??
		(record.content as string) ??
		""
	);
}

// ---------------------------------------------------------------------------
// Health / availability detection
// ---------------------------------------------------------------------------

export interface BinaryCheckResult {
	available: boolean;
	version?: string;
	error?: string;
}

export function checkBinary(binary: string, versionArgs: string[] = ["--version"]): BinaryCheckResult {
	try {
		const output = execFileSync(binary, versionArgs, {
			timeout: 5_000,
			stdio: ["pipe", "pipe", "pipe"],
			encoding: "utf-8",
		});
		return { available: true, version: output.trim() };
	} catch (err) {
		return {
			available: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function checkBinaryAsync(
	binary: string,
	versionArgs: string[] = ["--version"],
): Promise<BinaryCheckResult> {
	try {
		const { execFile } = await import("node:child_process");
		return new Promise((resolve) => {
			execFile(binary, versionArgs, { timeout: 5_000, encoding: "utf-8" }, (err, stdout) => {
				if (err) {
					resolve({ available: false, error: err.message });
				} else {
					resolve({ available: true, version: stdout.trim() });
				}
			});
		});
	} catch (err) {
		return {
			available: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
