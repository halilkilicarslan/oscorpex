// @oscorpex/provider-cursor — Cursor adapter

import type { ProviderAdapter, ProviderCapabilities, ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";

export class CursorAdapter implements ProviderAdapter {
	readonly id = "cursor";

	private legacy: any;

	constructor(legacyAdapter?: any) {
		this.legacy = legacyAdapter;
	}

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
		return this.legacy?.isAvailable?.() ?? false;
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const startedAt = new Date().toISOString();
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
	}

	async cancel(): Promise<void> {
		// No-op: cursor does not support cancel
	}

	async health(): Promise<{ healthy: boolean }> {
		try {
			return { healthy: await this.isAvailable() };
		} catch {
			return { healthy: false };
		}
	}
}
