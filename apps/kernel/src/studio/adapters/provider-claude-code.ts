// @oscorpex/kernel — Claude Code adapter
// Bridges the legacy cli-adapter.ts for Claude Code with the ProviderAdapter contract.

import type { ProviderAdapter, ProviderCapabilities, ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";
import { createLogger } from "../logger.js";

const log = createLogger("provider-claude-code");

export class ClaudeCodeAdapter implements ProviderAdapter {
	readonly id = "claude-code";

	private legacy: any;

	constructor(legacyAdapter?: any) {
		this.legacy = legacyAdapter;
	}

	capabilities(): ProviderCapabilities {
		return {
			supportsToolRestriction: true,
			supportsStreaming: true,
			supportsResume: true,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: true,
			supportedModels: ["sonnet", "opus", "haiku"],
		};
	}

	async isAvailable(): Promise<boolean> {
		return this.legacy.isAvailable();
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const startedAt = new Date().toISOString();
		try {
			const result = await this.legacy.execute({
				projectId: input.runId,
				agentId: "",
				agentName: "",
				repoPath: input.repoPath,
				prompt: input.prompt,
				systemPrompt: input.systemPrompt ?? "",
				timeoutMs: input.timeoutMs,
				model: input.model ?? "sonnet",
				allowedTools: input.allowedTools ?? [],
				signal: input.signal,
			});

			const completedAt = new Date().toISOString();
			const startedMs = new Date(startedAt).getTime();
			const completedMs = new Date(completedAt).getTime();
			return {
				provider: this.id,
				model: input.model,
				text: result.logs?.join("\n") ?? "",
				filesCreated: result.filesCreated ?? [],
				filesModified: result.filesModified ?? [],
				logs: result.logs ?? [],
				usage: {
					inputTokens: result.inputTokens ?? 0,
					outputTokens: result.outputTokens ?? 0,
					billedCostUsd: result.totalCostUsd ?? 0,
				},
				startedAt,
				completedAt,
				metadata: {
					durationMs: completedMs - startedMs,
				},
			};
		} catch (err) {
			log.warn({ err }, `[${this.id}] Execution failed`);
			throw err;
		}
	}

	async cancel(): Promise<void> {
		log.info(`[${this.id}] Cancel requested — propagating to legacy adapter`);
		// Legacy adapter does not support granular cancel; signal-based abort is handled by the registry
	}

	async health(): Promise<{ healthy: boolean }> {
		try {
			return { healthy: await this.isAvailable() };
		} catch {
			return { healthy: false };
		}
	}
}