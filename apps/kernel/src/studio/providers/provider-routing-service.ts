// ---------------------------------------------------------------------------
// Oscorpex — Provider Routing Service
// Encapsulates all tier-escalation logic, effort resolution, and cost-aware
// model selection.  Depends only on the catalog — no I/O, no side effects.
// ---------------------------------------------------------------------------

import {
	type Tier,
	TIERS,
	getModelCostScore,
	getProviderModels,
	getTierModel,
} from "./provider-model-catalog.js";

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

/** Returns the 0-based index of a tier within the TIERS tuple. */
export function tierIndex(tier: Tier): number {
	return TIERS.indexOf(tier);
}

/**
 * Advances a tier by `steps` positions, clamped to the highest tier (XL).
 *
 * @example bumpTier("M", 1) → "L"
 * @example bumpTier("XL", 1) → "XL"  (already at cap)
 */
export function bumpTier(tier: Tier, steps = 1): Tier {
	const idx = Math.min(tierIndex(tier) + steps, TIERS.length - 1);
	return TIERS[idx];
}

/**
 * Maps a complexity tier to an effort label used in ResolvedModel.
 *
 * S → low, XL → high, M/L → medium
 */
export function effortForTier(tier: Tier): "low" | "medium" | "high" {
	if (tier === "S") return "low";
	if (tier === "XL") return "high";
	return "medium";
}

// ---------------------------------------------------------------------------
// Tier escalation
// ---------------------------------------------------------------------------

export interface TierEscalationInput {
	/** Raw complexity from the task (validated to a Tier or defaulted to "M"). */
	baseTier: Tier;
	/** Number of prior execution failures for this task. */
	priorFailures: number;
	/** Number of review rejections for this task. */
	reviewRejections: number;
	/** Optional risk level — "high" or "critical" forces at least tier L. */
	riskLevel?: string;
}

/**
 * Applies all escalation rules and returns the resolved tier together with a
 * human-readable explanation of what changed.
 *
 * Rules (applied in order):
 *  1. Escalate one tier when priorFailures > 0
 *  2. Escalate one additional tier when reviewRejections > 1
 *  3. Force at least L for high/critical risk
 */
export function resolveEscalatedTier(input: TierEscalationInput): { tier: Tier; escalationReason: string } {
	const { priorFailures, reviewRejections, riskLevel } = input;
	let tier = input.baseTier;
	const reasons: string[] = [];

	if (priorFailures > 0) {
		const prev = tier;
		tier = bumpTier(tier);
		if (tier !== prev) reasons.push(`failures_bump (${prev}→${tier})`);
	}

	if (reviewRejections > 1) {
		const prev = tier;
		tier = bumpTier(tier);
		if (tier !== prev) reasons.push(`rejections_bump (${prev}→${tier})`);
	}

	if (riskLevel === "high" || riskLevel === "critical") {
		const lIdx = tierIndex("L");
		if (tierIndex(tier) < lIdx) {
			const prev = tier;
			tier = "L";
			reasons.push(`risk_bump (${prev}→L, risk=${riskLevel})`);
		}
	}

	return { tier, escalationReason: reasons.length ? reasons.join(", ") : "no_escalation" };
}

// ---------------------------------------------------------------------------
// Cost-aware model selection
// ---------------------------------------------------------------------------

export interface CostAwareSelectionInput {
	/** Provider name used to look up model list from the catalog. */
	provider: string;
	/** Resolved (possibly escalated) tier. */
	tier: Tier;
	/** Tier-appropriate base model before cost optimisation. */
	baseModel: string;
	/** Effective prior failures (may be zeroed by profile behavior). */
	priorFailures: number;
	/**
	 * Whether the active profile permits downgrading to a cheaper model.
	 * When false the base model is returned unchanged.
	 */
	allowDowngrade: boolean;
}

export interface CostAwareSelectionResult {
	model: string;
	reason: string;
}

/**
 * Attempts to select a cheaper model within the same provider for low-risk
 * tasks.  Returns the cheapest model that still satisfies the tier constraint.
 *
 * Decision rules:
 *  - priorFailures > 0 → keep base model (quality preserve)
 *  - allowDowngrade = false → keep base model (quality-first profile)
 *  - tier L or XL → keep base model (quality-first for heavy tasks)
 *  - otherwise → swap to cheapest available model if it differs from base
 */
export function selectCostAwareModel(input: CostAwareSelectionInput): CostAwareSelectionResult {
	const { provider, tier, baseModel, priorFailures, allowDowngrade } = input;

	if (priorFailures > 0) {
		return { model: baseModel, reason: `quality_preserve (priorFailures=${priorFailures})` };
	}

	if (!allowDowngrade) {
		return { model: baseModel, reason: `quality_first (downgrade_disabled, tier=${tier})` };
	}

	if (tier === "L" || tier === "XL") {
		return { model: baseModel, reason: `quality_first (tier=${tier})` };
	}

	const models = getProviderModels(provider);
	const cheapest = models[0];
	if (cheapest && cheapest !== baseModel) {
		const saved = getModelCostScore(baseModel) - getModelCostScore(cheapest);
		return { model: cheapest, reason: `cost_optimize (saved=${saved}pts, tier=${tier})` };
	}

	return { model: baseModel, reason: "default (no cheaper alternative)" };
}

// ---------------------------------------------------------------------------
// Per-provider resolution
// ---------------------------------------------------------------------------

export interface ProviderResolutionInput {
	/** Resolved CLI tool name (e.g. "codex", "cursor", "gemini", "ollama"). */
	cliTool: string;
	/** Resolved (possibly escalated) tier. */
	tier: Tier;
	/** Effective prior failures for quality preservation check. */
	priorFailures: number;
	/** Whether cost downgrade is allowed by the active profile. */
	allowDowngrade: boolean;
}

export interface ProviderResolutionResult {
	/** Canonical provider name ("openai", "cursor", "gemini", "ollama"). */
	provider: string;
	model: string;
	reason: string;
	/** True when this provider does not use cost optimisation (e.g. Ollama). */
	isLocalFree: boolean;
}

/**
 * Resolves the (provider, model) pair for non-Anthropic providers.
 * Returns `null` when `cliTool` is not a known non-Anthropic provider so the
 * caller can fall through to the Anthropic/default path.
 */
export function resolveNonAnthropicProvider(input: ProviderResolutionInput): ProviderResolutionResult | null {
	const { cliTool, tier, priorFailures, allowDowngrade } = input;

	switch (cliTool) {
		case "codex": {
			const baseModel = getTierModel("codex", tier);
			const { model, reason } = selectCostAwareModel({
				provider: "openai",
				tier,
				baseModel,
				priorFailures,
				allowDowngrade,
			});
			return { provider: "openai", model, reason, isLocalFree: false };
		}

		case "cursor": {
			const baseModel = getTierModel("cursor", tier);
			const { model, reason } = selectCostAwareModel({
				provider: "cursor",
				tier,
				baseModel,
				priorFailures,
				allowDowngrade,
			});
			return { provider: "cursor", model, reason, isLocalFree: false };
		}

		case "gemini": {
			const baseModel = getTierModel("gemini", tier);
			const { model, reason } = selectCostAwareModel({
				provider: "gemini",
				tier,
				baseModel,
				priorFailures,
				allowDowngrade,
			});
			return { provider: "gemini", model, reason, isLocalFree: false };
		}

		case "ollama": {
			const baseModel = getTierModel("ollama", tier);
			// Ollama is free — cost optimisation does not apply
			return { provider: "ollama", model: baseModel, reason: "local_free", isLocalFree: true };
		}

		default:
			return null;
	}
}
