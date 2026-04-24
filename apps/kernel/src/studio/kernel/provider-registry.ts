// @oscorpex/kernel — Provider registry + execution adapter
// Manages provider adapters and dispatches execution via the execution engine.

import type { ProviderExecutionInput, ProviderExecutionResult, ProviderAdapter } from "@oscorpex/core";
import { createLogger } from "../logger.js";
const log = createLogger("provider-registry");

class ProviderRegistry {
	private adapters = new Map<string, ProviderAdapter>();

	register(id: string, adapter: ProviderAdapter): void {
		this.adapters.set(id, adapter);
		log.info(`[provider-registry] Registered adapter: ${id}`);
	}

	get(id: string): ProviderAdapter | undefined {
		return this.adapters.get(id);
	}

	list(): Array<{ id: string; adapter: ProviderAdapter }> {
		return Array.from(this.adapters.entries()).map(([id, adapter]) => ({ id, adapter }));
	}

	async execute(providerId: string, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const adapter = this.adapters.get(providerId);
		if (!adapter) {
			throw new Error(`Provider "${providerId}" not found in registry`);
		}

		const result = await adapter.execute(input);
		return result;
	}

	/**
	 * Boot-time initialization: register known CLI adapters.
	 * This bridges legacy cli-adapter.ts with the new provider registry.
	 */
	async initializeFromLegacy(): Promise<void> {
		const { getAdapter } = await import("../cli-adapter.js");
		for (const name of ["claude-code", "codex", "cursor"]) {
			try {
				const legacy = getAdapter(name as any);
				const wrapper: ProviderAdapter = {
					id: name,
					capabilities: () => ({
						supportsToolRestriction: true,
						supportsStreaming: false,
						supportsResume: false,
						supportsStructuredOutput: false,
						supportsSandboxHinting: false,
						supportedModels: ["sonnet", "gpt-4o", "cursor-small"],
					}),
					isAvailable: async () => legacy.isAvailable(),
					execute: async (input) => {
						const result = await legacy.execute({
							projectId: input.runId,
							agentId: "",
							agentName: "",
							repoPath: input.repoPath,
							prompt: input.prompt,
							systemPrompt: input.systemPrompt ?? "",
							timeoutMs: input.timeoutMs,
							model: input.model ?? "sonnet",
							allowedTools: input.allowedTools ?? [],
						});
						return {
							provider: name,
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
							startedAt: new Date().toISOString(),
							completedAt: new Date().toISOString(),
						};
					},
					cancel: async () => { /* TODO */ },
					health: async () => ({ healthy: true }),
				};
				this.register(name, wrapper);
			} catch (err) {
				log.warn(`[provider-registry] Could not register ${name}: ${String(err)}`);
			}
		}
	}
}

export const providerRegistry = new ProviderRegistry();