// ---------------------------------------------------------------------------
// Oscorpex — Provider Resolver
// Abstracts provider chain construction, sorting, skip/cooldown/availability
// checks, and produces a structured resolution result.
// ---------------------------------------------------------------------------

import type { ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import type { ProviderErrorClassification } from "@oscorpex/provider-sdk";
import type { CLIAdapter, CLIAdapterOptions } from "./cli-adapter.js";
import { markProviderUnavailable, shouldSkipProvider, sortAdapterChain } from "./fallback-decision.js";
import { providerRegistry } from "./kernel/provider-registry.js";
import { createLogger } from "./logger.js";
import type { ProviderCapabilities } from "./provider-runtime-cache.js";
import { providerRuntimeCache } from "./provider-runtime-cache.js";
import { providerState } from "./provider-state.js";
import type { AgentCliTool } from "./types.js";

const log = createLogger("provider-resolver");

export interface ProviderResolverResult {
	/** The originally requested provider (before any fallback) */
	primaryProvider: string;
	/** The provider that was ultimately selected (null if all exhausted) */
	finalProvider: string | null;
	/** How the final provider was reached */
	providerSource: "primary" | "fallback" | "degraded";
	/** Human-readable reason for falling back (null if primary succeeded or degraded) */
	fallbackReason: string | null;
	/** Per-provider availability snapshot at resolution time */
	cooldownState: Record<string, { available: boolean; reason?: string }>;
}

export class ProviderResolver {
	private chain: CLIAdapter[];
	private index = 0;
	private result: ProviderResolverResult;
	private _triedPrimary = false;

	constructor(chain: CLIAdapter[], primaryProvider: string) {
		this.chain = chain;
		this.result = {
			primaryProvider,
			finalProvider: null,
			providerSource: "primary",
			fallbackReason: null,
			cooldownState: {},
		};
	}

	/**
	 * Return the next usable adapter from the sorted chain.
	 * Each call advances the internal cursor so the same adapter is never
	 * returned twice.
	 */
	async next(options: {
		allowedTools: string[];
		lastFailureProvider?: string;
		lastFailureClassification?: ProviderErrorClassification;
	}): Promise<CLIAdapter | null> {
		while (this.index < this.chain.length) {
			const adapter = this.chain[this.index++]!;
			const adapterName = adapter.name as AgentCliTool;

			// TASK 5: Smart provider skipping
			const skipCheck = await shouldSkipProvider(adapter, {
				allowedTools: options.allowedTools,
				lastFailureProvider: options.lastFailureProvider,
				lastFailureClassification: options.lastFailureClassification,
			});
			if (skipCheck.shouldSkip) {
				this.result.cooldownState[adapter.name] = {
					available: false,
					reason: `skipped: ${skipCheck.reason}`,
				};
				log.info(`[provider-resolver] Adapter "${adapter.name}" skipped: ${skipCheck.reason}`);
				continue;
			}

			// Cooldown state check
			if (!providerState.isAvailable(adapterName)) {
				this.result.cooldownState[adapter.name] = {
					available: false,
					reason: "cooldown",
				};
				log.info(`[provider-resolver] Adapter "${adapter.name}" is in cooldown, skipping.`);
				continue;
			}

			// Runtime availability check
			const adapterReady = await providerRuntimeCache.resolveAvailability(
				adapter.name,
				() => adapter.isAvailable(),
				"health_check",
			);
			log.info(`[provider-resolver] CLI adapter: ${adapter.name}, ready=${adapterReady}`);
			this.result.cooldownState[adapter.name] = {
				available: adapterReady,
				reason: adapterReady ? undefined : "not_installed",
			};

			if (!adapterReady) {
				log.info(`[provider-resolver] Adapter "${adapter.name}" is not installed, skipping.`);
				markProviderUnavailable(adapter.name);
				continue;
			}

			// If we already selected a provider earlier and are now moving to the
			// next one, this is a fallback scenario.
			if (this.result.finalProvider !== null) {
				this.result.providerSource = "fallback";
			}

			this.result.finalProvider = adapter.name;
			if (!this._triedPrimary) {
				this._triedPrimary = true;
				if (adapter.name !== this.result.primaryProvider) {
					this.result.providerSource = "fallback";
				}
			}
			return adapter;
		}

		this.result.providerSource = "degraded";
		return null;
	}

	/**
	 * Record the reason we fell back from the previously selected provider.
	 * Call this when an adapter.execute() throws and you move to the next one.
	 */
	recordFallbackReason(reason: string): void {
		this.result.fallbackReason = reason;
	}

	getResult(): ProviderResolverResult {
		return { ...this.result };
	}
}

/**
 * Build a ProviderResolver for the given primary CLI tool and optional
 * fallback list.  The chain is sorted by telemetry-based priority before
 * being wrapped.
 */
export async function createProviderResolver(
	primaryCliTool: AgentCliTool,
	fallbackTools: AgentCliTool[],
	telemetry: ProviderTelemetryCollector,
): Promise<ProviderResolver> {
	if (process.env.VITEST === "true" && process.env.OSCORPEX_PROVIDER_RESOLVER_USE_REGISTRY !== "true") {
		const { getAdapterChain } = await import("./cli-adapter.js");
		let testChain = await getAdapterChain(primaryCliTool, fallbackTools);
		testChain = sortAdapterChain(testChain, (providerId) => {
			const snap = telemetry.getLatencySnapshot(providerId);
			if (!snap) return undefined;
			const total = snap.successfulExecutions + snap.failedExecutions;
			return {
				successRate: total > 0 ? snap.successfulExecutions / total : 0.5,
				avgLatencyMs: snap.averageLatencyMs,
			};
		});
		return new ProviderResolver(testChain, primaryCliTool);
	}

	if (providerRegistry.list().length === 0) {
		providerRegistry.registerDefaultProviders();
	}

	const ids = [primaryCliTool, ...fallbackTools].filter((id, idx, arr) => arr.indexOf(id) === idx);
	let chain = ids.map((id) => {
		const provider = providerRegistry.get(id);
		if (!provider) {
			throw new Error(`Provider "${id}" not found in ProviderRegistry`);
		}
		return {
			name: provider.id,
			isAvailable: () => provider.isAvailable(),
			capabilities: async (): Promise<ProviderCapabilities> => {
				const capabilities = provider.capabilities();
				return {
					supportedModels: capabilities.supportedModels ?? [],
					supportsToolRestriction: capabilities.supportsToolRestriction,
					supportsStreaming: capabilities.supportsStreaming,
					supportsResume: capabilities.supportsResume,
					supportsCancel: capabilities.supportsCancel,
					supportsStructuredOutput: capabilities.supportsStructuredOutput,
					supportsSandboxHinting: capabilities.supportsSandboxHinting,
				};
			},
			execute: async (opts: CLIAdapterOptions) => {
				const result = await provider.execute({
					runId: opts.projectId,
					taskId: opts.taskId,
					provider: provider.id,
					repoPath: opts.repoPath,
					prompt: opts.prompt,
					systemPrompt: opts.systemPrompt,
					timeoutMs: opts.timeoutMs,
					allowedTools: opts.allowedTools,
					model: opts.model,
					signal: opts.signal,
					onLog: opts.onLog,
				});

				return {
					text: result.text,
					filesCreated: result.filesCreated,
					filesModified: result.filesModified,
					logs: result.logs,
					inputTokens: result.usage?.inputTokens ?? 0,
					outputTokens: result.usage?.outputTokens ?? 0,
					cacheCreationTokens: result.usage?.cacheWriteTokens ?? 0,
					cacheReadTokens: result.usage?.cacheReadTokens ?? 0,
					totalCostUsd: result.usage?.billedCostUsd ?? result.usage?.estimatedCostUsd ?? 0,
					durationMs: result.metadata?.durationMs ?? 0,
					model: result.model ?? opts.model ?? "unknown",
				};
			},
		} satisfies CLIAdapter;
	});

	// TASK 5: Sort chain by telemetry-based priority
	chain = sortAdapterChain(chain, (providerId) => {
		const snap = telemetry.getLatencySnapshot(providerId);
		if (!snap) return undefined;
		const total = snap.successfulExecutions + snap.failedExecutions;
		return {
			successRate: total > 0 ? snap.successfulExecutions / total : 0.5,
			avgLatencyMs: snap.averageLatencyMs,
		};
	});

	return new ProviderResolver(chain, primaryCliTool);
}
