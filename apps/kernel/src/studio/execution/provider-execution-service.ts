// ---------------------------------------------------------------------------
// Oscorpex — ProviderExecutionService
// Encapsulates the provider fallback chain, telemetry lifecycle, cooldown
// marking, and error classification that was previously spread across the
// manual loop in task-executor.ts.
//
// Architecture:
//   ProviderExecutionService.execute()
//     → createProviderResolver()  (skip/cooldown/availability checks)
//     → startProviderTelemetry()  (before first adapter attempt)
//     → adapter.execute() loop    (with fallback + recordProviderFallback)
//     → providerState.mark*()     (success / failure / rate-limited)
//     → finishProviderTelemetry() (on success or final failure)
//     → returns NormalizedProviderResult
// ---------------------------------------------------------------------------

import type { ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import type { AgentCliTool } from "../types.js";
import { createLogger } from "../logger.js";
import { composeSystemPrompt } from "../behavioral-prompt.js";
import { defaultSystemPrompt } from "../prompt-builder.js";
import { createProviderResolver } from "../provider-resolver.js";
import { providerState } from "../provider-state.js";
import {
	type TelemetryRecord,
	CANCEL_REASONS,
	classifyProviderErrorWithReason,
	finishProviderTelemetry,
	recordProviderCancel,
	recordProviderDegraded,
	recordProviderFallback,
	startProviderTelemetry,
} from "../provider-telemetry.js";
import type { ProviderErrorClassification } from "@oscorpex/provider-sdk";

const log = createLogger("provider-execution-service");

const RATE_LIMIT_PATTERNS = [
	/you['']ve hit your limit/i,
	/rate limit/i,
	/resets?\s+\d{1,2}[:.]\d{2}\s*(am|pm)/i,
	/too many requests/i,
	/429/,
	/quota exceeded/i,
];

function isRateLimitError(message: string): boolean {
	return RATE_LIMIT_PATTERNS.some((rx) => rx.test(message));
}

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/**
 * All data needed to dispatch one task to a provider.
 * Constructed by task-executor.ts before calling execute().
 */
export interface ExecuteTaskWithProviderInput {
	/** Project UUID — used as runId in telemetry */
	projectId: string;
	taskId: string;
	agentId: string;
	agentName: string;
	repoPath: string;
	prompt: string;
	/** Raw agent system prompt; if present it will be composed via composeSystemPrompt.
	 *  Pass undefined to use defaultSystemPrompt(agent) — see agentConfig below. */
	rawSystemPrompt: string | undefined;
	/** Fallback agent config used to build defaultSystemPrompt when rawSystemPrompt is absent */
	agentConfig: { name: string; role: string; model?: string; skills?: string[] };
	model: string;
	/** Primary provider ID, e.g. "claude-code" */
	cliTool: AgentCliTool;
	allowedTools: string[];
	timeoutMs: number;
	/** Optional: outer abort signal (from withTimeout). The resolver will also check
	 *  this before attempting each adapter. */
	signal?: AbortSignal;
	/** Called for each log line produced by the adapter */
	onLog?: (line: string) => void;
	/** Already-resolved queue wait (attached to telemetry record) */
	queueWaitMs?: number;
	/** Whether this is a cold start — attached to telemetry metadata */
	isColdStart?: boolean;
}

/**
 * Normalised result returned to task-executor.ts.
 * Mirrors CLIExecutionResult but is named independently so the service is
 * not coupled to the legacy cli-runtime type.
 */
export interface NormalizedProviderResult {
	text: string;
	filesCreated: string[];
	filesModified: string[];
	logs: string[];
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	costUsd: number;
	model: string;
	provider: string;
	durationMs: number;
	/** Structured proposals emitted by the agent (if adapter supports them) */
	proposals?: import("../cli-runtime.js").CLIExecutionResult["proposals"];
}

// ---------------------------------------------------------------------------
// ProviderExecutionService
// ---------------------------------------------------------------------------

export class ProviderExecutionService {
	constructor(private readonly telemetry: ProviderTelemetryCollector) {}

	/**
	 * Execute a task against the provider chain.
	 *
	 * Throws when all providers are exhausted and the caller should fail/retry.
	 * Returns a special `_exhausted: true` sentinel — callers must check for
	 * `ProvidersExhaustedResult` to handle graceful deferral.
	 */
	async execute(input: ExecuteTaskWithProviderInput): Promise<NormalizedProviderResult | ProvidersExhaustedResult> {
		const {
			projectId,
			taskId,
			agentId: _agentId,
			agentName: _agentName,
			repoPath,
			prompt,
			rawSystemPrompt,
			agentConfig,
			model: routedModel,
			cliTool: primaryCliTool,
			allowedTools,
			timeoutMs,
			signal,
			onLog,
			queueWaitMs,
			isColdStart,
		} = input;

		// Build the sorted, skip/cooldown-aware adapter chain using ALL registered adapters
		const { providerRegistry } = await import("../kernel/provider-registry.js");
		const allAdapterIds = providerRegistry.list().map((p) => p.id).filter((id) => id !== primaryCliTool) as AgentCliTool[];
		const resolver = await createProviderResolver(primaryCliTool, allAdapterIds, this.telemetry);

		// ---------------------------------------------------------------------------
		// Telemetry: START — must be recorded before any operation that can throw,
		// so that a record always exists even if systemPrompt construction fails.
		// ---------------------------------------------------------------------------
		const telemetryRecord: TelemetryRecord = startProviderTelemetry(this.telemetry, {
			runId: projectId,
			taskId,
			provider: primaryCliTool,
			repoPath,
			prompt,
			systemPrompt: rawSystemPrompt ?? "",
			timeoutMs,
			allowedTools,
			model: routedModel,
		});

		// Build system prompt after telemetry is started so any construction error
		// does not prevent the telemetry record from being written.
		const safeAgentConfig = {
			...agentConfig,
			skills: agentConfig.skills ?? [],
		};
		const systemPrompt = rawSystemPrompt
			? composeSystemPrompt(rawSystemPrompt)
			: defaultSystemPrompt(safeAgentConfig);
		if (queueWaitMs !== undefined) {
			telemetryRecord.queueWaitMs = queueWaitMs;
		}

		// If outer signal was already aborted before we started, record cancel and bail
		if (signal?.aborted && telemetryRecord) {
			recordProviderCancel(this.telemetry, telemetryRecord, CANCEL_REASONS.pipeline_pause);
		}

		// ---------------------------------------------------------------------------
		// Fallback loop
		// ---------------------------------------------------------------------------
		let lastFailureProvider: string | undefined;
		let lastFailureClassification: ProviderErrorClassification | undefined;
		let lastAdapterError: Error | null = null;

		let adapter = await resolver.next({ allowedTools, lastFailureProvider, lastFailureClassification });

		while (adapter) {
			const adapterName = adapter.name as AgentCliTool;
			const adapterStartMs = Date.now();

			log.info(`[provider-execution-service] Attempting adapter "${adapterName}" for task ${taskId}`);

			try {
				const cliResult = await adapter.execute({
					projectId,
					taskId,
					agentId: input.agentId,
					agentName: input.agentName,
					repoPath,
					prompt,
					systemPrompt,
					timeoutMs,
					model: routedModel,
					signal,
					allowedTools,
					onLog,
				});

				// Mark success in provider state
				providerState.markSuccess(adapterName);

				// Telemetry: SUCCESS
				finishProviderTelemetry(this.telemetry, telemetryRecord, {
					provider: adapterName,
					model: routedModel,
					text: cliResult.text,
					filesCreated: cliResult.filesCreated,
					filesModified: cliResult.filesModified,
					logs: cliResult.logs,
					startedAt: telemetryRecord.startedAt,
					completedAt: new Date().toISOString(),
					metadata: { durationMs: cliResult.durationMs, isColdStart },
				});

				log.info(
					`[provider-execution-service] Adapter "${adapterName}" succeeded for task ${taskId} in ${Date.now() - adapterStartMs}ms`,
				);

				return {
					text: cliResult.text,
					filesCreated: cliResult.filesCreated,
					filesModified: cliResult.filesModified,
					logs: cliResult.logs,
					inputTokens: cliResult.inputTokens,
					outputTokens: cliResult.outputTokens,
					cacheCreationTokens: cliResult.cacheCreationTokens,
					cacheReadTokens: cliResult.cacheReadTokens,
					costUsd: cliResult.totalCostUsd,
					model: cliResult.model ?? routedModel,
					provider: adapterName,
					durationMs: cliResult.durationMs,
					proposals: cliResult.proposals,
				};
			} catch (adapterErr) {
				lastAdapterError = adapterErr instanceof Error ? adapterErr : new Error(String(adapterErr));
				const errMsg = lastAdapterError.message;
				const latencyMs = Date.now() - adapterStartMs;
				const { classification, reason } = classifyProviderErrorWithReason(adapterErr);

				lastFailureProvider = adapter.name;
				lastFailureClassification = classification;

				// Mark failure / rate-limit in provider state
				if (isRateLimitError(errMsg)) {
					log.warn(`[provider-execution-service] Rate limit on "${adapterName}" — marking cooldown`);
					providerState.markRateLimited(adapterName);
				} else {
					providerState.markFailure(adapterName, classification);
				}

				log.warn(
					`[provider-execution-service] Adapter "${adapterName}" failed (${classification}, reason=${reason}): ${errMsg.slice(0, 200)}`,
				);

				// Advance to next candidate
				const nextAdapter = await resolver.next({
					allowedTools,
					lastFailureProvider: adapter.name,
					lastFailureClassification: classification,
				});

				// Record fallback in telemetry if there is a next candidate
				if (nextAdapter) {
					recordProviderFallback(
						this.telemetry,
						telemetryRecord,
						adapterName,
						nextAdapter.name,
						reason,
						latencyMs,
						adapterErr,
					);
				}

				adapter = nextAdapter;
			}
		}

		// ---------------------------------------------------------------------------
		// All providers exhausted
		// ---------------------------------------------------------------------------
		if (providerState.isAllExhausted()) {
			const retryMs = providerState.getEarliestRecoveryMs();
			log.warn(`[provider-execution-service] All providers exhausted — deferral for ${Math.round(retryMs / 1000)}s`);

			recordProviderDegraded(
				this.telemetry,
				telemetryRecord,
				`All providers exhausted. Retry in ${Math.round(retryMs / 1000)}s.`,
			);
			finishProviderTelemetry(
				this.telemetry,
				telemetryRecord,
				null,
				lastAdapterError ?? new Error("All providers exhausted"),
			);

			return { _exhausted: true, retryMs };
		}

		// Not all exhausted but none available — final error
		finishProviderTelemetry(
			this.telemetry,
			telemetryRecord,
			null,
			lastAdapterError ?? new Error("All CLI adapters exhausted"),
		);

		const err = lastAdapterError ?? new Error("All CLI adapters exhausted — no provider available.");
		(err as any).classification = lastFailureClassification ?? "unknown";
		throw err;
	}
}

// ---------------------------------------------------------------------------
// ProvidersExhaustedResult — sentinel returned when all providers are on cooldown
// ---------------------------------------------------------------------------

export interface ProvidersExhaustedResult {
	_exhausted: true;
	retryMs: number;
}

export function isProvidersExhausted(r: NormalizedProviderResult | ProvidersExhaustedResult): r is ProvidersExhaustedResult {
	return (r as ProvidersExhaustedResult)._exhausted === true;
}
