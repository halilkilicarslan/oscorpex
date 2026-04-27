// ---------------------------------------------------------------------------
// Oscorpex — Performance Metrics Collector (TASK 1: Baseline)
// Aggregates provider telemetry + execution lifecycle into actionable
// performance snapshots. No behavioral changes; read-only aggregation.
// ---------------------------------------------------------------------------

import { ProviderTelemetryCollector, type ProviderExecutionTelemetry } from "@oscorpex/provider-sdk";
import { createLogger } from "./logger.js";

const log = createLogger("performance-metrics");

export interface ProviderPerfSnapshot {
	providerId: string;
	totalExecutions: number;
	successfulExecutions: number;
	failedExecutions: number;
	fallbackRate: number;
	cancelRate: number;
	timeoutRate: number;
	avgLatencyMs: number;
	p95LatencyMs: number;
	p99LatencyMs: number;
	minLatencyMs: number;
	maxLatencyMs: number;
	classificationDistribution: Record<string, number>;
	lastFailureAt?: string;
	lastFailureClassification?: string;
}

export interface ExecutionBaseline {
	generatedAt: string;
	windowMs: number;
	totalExecutions: number;
	successRate: number;
	fallbackRate: number;
	cancelRate: number;
	timeoutRate: number;
	avgLatencyMs: number;
	overallP95LatencyMs: number;
	overallP99LatencyMs: number;
	providerSnapshots: ProviderPerfSnapshot[];
	topSlowestPatterns: Array<{
		provider: string;
		classification?: string;
		avgLatencyMs: number;
		count: number;
	}>;
	topFallbackPatterns: Array<{
		fromProvider: string;
		toProvider: string;
		reason: string;
		count: number;
	}>;
	queueWaitMs?: number; // placeholder — populated by TASK 2
}

/**
 * Build a performance baseline from the telemetry collector.
 * @param collector — ProviderTelemetryCollector instance
 * @param windowMs — how far back to look (default 1 hour)
 */
export function buildPerformanceBaseline(
	collector: ProviderTelemetryCollector,
	windowMs = 60 * 60 * 1000,
): ExecutionBaseline {
	const now = Date.now();
	const cutoff = now - windowMs;

	const records = collector.getRecentRecords(1000).filter((r) => {
		const t = new Date(r.startedAt).getTime();
		return t >= cutoff;
	});

	const totalExecutions = records.length;
	const successfulExecutions = records.filter((r) => r.success).length;
	const failedExecutions = totalExecutions - successfulExecutions;
	const fallbackCount = records.reduce((sum, r) => sum + r.fallbackCount, 0);
	const cancelCount = records.filter((r) => r.canceled).length;
	const timeoutCount = records.filter(
		(r) => r.errorClassification === "timeout" || r.fallbackTimeline.some((f) => f.errorClassification === "timeout"),
	).length;

	const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
	const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
	const overallP95LatencyMs = percentile(latencies, 0.95);
	const overallP99LatencyMs = percentile(latencies, 0.99);

	const providerIds = new Set<string>();
	for (const r of records) {
		providerIds.add(r.finalProvider ?? r.primaryProvider);
	}

	const providerSnapshots: ProviderPerfSnapshot[] = [];
	for (const providerId of Array.from(providerIds).sort()) {
		providerSnapshots.push(buildProviderSnapshot(providerId, records, cutoff));
	}

	return {
		generatedAt: new Date().toISOString(),
		windowMs,
		totalExecutions,
		successRate: totalExecutions > 0 ? round2(successfulExecutions / totalExecutions) : 0,
		fallbackRate: totalExecutions > 0 ? round2(fallbackCount / totalExecutions) : 0,
		cancelRate: totalExecutions > 0 ? round2(cancelCount / totalExecutions) : 0,
		timeoutRate: totalExecutions > 0 ? round2(timeoutCount / totalExecutions) : 0,
		avgLatencyMs,
		overallP95LatencyMs,
		overallP99LatencyMs,
		providerSnapshots,
		topSlowestPatterns: buildTopSlowest(records),
		topFallbackPatterns: buildTopFallbackPatterns(records),
	};
}

function buildProviderSnapshot(
	providerId: string,
	records: ProviderExecutionTelemetry[],
	_cutoff: number,
): ProviderPerfSnapshot {
	const providerRecords = records.filter(
		(r) => (r.finalProvider ?? r.primaryProvider) === providerId,
	);
	const total = providerRecords.length;
	const successful = providerRecords.filter((r) => r.success).length;
	const failed = total - successful;
	const fallbackCount = providerRecords.reduce((sum, r) => sum + r.fallbackCount, 0);
	const cancelCount = providerRecords.filter((r) => r.canceled).length;
	const timeoutCount = providerRecords.filter(
		(r) =>
			r.errorClassification === "timeout" ||
			r.fallbackTimeline.some((f) => f.errorClassification === "timeout"),
	).length;

	const latencies = providerRecords.map((r) => r.latencyMs).sort((a, b) => a - b);
	const classificationDistribution: Record<string, number> = {};
	for (const r of providerRecords) {
		if (r.errorClassification) {
			classificationDistribution[r.errorClassification] =
				(classificationDistribution[r.errorClassification] ?? 0) + 1;
		}
		for (const f of r.fallbackTimeline) {
			classificationDistribution[f.errorClassification] =
				(classificationDistribution[f.errorClassification] ?? 0) + 1;
		}
	}

	const lastFailure = providerRecords
		.filter((r) => !r.success)
		.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

	return {
		providerId,
		totalExecutions: total,
		successfulExecutions: successful,
		failedExecutions: failed,
		fallbackRate: total > 0 ? round2(fallbackCount / total) : 0,
		cancelRate: total > 0 ? round2(cancelCount / total) : 0,
		timeoutRate: total > 0 ? round2(timeoutCount / total) : 0,
		avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
		p95LatencyMs: percentile(latencies, 0.95),
		p99LatencyMs: percentile(latencies, 0.99),
		minLatencyMs: latencies.length > 0 ? latencies[0] : 0,
		maxLatencyMs: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
		classificationDistribution,
		lastFailureAt: lastFailure?.startedAt,
		lastFailureClassification: lastFailure?.errorClassification,
	};
}

function buildTopSlowest(
	records: ProviderExecutionTelemetry[],
): ExecutionBaseline["topSlowestPatterns"] {
	const groups = new Map<string, { latencies: number[]; provider: string; classification?: string }>();
	for (const r of records) {
		const key = `${r.finalProvider ?? r.primaryProvider}:${r.errorClassification ?? "success"}`;
		const existing = groups.get(key);
		if (existing) {
			existing.latencies.push(r.latencyMs);
		} else {
			groups.set(key, {
				latencies: [r.latencyMs],
				provider: r.finalProvider ?? r.primaryProvider,
				classification: r.errorClassification ?? undefined,
			});
		}
	}

	const items = Array.from(groups.values())
		.map((g) => ({
			provider: g.provider,
			classification: g.classification === "success" ? undefined : g.classification,
			avgLatencyMs: Math.round(g.latencies.reduce((a, b) => a + b, 0) / g.latencies.length),
			count: g.latencies.length,
		}))
		.sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
		.slice(0, 5);

	return items;
}

function buildTopFallbackPatterns(
	records: ProviderExecutionTelemetry[],
): ExecutionBaseline["topFallbackPatterns"] {
	const groups = new Map<string, { fromProvider: string; toProvider: string; reason: string; count: number }>();
	for (const r of records) {
		for (const f of r.fallbackTimeline) {
			const key = `${f.fromProvider}:${f.toProvider}:${f.reason}`;
			const existing = groups.get(key);
			if (existing) {
				existing.count++;
			} else {
				groups.set(key, {
					fromProvider: f.fromProvider,
					toProvider: f.toProvider,
					reason: f.reason,
					count: 1,
				});
			}
		}
	}
	return Array.from(groups.values())
		.sort((a, b) => b.count - a.count)
		.slice(0, 5);
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.ceil(sorted.length * p) - 1;
	return sorted[Math.max(0, idx)] ?? sorted[sorted.length - 1];
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
