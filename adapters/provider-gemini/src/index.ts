// @oscorpex/provider-gemini — Google Gemini CLI adapter
// Spawns the `gemini` CLI binary with JSON parsing.
// Expects a CLI wrapper that accepts prompts via stdin and emits JSON to stdout.
// Configure the binary path via GEMINI_CLI_PATH env var.

import type {
	ProviderAdapter,
	ProviderCapabilities,
	ProviderExecutionInput,
	ProviderExecutionResult,
	ProviderHealth,
} from "@oscorpex/core";
import {
	runCLI,
	classifyExit,
	tryParseJson,
	extractUsage,
	extractText,
	checkBinaryAsync,
	buildToolGovernanceSection,
	hasFullToolAccess,
	calculateCost,
} from "@oscorpex/provider-sdk";
import { ProviderUnavailableError, ProviderExecutionError, ProviderTimeoutError } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function resolveBinary(): string {
	return process.env.GEMINI_CLI_PATH ?? "gemini";
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GeminiAdapter implements ProviderAdapter {
	readonly id = "gemini";
	private binary = resolveBinary();

	capabilities(): ProviderCapabilities {
		return {
			supportsToolRestriction: false,
			supportsStreaming: true,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: false,
			supportedModels: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
		};
	}

	async isAvailable(): Promise<boolean> {
		const result = await checkBinaryAsync(this.binary, ["--version"]);
		return result.available;
	}

	async health(): Promise<ProviderHealth> {
		const result = await checkBinaryAsync(this.binary, ["--version"]);
		return {
			healthy: result.available,
			message: result.available ? result.version : result.error,
		};
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const startedAt = new Date().toISOString();

		// Availability pre-check
		const available = await this.isAvailable();
		if (!available) {
			throw new ProviderUnavailableError(this.id, `Gemini CLI binary "${this.binary}" not found`);
		}

		// Tool governance — Gemini does not support tool restriction at the adapter level.
		// If restricted tools are requested, inject a governance preamble.
		const restricted = input.allowedTools && !hasFullToolAccess(input.allowedTools);
		const governanceSection = restricted ? buildToolGovernanceSection(input.allowedTools) : "";
		const fullPrompt = governanceSection ? `${governanceSection}\n\n${input.prompt}` : input.prompt;

		// Build CLI args
		const model = input.model ?? "gemini-1.5-flash";
		const timeoutMs = input.timeoutMs ?? 300_000;
		const args = [
			"--model",
			model,
			"--max-tokens",
			"8192",
			"--temperature",
			"0.2",
		];

		// Spawn
		const runResult = await runCLI({
			binary: this.binary,
			args,
			cwd: input.repoPath,
			timeoutMs,
			signal: input.signal,
			stdin: fullPrompt,
		});

		// Classify exit
		const classified = classifyExit(runResult);
		const completedAt = new Date().toISOString();

		if (classified.classification === "timeout") {
			throw new ProviderTimeoutError(this.id, input.taskId, runResult.durationMs);
		}
		if (classified.classification === "killed") {
			throw new ProviderExecutionError(
				this.id,
				input.taskId,
				runResult.exitCode,
				`Gemini CLI killed: ${classified.message}`,
			);
		}
		if (classified.classification !== "success") {
			throw new ProviderExecutionError(
				this.id,
				input.taskId,
				runResult.exitCode,
				classified.message,
			);
		}

		// Parse output — try JSON first, fall back to raw text
		const parsed = tryParseJson(runResult.stdout);
		const usage = parsed.ok ? extractUsage(parsed.data) : { inputTokens: 0, outputTokens: 0 };
		const text = parsed.ok ? extractText(parsed.data) : runResult.stdout.trim();

		// Build file lists from JSON if present
		let filesCreated: string[] = [];
		let filesModified: string[] = [];
		if (parsed.ok && parsed.data && typeof parsed.data === "object") {
			const record = parsed.data as Record<string, unknown>;
			filesCreated = (record.files_created as string[]) ?? (record.filesCreated as string[]) ?? [];
			filesModified = (record.files_modified as string[]) ?? (record.filesModified as string[]) ?? [];
		}

		// Cost normalization
		const costUsd = calculateCost(model, usage.inputTokens, usage.outputTokens);

		return {
			provider: this.id,
			model,
			text,
			filesCreated,
			filesModified,
			logs: runResult.stderr ? [runResult.stderr] : [],
			usage: {
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				cacheReadTokens: usage.cacheReadTokens,
				cacheWriteTokens: usage.cacheCreationTokens,
				billedCostUsd: costUsd,
			},
			startedAt,
			completedAt,
			metadata: {
				durationMs: runResult.durationMs,
				exitCode: runResult.exitCode,
			},
		};
	}

	async cancel(input: { runId: string; taskId: string }): Promise<void> {
		// Registry-level cancel handles AbortController.signal;
		// adapter-level cancel is a no-op for now.
		void input;
	}
}
