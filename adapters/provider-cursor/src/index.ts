// @oscorpex/provider-cursor — Cursor Agent CLI adapter (native)
// Spawns the `cursor` CLI binary directly.

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
} from "@oscorpex/provider-sdk";
import { ProviderUnavailableError, ProviderExecutionError, ProviderTimeoutError } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CursorAdapter implements ProviderAdapter {
	readonly id = "cursor";
	private binary = "cursor";

	capabilities(): ProviderCapabilities {
		return {
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: false,
			supportsStructuredOutput: false,
			supportsSandboxHinting: false,
			supportedModels: ["cursor-large"],
		};
	}

	async isAvailable(): Promise<boolean> {
		const result = await checkBinaryAsync(this.binary, ["agent", "--version"]);
		return result.available;
	}

	async health(): Promise<ProviderHealth> {
		const result = await checkBinaryAsync(this.binary, ["agent", "--version"]);
		return {
			healthy: result.available,
			message: result.available ? result.version : result.error,
		};
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const startedAt = new Date().toISOString();

		const available = await this.isAvailable();
		if (!available) {
			throw new ProviderUnavailableError(this.id, `Cursor CLI binary "${this.binary}" not found`);
		}

		// Cursor cannot honor restricted tool policies
		if (input.allowedTools && !hasFullToolAccess(input.allowedTools)) {
			throw new ProviderExecutionError(
				this.id,
				input.taskId,
				null,
				"Cursor adapter cannot honor restricted tool policies; fallback required",
			);
		}

		const governanceSection = buildToolGovernanceSection(input.allowedTools);
		const model = input.model ?? "cursor-large";
		const timeoutMs = input.timeoutMs ?? 120_000;

		const args = ["agent", "-p", "--output-format", "json", "--trust", "--force"];
		if (model) args.push("--model", model);

		const fullPrompt = [input.systemPrompt, governanceSection, input.prompt].filter(Boolean).join("\n\n");

		const runResult = await runCLI({
			binary: this.binary,
			args,
			cwd: input.repoPath,
			timeoutMs,
			signal: input.signal,
			stdin: fullPrompt,
		});

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
				`Cursor CLI killed: ${classified.message}`,
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

		const parsed = tryParseJson(runResult.stdout);
		const usage = parsed.ok ? extractUsage(parsed.data) : { inputTokens: 0, outputTokens: 0 };
		const text = parsed.ok ? extractText(parsed.data) : runResult.stdout.trim();

		// Cursor does not expose cost via CLI
		return {
			provider: this.id,
			model,
			text,
			filesCreated: [],
			filesModified: [],
			logs: runResult.stderr ? [runResult.stderr] : [],
			usage: {
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				billedCostUsd: 0,
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
		// Cursor does not support granular cancel
		void input;
	}
}
