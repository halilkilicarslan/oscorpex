// ---------------------------------------------------------------------------
// Oscorpex — Timeout Policy (TASK 7)
// Provider-aware + complexity-aware timeout calculation with config surface.
// ---------------------------------------------------------------------------

import { getProjectSetting } from "./db.js";
import { createLogger } from "./logger.js";
import { getTimeoutPolicyConfig } from "./performance-config.js";
import type { AgentCliTool } from "./types.js";
const log = createLogger("timeout-policy");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const cfg = getTimeoutPolicyConfig();

// ---------------------------------------------------------------------------
// Provider timeout profiles — multiplier over base complexity timeout
// ---------------------------------------------------------------------------

export interface ProviderTimeoutProfile {
	multiplier: number;
	minMs: number;
	maxMs: number;
}

const PROVIDER_TIMEOUT_PROFILES: Record<AgentCliTool, ProviderTimeoutProfile> = {
	"claude-code": { multiplier: cfg.providerMultipliers["claude-code"]!, minMs: cfg.minMs, maxMs: cfg.maxMs },
	codex: { multiplier: cfg.providerMultipliers.codex!, minMs: cfg.minMs, maxMs: cfg.maxMs },
	cursor: { multiplier: cfg.providerMultipliers.cursor!, minMs: cfg.minMs, maxMs: cfg.maxMs },
	none: { multiplier: 1.0, minMs: cfg.minMs, maxMs: cfg.maxMs },
};

// ---------------------------------------------------------------------------
// Complexity base timeouts
// ---------------------------------------------------------------------------

const COMPLEXITY_TIMEOUT_MS: Record<string, number> = cfg.complexityBaseMs;

const DEFAULT_TASK_TIMEOUT_MS = COMPLEXITY_TIMEOUT_MS.S;
export const TIMEOUT_WARNING_THRESHOLD = cfg.warningThreshold;

// ---------------------------------------------------------------------------
// Config surface
// ---------------------------------------------------------------------------

export interface TimeoutConfig {
	baseMs: number;
	providerMultiplier: number;
	projectMultiplier: number;
	warningThreshold: number;
	minMs: number;
	maxMs: number;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolves effective timeout for a task + provider combination.
 * Priority: agentTimeout > (complexityBase × providerMultiplier × projectMultiplier)
 */
export async function resolveTaskTimeoutMs(
	projectId: string,
	complexity: string | undefined,
	agentTimeout: number | undefined,
	provider: AgentCliTool,
): Promise<number> {
	// Agent-level explicit timeout takes highest priority
	if (agentTimeout != null && agentTimeout > 0) return agentTimeout;

	// Complexity base timeout
	const baseMs = COMPLEXITY_TIMEOUT_MS[complexity ?? "S"] ?? DEFAULT_TASK_TIMEOUT_MS;

	// Provider profile multiplier
	const profile = PROVIDER_TIMEOUT_PROFILES[provider] ?? PROVIDER_TIMEOUT_PROFILES["claude-code"];

	// Project-level multiplier from settings
	const multiplierStr = await getProjectSetting(projectId, "execution", "task_timeout_multiplier");
	const projectMultiplier = multiplierStr ? Number.parseFloat(multiplierStr) : 1.0;
	const safeProjectMultiplier = Number.isFinite(projectMultiplier) && projectMultiplier > 0 ? projectMultiplier : 1.0;

	const effectiveMs = Math.round(baseMs * profile.multiplier * safeProjectMultiplier);
	const clampedMs = Math.max(profile.minMs, Math.min(profile.maxMs, effectiveMs));

	log.info(
		`[timeout-policy] ${provider} / ${complexity ?? "S"} → ${Math.round(clampedMs / 1000)}s (base=${baseMs}ms, provider×=${profile.multiplier}, project×=${safeProjectMultiplier})`,
	);

	return clampedMs;
}

/**
 * Returns full timeout config for telemetry / debugging.
 */
export async function getTimeoutConfig(
	projectId: string,
	complexity: string | undefined,
	provider: AgentCliTool,
): Promise<TimeoutConfig> {
	const baseMs = COMPLEXITY_TIMEOUT_MS[complexity ?? "S"] ?? DEFAULT_TASK_TIMEOUT_MS;
	const profile = PROVIDER_TIMEOUT_PROFILES[provider] ?? PROVIDER_TIMEOUT_PROFILES["claude-code"];
	const multiplierStr = await getProjectSetting(projectId, "execution", "task_timeout_multiplier");
	const projectMultiplier = multiplierStr ? Number.parseFloat(multiplierStr) : 1.0;
	const safeProjectMultiplier = Number.isFinite(projectMultiplier) && projectMultiplier > 0 ? projectMultiplier : 1.0;

	return {
		baseMs,
		providerMultiplier: profile.multiplier,
		projectMultiplier: safeProjectMultiplier,
		warningThreshold: TIMEOUT_WARNING_THRESHOLD,
		minMs: profile.minMs,
		maxMs: profile.maxMs,
	};
}

/**
 * Calculates warning time (ms before timeout) based on threshold.
 */
export function getTimeoutWarningMs(timeoutMs: number, threshold = TIMEOUT_WARNING_THRESHOLD): number {
	return Math.round(timeoutMs * threshold);
}

// Re-export for backward compatibility
export { COMPLEXITY_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS };
