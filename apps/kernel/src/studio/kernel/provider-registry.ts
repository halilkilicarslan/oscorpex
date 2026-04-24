// @oscorpex/kernel — Provider registry + execution adapter
// Manages provider adapters and dispatches execution via the execution engine.

import type { ProviderExecutionInput, ProviderExecutionResult, ProviderAdapter, ProviderCapabilities } from "@oscorpex/core";
import { createLogger } from "../logger.js";
const log = createLogger("provider-registry");

class ProviderRegistry {
	private adapters = new Map<string, ProviderAdapter>();
	/** Active abort controllers keyed by runId:taskId */
	private activeControllers = new Map<string, AbortController>();

	private controllerKey(runId: string, taskId: string): string {
		return `${runId}:${taskId}`;
	}

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

		// Create an abort controller for this execution so cancel() can terminate it
		const controller = new AbortController();
		const key = this.controllerKey(input.runId, input.taskId);
		this.activeControllers.set(key, controller);

		try {
			const result = await adapter.execute(input);
			return result;
		} finally {
			this.activeControllers.delete(key);
		}
	}

	async cancel(runId: string, taskId: string): Promise<void> {
		const key = this.controllerKey(runId, taskId);
		const controller = this.activeControllers.get(key);
		if (controller) {
			controller.abort();
			this.activeControllers.delete(key);
			log.info(`[provider-registry] Cancelled execution ${key}`);
		} else {
			log.warn(`[provider-registry] No active execution to cancel for ${key}`);
		}
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
				const wrapper = this.buildLegacyWrapper(name, legacy);
				this.register(name, wrapper);
			} catch (err) {
				log.warn(`[provider-registry] Could not register ${name}: ${String(err)}`);
			}
		}
	}

	private buildLegacyWrapper(name: string, legacy: any): ProviderAdapter {
		const capabilitiesByProvider: Record<string, ProviderCapabilities> = {
			"claude-code": {
				supportsToolRestriction: true,
				supportsStreaming: true,
				supportsResume: true,
				supportsStructuredOutput: true,
				supportsSandboxHinting: true,
				supportedModels: ["sonnet", "opus", "haiku"],
			},
			codex: {
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsStructuredOutput: false,
				supportsSandboxHinting: false,
				supportedModels: ["gpt-4o", "o3-mini"],
			},
			cursor: {
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsStructuredOutput: false,
				supportsSandboxHinting: false,
				supportedModels: ["cursor-small", "cursor-large"],
			},
		};

		return {
			id: name,
			capabilities: () => capabilitiesByProvider[name] ?? capabilitiesByProvider["claude-code"],
			isAvailable: async () => legacy.isAvailable(),
			execute: async (input) => {
				const controller = this.activeControllers.get(this.controllerKey(input.runId, input.taskId));
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
					signal: controller?.signal,
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
			cancel: async (input) => this.cancel(input.runId, input.taskId),
			health: async () => ({ healthy: true }),
		};
	}
}

export const providerRegistry = new ProviderRegistry();