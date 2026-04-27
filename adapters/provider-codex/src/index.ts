// @oscorpex/provider-codex — Codex adapter

import type { ProviderAdapter, ProviderCapabilities, ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";

export class CodexAdapter implements ProviderAdapter {
	readonly id = "codex";

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
			supportedModels: ["gpt-4o", "o3-mini"],
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
			model: input.model ?? "gpt-4o",
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
		// No-op: codex does not support cancel
	}

	async health(): Promise<{ healthy: boolean }> {
		try {
			return { healthy: await this.isAvailable() };
		} catch {
			return { healthy: false };
		}
	}
}
