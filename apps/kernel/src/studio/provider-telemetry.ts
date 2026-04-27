// ---------------------------------------------------------------------------
// Oscorpex — Provider Telemetry Helper
// Thin wrapper around @oscorpex/provider-sdk telemetry collector.
// Provides typed helpers, standardized reason constants, and lifecycle
// management for provider execution observability.
//
// Usage in execution-engine.ts:
//   const record = startProviderTelemetry(input);
//   ... execute adapters ...
//   finishProviderTelemetry(record, result, err);
// ---------------------------------------------------------------------------

import type {
	ProviderExecutionInput,
	ProviderExecutionResult,
} from "@oscorpex/core";
import {
	ProviderTelemetryCollector,
	classifyProviderError,
} from "@oscorpex/provider-sdk";
import { createLogger } from "./logger.js";
import { eventBus } from "./event-bus.js";

const log = createLogger("provider-telemetry");

// ---------------------------------------------------------------------------
// Standardized reason constants
// ---------------------------------------------------------------------------

export const FALLBACK_REASONS = {
	provider_unavailable: "provider_unavailable",
	timeout: "timeout",
	rate_limited: "rate_limited",
	tool_restriction_unsupported: "tool_restriction_unsupported",
	cli_error: "cli_error",
	spawn_failure: "spawn_failure",
	unknown: "unknown",
} as const;

export type FallbackReason = (typeof FALLBACK_REASONS)[keyof typeof FALLBACK_REASONS];

export const CANCEL_REASONS = {
	user_cancel: "user_cancel",
	pipeline_pause: "pipeline_pause",
	timeout_abort: "timeout_abort",
	provider_abort: "provider_abort",
	shutdown_recovery: "shutdown_recovery",
} as const;

export type CancelReason = (typeof CANCEL_REASONS)[keyof typeof CANCEL_REASONS];

// ---------------------------------------------------------------------------
// Helper functions — thin wrappers with standardization
// ---------------------------------------------------------------------------

export type TelemetryRecord = ReturnType<ProviderTelemetryCollector["startExecution"]>;

export function startProviderTelemetry(
	collector: ProviderTelemetryCollector,
	input: ProviderExecutionInput,
): TelemetryRecord {
	return collector.startExecution(input);
}

export function finishProviderTelemetry(
	collector: ProviderTelemetryCollector,
	record: TelemetryRecord,
	result: ProviderExecutionResult | null,
	err?: unknown,
): void {
	collector.finishExecution(record, result, err);
}

export function recordProviderFallback(
	collector: ProviderTelemetryCollector,
	record: TelemetryRecord,
	fromProvider: string,
	toProvider: string,
	reason: string,
	latencyMs: number,
	err: unknown,
): void {
	const classification = classifyProviderError(err);
	collector.recordFallback(record, fromProvider, toProvider, reason, classification, latencyMs);
}

export function recordProviderDegraded(
	collector: ProviderTelemetryCollector,
	record: TelemetryRecord,
	message: string,
): void {
	// Guard against duplicate degraded records
	if (record.degradedMode) return;

	collector.recordDegraded(record, message);
	log.warn(
		{ runId: record.runId, taskId: record.taskId, degradedMessage: message },
		"Provider degraded mode recorded",
	);
	eventBus.emitTransient({
		projectId: record.runId,
		type: "provider:degraded",
		payload: {
			reason: message,
			primaryProvider: record.primaryProvider,
		},
	});
}

export function recordProviderCancel(
	collector: ProviderTelemetryCollector,
	record: TelemetryRecord,
	reason: CancelReason,
): void {
	// Guard against duplicate cancel records
	if (record.canceled) return;

	collector.recordCancel(record, reason);
	log.info(
		{ runId: record.runId, taskId: record.taskId, cancelReason: reason },
		"Provider execution execution cancelled",
	);
}

// ---------------------------------------------------------------------------
// Error classification — re-export with standard reason mapping
// ---------------------------------------------------------------------------

export function classifyProviderErrorWithReason(err: unknown): {
	classification: ReturnType<typeof classifyProviderError>;
	reason: FallbackReason;
} {
	const classification = classifyProviderError(err);
	const reasonMap: Record<string, FallbackReason> = {
		unavailable: FALLBACK_REASONS.provider_unavailable,
		timeout: FALLBACK_REASONS.timeout,
		rate_limited: FALLBACK_REASONS.rate_limited,
		tool_restriction_unsupported: FALLBACK_REASONS.tool_restriction_unsupported,
		cli_error: FALLBACK_REASONS.cli_error,
		spawn_failure: FALLBACK_REASONS.spawn_failure,
		unknown: FALLBACK_REASONS.unknown,
	};
	return { classification, reason: reasonMap[classification] ?? FALLBACK_REASONS.unknown };
}
