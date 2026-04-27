// @oscorpex/kernel — Provider registry + execution adapter
// Manages provider adapters and dispatches execution via the execution engine.

import type { ProviderExecutionInput, ProviderExecutionResult, ProviderAdapter } from "@oscorpex/core";
import { createLogger } from "../logger.js";
import { ClaudeCodeAdapter, CodexAdapter, CursorAdapter } from "../adapters/index.js";

const log = createLogger("provider-registry");

// ---------------------------------------------------------------------------
// Provider factory — native adapter construction (no legacy dependency)
// ---------------------------------------------------------------------------

export interface ProviderFactoryConfig {
	id: string;
	defaultModel?: string;
}

export function createProviderAdapter(config: ProviderFactoryConfig): ProviderAdapter {
	switch (config.id) {
		case "claude-code":
			return new ClaudeCodeAdapter();
		case "codex":
			return new CodexAdapter();
		case "cursor":
			return new CursorAdapter();
		default:
			throw new Error(`Unknown provider: ${config.id}`);
	}
}

export class ProviderRegistry {
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
			const result = await adapter.execute({ ...input, signal: controller.signal });
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

		// Also propagate cancel to the adapter for any provider-side cleanup
		for (const [, adapter] of this.adapters) {
			try {
				await adapter.cancel({ runId, taskId });
			} catch {
				// ignore adapter-level cancel failures
			}
		}
	}

	/**
	 * Native provider registration — does NOT depend on legacy cli-adapter.ts.
	 * Registers providers using the factory layer. This is the sole
	 * initialization path for all deployments.
	 */
	registerDefaultProviders(): void {
		const configs: ProviderFactoryConfig[] = [
			{ id: "claude-code", defaultModel: "sonnet" },
			{ id: "codex", defaultModel: "gpt-4o" },
			{ id: "cursor", defaultModel: "cursor-large" },
		];

		for (const config of configs) {
			try {
				const adapter = createProviderAdapter(config);
				this.register(config.id, adapter);
				log.info(`[provider-registry] Native registration: ${config.id}`);
			} catch (err) {
				log.warn(`[provider-registry] Could not native-register ${config.id}: ${String(err)}`);
			}
		}
	}
}

export const providerRegistry = new ProviderRegistry();