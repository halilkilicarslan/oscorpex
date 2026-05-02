// @oscorpex/kernel — Provider registry + execution adapter
// Manages provider adapters and dispatches execution via the execution engine.
// Integrates telemetry for fallback timeline, latency, cancel audit, and failure
// classification (EPIC 3 — Provider Observability).

import type { ProviderAdapter, ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";
import { ProviderTelemetryCollector, classifyProviderError } from "@oscorpex/provider-sdk";
import { ClaudeCodeAdapter, CodexAdapter, CursorAdapter, GeminiAdapter, OllamaAdapter } from "../adapters/index.js";
import { createLogger } from "../logger.js";

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
		case "gemini":
			return new GeminiAdapter();
		case "ollama":
			return new OllamaAdapter();
		default:
			throw new Error(`Unknown provider: ${config.id}`);
	}
}

class VitestProviderAdapter implements ProviderAdapter {
	constructor(
		readonly id: string,
		private readonly supportedModels: string[],
	) {}

	capabilities() {
		return {
			supportedModels: this.supportedModels,
			supportsToolRestriction: true,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: true,
			supportsSandboxHinting: true,
		};
	}

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const startedAt = new Date().toISOString();
		const completedAt = new Date().toISOString();
		return {
			provider: this.id,
			model: input.model,
			text: "done",
			filesCreated: [],
			filesModified: [],
			logs: ["done"],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				estimatedCostUsd: 0,
			},
			startedAt,
			completedAt,
			metadata: { durationMs: 0, vitest: true },
		};
	}

	async cancel(): Promise<void> {}

	async health() {
		return { healthy: true };
	}
}

export class ProviderRegistry {
	private adapters = new Map<string, ProviderAdapter>();
	/** Active abort controllers keyed by runId:taskId */
	private activeControllers = new Map<string, AbortController>();
	/** Observability telemetry collector */
	readonly telemetry = new ProviderTelemetryCollector();

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

		// Start telemetry for this execution
		const telemetryRecord = this.telemetry.startExecution({ ...input, provider: providerId });

		// Create an abort controller for this execution so cancel() can terminate it
		const controller = new AbortController();
		const key = this.controllerKey(input.runId, input.taskId);
		this.activeControllers.set(key, controller);

		try {
			const result = await adapter.execute({ ...input, signal: controller.signal });
			this.telemetry.finishExecution(telemetryRecord, result);
			return result;
		} catch (err) {
			this.telemetry.finishExecution(telemetryRecord, null, err);
			throw err;
		} finally {
			this.activeControllers.delete(key);
		}
	}

	async executeWithFallback(
		primaryId: string,
		fallbackIds: string[],
		input: ProviderExecutionInput,
	): Promise<ProviderExecutionResult> {
		const telemetryRecord = this.telemetry.startExecution({ ...input, provider: primaryId });
		const chain = [primaryId, ...fallbackIds];
		let lastError: unknown = null;

		for (let i = 0; i < chain.length; i++) {
			const providerId = chain[i]!;
			const adapter = this.adapters.get(providerId);
			if (!adapter) continue;

			const startMs = Date.now();
			const controller = new AbortController();
			const key = this.controllerKey(input.runId, input.taskId);
			this.activeControllers.set(key, controller);

			try {
				const result = await adapter.execute({ ...input, signal: controller.signal });
				this.telemetry.finishExecution(telemetryRecord, result);
				return result;
			} catch (err) {
				lastError = err;
				const latencyMs = Date.now() - startMs;
				const classification = classifyProviderError(err);
				log.warn(
					`[provider-registry] Provider "${providerId}" failed (${classification}) after ${latencyMs}ms for ${key}`,
				);
				if (i < chain.length - 1) {
					this.telemetry.recordFallback(
						telemetryRecord,
						providerId,
						chain[i + 1]!,
						String(err instanceof Error ? err.message : err),
						classification,
						latencyMs,
					);
				}
			} finally {
				this.activeControllers.delete(key);
			}
		}

		// All providers exhausted — record degraded mode
		this.telemetry.recordDegraded(telemetryRecord, `All providers exhausted: ${chain.join(" → ")}`);
		this.telemetry.finishExecution(telemetryRecord, null, lastError);
		throw lastError ?? new Error("All providers exhausted — no provider available.");
	}

	async cancel(runId: string, taskId: string): Promise<void> {
		const key = this.controllerKey(runId, taskId);
		const controller = this.activeControllers.get(key);
		const record = this.telemetry.getRecord(runId, taskId);

		if (controller) {
			controller.abort();
			this.activeControllers.delete(key);
			if (record) {
				this.telemetry.recordCancel(record, "User/system-initiated cancel via registry");
			}
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
			{ id: "gemini", defaultModel: "gemini-1.5-flash" },
			{ id: "ollama", defaultModel: "llama3.2" },
		];

		for (const config of configs) {
			try {
				const adapter =
					process.env.VITEST === "true"
						? new VitestProviderAdapter(config.id, config.defaultModel ? [config.defaultModel] : [])
						: createProviderAdapter(config);
				this.register(config.id, adapter);
				log.info(`[provider-registry] Native registration: ${config.id}`);
			} catch (err) {
				log.warn(`[provider-registry] Could not native-register ${config.id}: ${String(err)}`);
			}
		}
	}
}

export const providerRegistry = new ProviderRegistry();
