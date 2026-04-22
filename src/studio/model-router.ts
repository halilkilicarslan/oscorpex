// ---------------------------------------------------------------------------
// Oscorpex — Model Router (v3.4)
// Routes tasks to appropriate AI models based on complexity, failure history,
// and project-level routing configuration stored in project_settings.
// ---------------------------------------------------------------------------

import { getProjectSettings } from "./db.js";
import type { AgentCliTool, Task } from "./types.js";
import { createLogger } from "./logger.js";
const log = createLogger("model-router");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedModel {
	provider: "anthropic" | "openai" | "cursor" | string;
	model: string;
	effort: "low" | "medium" | "high";
	cliTool?: AgentCliTool;
}

// Complexity tiers in order — used for escalation arithmetic
const TIERS = ["S", "M", "L", "XL"] as const;
type Tier = (typeof TIERS)[number];

// ---------------------------------------------------------------------------
// Model context window limits (tokens)
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
	"claude-haiku-4-5-20251001": 200_000,
	"claude-sonnet-4-6": 200_000,
	"claude-opus-4-6": 200_000,
	"gpt-4o": 128_000,
	"gpt-4o-mini": 128_000,
	"o3": 200_000,
	"cursor-small": 128_000,
	"cursor-large": 200_000,
};

const DEFAULT_CONTEXT_LIMIT = 200_000;

/**
 * Returns the context window limit (in tokens) for a given model.
 * Used by prompt-budget to enforce model-aware truncation.
 */
export function getModelContextLimit(model: string): number {
	return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
}

// ---------------------------------------------------------------------------
// Default routing config
// ---------------------------------------------------------------------------

/**
 * Returns the default S/M/L/XL → model mapping.
 * These are the Anthropic models preferred per tier:
 *   S  → Haiku  (fast, cheap — small scoped tasks)
 *   M  → Sonnet (balanced — most implementation tasks)
 *   L  → Sonnet (heavier — complex multi-file tasks)
 *   XL → Opus   (highest quality — architectural / high-risk tasks)
 */
export function getDefaultRoutingConfig(): Record<string, string> {
	return {
		S: "claude-haiku-4-5-20251001",
		M: "claude-sonnet-4-6",
		L: "claude-sonnet-4-6",
		XL: "claude-opus-4-6",
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tierIndex(tier: Tier): number {
	return TIERS.indexOf(tier);
}

function bumpTier(tier: Tier, steps = 1): Tier {
	const idx = Math.min(tierIndex(tier) + steps, TIERS.length - 1);
	return TIERS[idx];
}

function effortForTier(tier: Tier): ResolvedModel["effort"] {
	if (tier === "S") return "low";
	if (tier === "XL") return "high";
	return "medium";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolves the optimal model for a task.
 *
 * Resolution order:
 *  1. Read per-project routing config from project_settings (category: "model_routing").
 *  2. Start from the task's complexity tier.
 *  3. Escalate one tier if priorFailures > 0.
 *  4. Escalate one additional tier if reviewRejections > 1.
 *  5. Look up the final tier in the routing config.
 *  6. Return { provider, model, effort }.
 */
export async function resolveModel(
	task: Task,
	context: {
		projectId: string;
		priorFailures?: number;
		reviewRejections?: number;
		riskLevel?: string;
		cliTool?: AgentCliTool;
	},
): Promise<ResolvedModel> {
	const { projectId, priorFailures = 0, reviewRejections = 0, riskLevel, cliTool } = context;

	// 1. Load project-level routing config
	const settings = await getProjectSettings(projectId, "model_routing");
	const configOverrides: Record<string, string> = {};
	for (const s of settings) {
		configOverrides[s.key] = s.value;
	}
	const routingConfig = { ...getDefaultRoutingConfig(), ...configOverrides };

	// 2. Determine base tier from task complexity
	let tier: Tier = (task.complexity as Tier) ?? "M";
	if (!TIERS.includes(tier)) {
		tier = "M"; // safe fallback for unknown values
	}

	// 3. Escalate for prior failures (one tier up)
	if (priorFailures > 0) {
		tier = bumpTier(tier);
	}

	// 4. Escalate for repeated review rejections (one tier up)
	if (reviewRejections > 1) {
		tier = bumpTier(tier);
	}

	// 5. Risk-level override: "high" or "critical" risk bumps to at least L
	if (riskLevel === "high" || riskLevel === "critical") {
		const lIdx = tierIndex("L");
		if (tierIndex(tier) < lIdx) {
			tier = "L";
		}
	}

	const effort = effortForTier(tier);

	// 6. Provider-native model mapping based on cliTool
	const resolvedCliTool = cliTool ?? "claude-code";

	if (resolvedCliTool === "codex") {
		const codexModels: Record<Tier, string> = { S: "gpt-4o-mini", M: "gpt-4o", L: "o3", XL: "o3" };
		return { provider: "openai", model: codexModels[tier] ?? "gpt-4o", effort, cliTool: resolvedCliTool };
	}

	if (resolvedCliTool === "cursor") {
		const cursorModels: Record<Tier, string> = {
			S: "cursor-small",
			M: "cursor-small",
			L: "cursor-large",
			XL: "cursor-large",
		};
		return { provider: "cursor", model: cursorModels[tier] ?? "cursor-small", effort, cliTool: resolvedCliTool };
	}

	// Default: anthropic
	const model = routingConfig[tier] ?? routingConfig["M"] ?? "claude-sonnet-4-6";
	return { provider: "anthropic", model, effort, cliTool: resolvedCliTool };
}
