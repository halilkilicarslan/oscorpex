// @oscorpex/kernel — Cursor adapter
// Bridges the legacy cli-adapter.ts for Cursor with the ProviderAdapter contract.

import type { ProviderAdapter, ProviderCapabilities, ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";
import { createLogger } from "../logger.js";

const log = createLogger("provider-cursor");

export class CursorAdapter implements ProviderAdapter {
	readonly id = "cursor";

	private legacy: any;

	constructor(legacyAdapter: any) {
		this.legacy = legacyAdapter;
	}

	capabilities(): ProviderCapabilities {
		return {
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsStructuredOutput: false,
			supportsSandboxHinting: false,
			supportedModels: ["cursor-small", "cursor-large"],
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
				model: input.model ?? "cursor-large",
				allowedTools: input.allowedTools ?? [],
				signal: input.signal,
			});

			const completedAt = new Date().toISOString();
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
			};
		} catch (err) {
			log.warn({ err }, `[${this.id}] Execution failed`);
			throw err;
		}
	}

	async cancel(): Promise<void> {
		log.info(`[${this.id}] Cancel requested`);
	}

	async health(): Promise<{ healthy: boolean }> {
		try {
			return { healthy: await this.isAvailable() };
		} catch {
			return { healthy: false };
		}
	}
}