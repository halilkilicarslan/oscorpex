// @oscorpex/provider-codex — OpenAI Codex CLI adapter (native)
// Spawns the `codex` CLI binary directly.

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
// Adapter
// ---------------------------------------------------------------------------

export class CodexAdapter implements ProviderAdapter {
	readonly id = "codex";
	private binary = "codex";

	capabilities(): ProviderCapabilities {
		return {
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: false,
			supportsStructuredOutput: false,
			supportsSandboxHinting: false,
			supportedModels: ["gpt-4o", "o3-mini"],
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

		const available = await this.isAvailable();
		if (!available) {
			throw new ProviderUnavailableError(this.id, `Codex CLI binary "${this.binary}" not found`);
		}

		// Codex cannot honor restricted tool policies
		if (input.allowedTools && !hasFullToolAccess(input.allowedTools)) {
			throw new ProviderExecutionError(
				this.id,
				input.taskId,
				null,
				"Codex adapter cannot honor restricted tool policies; fallback required",
			);
		}

		const governanceSection = buildToolGovernanceSection(input.allowedTools);
		const prompt = governanceSection ? `${governanceSection}\n\n${input.prompt}` : input.prompt;
		const model = input.model ?? "gpt-4o";
		const timeoutMs = input.timeoutMs ?? 120_000;

		const args = ["--quiet", "--full-auto"];
		if (model) args.push("--model", model);
		args.push(prompt);

		const runResult = await runCLI({
			binary: this.binary,
			args,
			cwd: input.repoPath,
			timeoutMs,
			signal: input.signal,
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
				`Codex CLI killed: ${classified.message}`,
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
		const costUsd = calculateCost(model, usage.inputTokens, usage.outputTokens);

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
		// Codex does not support granular cancel
		void input;
	}
}
