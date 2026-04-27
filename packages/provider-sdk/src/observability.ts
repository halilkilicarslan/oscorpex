// @oscorpex/provider-sdk — Provider execution observability
// Telemetry collection, fallback timeline tracking, failure classification,
// and latency metrics for provider adapters.

import type { ProviderExecutionInput, ProviderExecutionResult } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderErrorClassification =
	| "unavailable"
	| "timeout"
	| "rate_limited"
	| "killed"
	| "tool_restriction_unsupported"
	| "cli_error"
	| "spawn_failure"
	| "unknown";

export interface FallbackEntry {
	 timestamp: string;
	 fromProvider: string;
	 toProvider: string;
	 reason: string;
	 errorClassification: ProviderErrorClassification;
	 latencyMs: number;
}

export interface ProviderExecutionTelemetry {
	 runId: string;
	 taskId: string;
	 startedAt: string;
	 completedAt?: string;
	 primaryProvider: string;
	 finalProvider?: string;
	 success: boolean;
	 latencyMs: number;
	 fallbackCount: number;
	 fallbackTimeline: FallbackEntry[];
	 errorClassification?: ProviderErrorClassification;
	 errorMessage?: string;
	 retryReason?: string;
	 degradedMode?: boolean;
	 degradedMessage?: string;
	 canceled?: boolean;
	 cancelReason?: string;
}

export interface ProviderLatencySnapshot {
	 providerId: string;
	 totalExecutions: number;
	 successfulExecutions: number;
	 failedExecutions: number;
	 averageLatencyMs: number;
	 p95LatencyMs: number;
	 lastFailureAt?: string;
	 lastFailureClassification?: ProviderErrorClassification;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function classifyProviderError(err: unknown): ProviderErrorClassification {
	if (!(err instanceof Error)) return "unknown";
	const msg = err.message.toLowerCase();
	const name = err.name;

	if (msg.includes("spawn failed") || msg.includes("not executable")) {
		return "spawn_failure";
	}
	if (name === "ProviderUnavailableError" || msg.includes("not found") || msg.includes("enoent")) {
		return "unavailable";
	}
	if (name === "ProviderTimeoutError" || msg.includes("timed out")) {
		return "timeout";
	}
	if (name === "ProviderRateLimitError" || msg.includes("rate limit")) {
		return "rate_limited";
	}
	if (msg.includes("killed") || msg.includes("sigterm") || msg.includes("sigkill")) {
		return "killed";
	}
	if (msg.includes("cannot honor restricted tool policies")) {
		return "tool_restriction_unsupported";
	}
	if (msg.includes("exited with code")) {
		return "cli_error";
	}
	return "unknown";
}

// ---------------------------------------------------------------------------
// Telemetry collector
// ---------------------------------------------------------------------------

export class ProviderTelemetryCollector {
	 private records = new Map<string, ProviderExecutionTelemetry>();
	 private latencyHistory = new Map<string, number[]>();

	 startExecution(input: ProviderExecutionInput): ProviderExecutionTelemetry {
		 const record: ProviderExecutionTelemetry = {
			 runId: input.runId,
			 taskId: input.taskId,
			 startedAt: new Date().toISOString(),
			 primaryProvider: input.provider,
			 success: false,
			 latencyMs: 0,
			 fallbackCount: 0,
			 fallbackTimeline: [],
		 };
		 this.records.set(`${input.runId}:${input.taskId}`, record);
		 return record;
	 }

	 recordFallback(
		 record: ProviderExecutionTelemetry,
		 fromProvider: string,
		 toProvider: string,
		 reason: string,
		 errorClassification: ProviderErrorClassification,
		 latencyMs: number,
	 ): void {
		 record.fallbackTimeline.push({
			 timestamp: new Date().toISOString(),
			 fromProvider,
			 toProvider,
			 reason,
			 errorClassification,
			 latencyMs,
		 });
		 record.fallbackCount++;
	 }

	 recordDegraded(record: ProviderExecutionTelemetry, message: string): void {
		 record.degradedMode = true;
		 record.degradedMessage = message;
	 }

	 recordCancel(record: ProviderExecutionTelemetry, reason: string): void {
		 record.canceled = true;
		 record.cancelReason = reason;
	 }

	 finishExecution(
		 record: ProviderExecutionTelemetry,
		 result: ProviderExecutionResult | null,
		 error?: unknown,
	 ): ProviderExecutionTelemetry {
		 record.completedAt = new Date().toISOString();
		 record.success = result !== null && !error;
		 if (result?.metadata?.durationMs) {
			 record.latencyMs = result.metadata.durationMs as number;
		 }
		 if (result) {
			 record.finalProvider = result.provider;
		 }
		 if (error) {
			 record.errorClassification = classifyProviderError(error);
			 record.errorMessage = error instanceof Error ? error.message : String(error);
		 }
		 this._trackLatency(record);
		 return record;
	 }

	 getRecord(runId: string, taskId: string): ProviderExecutionTelemetry | undefined {
		 return this.records.get(`${runId}:${taskId}`);
	 }

	 getRecentRecords(limit = 50): ProviderExecutionTelemetry[] {
		 const all = Array.from(this.records.values());
		 return all.slice(-limit);
	 }

	 getLatencySnapshot(providerId: string): ProviderLatencySnapshot {
		 const history = this.latencyHistory.get(providerId) ?? [];
		 const total = history.length;
		 const successful = this._countSuccess(providerId);
		 const failed = total - successful;
		 const avg = total > 0 ? history.reduce((a, b) => a + b, 0) / total : 0;
		 const sorted = [...history].sort((a, b) => a - b);
		 const p95 = total > 0 ? sorted[Math.floor(total * 0.95)] ?? sorted[sorted.length - 1] : 0;

		 return {
			 providerId,
			 totalExecutions: total,
			 successfulExecutions: successful,
			 failedExecutions: failed,
			 averageLatencyMs: Math.round(avg),
			 p95LatencyMs: Math.round(p95),
		 };
	 }

	 private _trackLatency(record: ProviderExecutionTelemetry): void {
		 const provider = record.finalProvider ?? record.primaryProvider;
		 const history = this.latencyHistory.get(provider) ?? [];
		 history.push(record.latencyMs);
		 // Keep last 1000 entries
		 if (history.length > 1000) history.shift();
		 this.latencyHistory.set(provider, history);
	 }

	 private _countSuccess(providerId: string): number {
		 let count = 0;
		 for (const record of this.records.values()) {
			 if ((record.finalProvider ?? record.primaryProvider) === providerId && record.success) {
				 count++;
			 }
		 }
		 return count;
	 }
}

// Global singleton for kernel consumption
export const providerTelemetry = new ProviderTelemetryCollector();
