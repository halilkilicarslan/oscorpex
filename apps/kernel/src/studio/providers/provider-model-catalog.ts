// ---------------------------------------------------------------------------
// Oscorpex — Provider Model Catalog
// Single source of truth for all hardcoded model data:
//   • context window limits
//   • relative cost scores
//   • per-provider model lists (sorted cost-ascending)
//   • per-provider tier-to-model mappings
//   • default S/M/L/XL routing config (Anthropic)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tier type (re-exported so dependents don't import from model-router)
// ---------------------------------------------------------------------------

/** Complexity tiers in escalation order. */
export const TIERS = ["S", "M", "L", "XL"] as const;
export type Tier = (typeof TIERS)[number];

// ---------------------------------------------------------------------------
// Context window limits (tokens)
// ---------------------------------------------------------------------------

export const MODEL_CONTEXT_LIMITS: Readonly<Record<string, number>> = {
	"claude-haiku-4-5-20251001": 200_000,
	"claude-sonnet-4-6": 200_000,
	"claude-opus-4-6": 200_000,
	"gpt-4o": 128_000,
	"gpt-4o-mini": 128_000,
	o3: 200_000,
	"cursor-small": 128_000,
	"cursor-large": 200_000,
} as const;

export const DEFAULT_CONTEXT_LIMIT = 200_000;

/**
 * Returns the context window limit (tokens) for a given model.
 * Falls back to DEFAULT_CONTEXT_LIMIT for unknown models.
 */
export function getModelContextLimit(model: string): number {
	return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
}

// ---------------------------------------------------------------------------
// Cost scores  (higher = more expensive)
// ---------------------------------------------------------------------------

export const MODEL_COST_SCORES: Readonly<Record<string, number>> = {
	"gpt-4o-mini": 1,
	"gemini-1.5-flash": 1,
	"gemini-2.0-flash": 1,
	"claude-haiku-4-5-20251001": 2,
	"cursor-small": 2,
	"gpt-4o": 5,
	"gemini-1.5-pro": 5,
	"claude-sonnet-4-6": 6,
	"cursor-large": 6,
	o3: 8,
	"claude-opus-4-6": 10,
} as const;

export const DEFAULT_COST_SCORE = 5;

/**
 * Returns the relative cost score for a model.
 * Falls back to DEFAULT_COST_SCORE for unknown models.
 */
export function getModelCostScore(model: string): number {
	return MODEL_COST_SCORES[model] ?? DEFAULT_COST_SCORE;
}

// ---------------------------------------------------------------------------
// Per-provider model lists  (sorted cost-ascending)
// ---------------------------------------------------------------------------

export const PROVIDER_MODELS_BY_COST: Readonly<Record<string, readonly string[]>> = {
	anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"],
	openai: ["gpt-4o-mini", "gpt-4o", "o3"],
	cursor: ["cursor-small", "cursor-large"],
	gemini: ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"],
	ollama: ["llama3.2", "codellama", "mistral", "phi4"],
} as const;

/**
 * Returns the model list for a provider sorted by cost ascending.
 * Returns an empty array for unknown providers.
 */
export function getProviderModels(provider: string): readonly string[] {
	return PROVIDER_MODELS_BY_COST[provider] ?? [];
}

// ---------------------------------------------------------------------------
// Per-provider tier-to-model mappings
// ---------------------------------------------------------------------------

export const PROVIDER_TIER_MODELS: Readonly<Record<string, Readonly<Record<Tier, string>>>> = {
	codex: { S: "gpt-4o-mini", M: "gpt-4o", L: "o3", XL: "o3" },
	cursor: { S: "cursor-small", M: "cursor-small", L: "cursor-large", XL: "cursor-large" },
	gemini: {
		S: "gemini-1.5-flash",
		M: "gemini-1.5-flash",
		L: "gemini-1.5-pro",
		XL: "gemini-1.5-pro",
	},
	ollama: { S: "llama3.2", M: "llama3.2", L: "codellama", XL: "codellama" },
} as const;

// Fallback model per provider when tier lookup misses
export const PROVIDER_FALLBACK_MODEL: Readonly<Record<string, string>> = {
	codex: "gpt-4o",
	cursor: "cursor-small",
	gemini: "gemini-1.5-flash",
	ollama: "llama3.2",
} as const;

/**
 * Returns the base model for a given provider and complexity tier.
 * Falls back to PROVIDER_FALLBACK_MODEL[provider] if the tier is not mapped.
 */
export function getTierModel(provider: string, tier: Tier): string {
	const map = PROVIDER_TIER_MODELS[provider];
	return map?.[tier] ?? PROVIDER_FALLBACK_MODEL[provider] ?? "claude-sonnet-4-6";
}

// ---------------------------------------------------------------------------
// Default Anthropic routing config  (S/M/L/XL → model)
// ---------------------------------------------------------------------------

export const DEFAULT_ANTHROPIC_ROUTING: Readonly<Record<Tier, string>> = {
	S: "claude-haiku-4-5-20251001",
	M: "claude-sonnet-4-6",
	L: "claude-sonnet-4-6",
	XL: "claude-opus-4-6",
} as const;

/**
 * Returns a mutable copy of the default Anthropic routing config so callers
 * can spread project-level overrides on top without mutating the catalog.
 *
 * S  → Haiku  (fast, cheap — small scoped tasks)
 * M  → Sonnet (balanced — most implementation tasks)
 * L  → Sonnet (heavier — complex multi-file tasks)
 * XL → Opus   (highest quality — architectural / high-risk tasks)
 */
export function getDefaultRoutingConfig(): Record<string, string> {
	return { ...DEFAULT_ANTHROPIC_ROUTING };
}
