// ---------------------------------------------------------------------------
// Oscorpex — Fallback Decision Motor (TASK 5)
// Smarter fallback chain construction and provider skipping logic.
// ---------------------------------------------------------------------------

import type { CLIAdapter } from "./cli-adapter.js";
import type { ProviderCapabilities } from "./provider-runtime-cache.js";
import { providerRuntimeCache } from "./provider-runtime-cache.js";
import { providerState } from "./provider-state.js";
import type { ProviderErrorClassification } from "@oscorpex/provider-sdk";
import { createLogger } from "./logger.js";
const log = createLogger("fallback-decision");

// ---------------------------------------------------------------------------
// Severity weights — higher = more severe, more likely to skip provider
// ---------------------------------------------------------------------------

const FALLBACK_SEVERITY: Record<ProviderErrorClassification, number> = {
	tool_restriction_unsupported: 100,
	spawn_failure: 90,
	unavailable: 80,
	rate_limited: 70,
	timeout: 60,
	cli_error: 40,
	killed: 30,
	unknown: 20,
};

export function getFallbackSeverity(classification: ProviderErrorClassification): number {
	return FALLBACK_SEVERITY[classification] ?? 10;
}

// ---------------------------------------------------------------------------
// Provider skipping rules
// ---------------------------------------------------------------------------

export interface SkipCheck {
	shouldSkip: boolean;
	reason?: string;
}

/**
 * Determines if a provider should be skipped for this task.
 * Checks:
 * 1. Tool restriction compatibility
 * 2. Recent timeout on same provider (don't retry immediately)
 * 3. Provider is in cooldown
 * 4. Provider binary unavailable
 */
export async function shouldSkipProvider(
	adapter: CLIAdapter,
	options: {
		allowedTools?: string[];
		lastFailureProvider?: string;
		lastFailureClassification?: ProviderErrorClassification;
	},
): Promise<SkipCheck> {
	// 1. Tool restriction compatibility
	if (options.allowedTools && options.allowedTools.length > 0) {
		const caps = await providerRuntimeCache.resolveCapability(adapter.name, () => adapter.capabilities());
		if (!isToolRestrictionCompatible(caps, options.allowedTools)) {
			return {
				shouldSkip: true,
				reason: "tool_restriction_unsupported",
			};
		}
	}

	// 2. Don't retry same provider immediately after timeout
	if (
		options.lastFailureProvider === adapter.name &&
		options.lastFailureClassification === "timeout"
	) {
		return {
			shouldSkip: true,
			reason: "timeout_retry_avoided",
		};
	}

	// 3. Provider cooldown check (already handled by providerState, but double-check)
	if (!providerState.isAvailable(adapter.name as import("./types.js").AgentCliTool)) {
		return {
			shouldSkip: true,
			reason: "cooldown_active",
		};
	}

	return { shouldSkip: false };
}

function isToolRestrictionCompatible(caps: ProviderCapabilities, allowedTools: string[]): boolean {
	// Full access = no restriction, always compatible
	const fullAccessTools = ["Read", "Edit", "Glob", "Grep", "Bash", "Write", "Replace"];
	const isFullAccess = allowedTools.length >= fullAccessTools.length &&
		fullAccessTools.every((t) => allowedTools.includes(t));
	if (isFullAccess) return true;

	return caps.supportsToolRestriction;
}

// ---------------------------------------------------------------------------
// Telemetry-based chain ordering
// ---------------------------------------------------------------------------

export interface ProviderScore {
	adapter: CLIAdapter;
	score: number;
}

/**
 * Sorts adapters by telemetry-based priority.
 * Higher score = try first.
 * Factors:
 * - Recent success rate (from telemetry snapshots)
 * - Average latency (lower is better)
 * - Current availability
 */
export function sortAdapterChain(
	adapters: CLIAdapter[],
	getSnapshot: (providerId: string) => { successRate: number; avgLatencyMs: number } | undefined,
): CLIAdapter[] {
	const scored = adapters.map((adapter): ProviderScore => {
		const snapshot = getSnapshot(adapter.name);
		let score = 0;

		if (snapshot) {
			// Success rate: 0-100 points
			score += snapshot.successRate * 100;
			// Latency penalty: lower latency = higher score (max 50 points)
			const latencyPenalty = Math.min(snapshot.avgLatencyMs / 1000, 50);
			score += Math.max(0, 50 - latencyPenalty);
		} else {
			// No telemetry yet: neutral score
			score = 50;
		}

		// Availability bonus/penalty
		const available = providerState.isAvailable(adapter.name as import("./types.js").AgentCliTool);
		score += available ? 20 : -50;

		return { adapter, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored.map((s) => s.adapter);
}

// ---------------------------------------------------------------------------
// Short cooldown for unavailable providers
// ---------------------------------------------------------------------------

/**
 * Puts a provider in short cooldown when its binary is unavailable.
 * Prevents repeated attempts on a provider that is not installed.
 */
export function markProviderUnavailable(adapterName: string): void {
	log.info(`[fallback-decision] Marking ${adapterName} unavailable — 30s cooldown`);
	providerState.markRateLimited(adapterName as import("./types.js").AgentCliTool, 30_000);
}

// ---------------------------------------------------------------------------
// Re-export for execution-engine
// ---------------------------------------------------------------------------

export { FALLBACK_SEVERITY };
