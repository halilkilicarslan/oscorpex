// ---------------------------------------------------------------------------
// Oscorpex — Model Router (v4.0)
// Public API shim — all heavy logic lives in providers/.
//
// Backward-compatible: all original exports are preserved.
// ---------------------------------------------------------------------------

import { getProjectSettings } from "./db.js";
import { createLogger } from "./logger.js";
import {
	type ProviderPolicyProfile,
	getProfileBehavior,
	normalizeProviderPolicyProfile,
	selectPrimaryProvider,
} from "./provider-policy-profiles.js";
import {
	getDefaultRoutingConfig,
	getModelContextLimit,
	type Tier,
	TIERS,
} from "./providers/provider-model-catalog.js";
import {
	effortForTier,
	resolveEscalatedTier,
	resolveNonAnthropicProvider,
	selectCostAwareModel,
} from "./providers/provider-routing-service.js";
import type { AgentCliTool, Task } from "./types.js";

const log = createLogger("model-router");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedModel {
	provider: "anthropic" | "openai" | "cursor" | string;
	model: string;
	effort: "low" | "medium" | "high";
	cliTool?: string;
	decisionReason?: string;
	selectedProfile?: ProviderPolicyProfile;
}

// ---------------------------------------------------------------------------
// Re-exports — keep callers that previously imported from model-router working
// ---------------------------------------------------------------------------

export { getDefaultRoutingConfig, getModelContextLimit, TIERS, type Tier };
export { effortForTier, selectCostAwareModel };

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
 *  5. Force at least L for high/critical risk level.
 *  6. Select model via cost-aware logic for the resolved provider + tier.
 *  7. Return { provider, model, effort }.
 */
export async function resolveModel(
	task: Task,
	context: {
		projectId: string;
		priorFailures?: number;
		reviewRejections?: number;
		riskLevel?: string;
		cliTool?: AgentCliTool | string;
		profile?: ProviderPolicyProfile;
	},
): Promise<ResolvedModel> {
	const { projectId, priorFailures = 0, reviewRejections = 0, riskLevel, cliTool, profile } = context;

	// 1. Load project-level routing config and profile
	const settings = await getProjectSettings(projectId, "model_routing");
	const configOverrides: Record<string, string> = {};
	let profileOverride: string | undefined;
	for (const s of settings) {
		if (s.key === "provider_policy_profile") {
			profileOverride = s.value;
		} else {
			configOverrides[s.key] = s.value;
		}
	}
	const resolvedProfile = profile ?? normalizeProviderPolicyProfile(profileOverride);
	const behavior = getProfileBehavior(resolvedProfile);

	const routingConfig = { ...getDefaultRoutingConfig(), ...configOverrides };

	// 2. Determine base tier from task complexity
	let baseTier: Tier = (task.complexity as Tier) ?? "M";
	if (!TIERS.includes(baseTier)) {
		baseTier = "M"; // safe fallback for unknown values
	}

	// 3-5. Apply escalation rules (failures / rejections / risk)
	const { tier } = resolveEscalatedTier({ baseTier, priorFailures, reviewRejections, riskLevel });

	const effort = effortForTier(tier);

	// 6. Provider-native model mapping based on profile + cliTool
	const primary = selectPrimaryProvider(resolvedProfile, cliTool);
	const resolvedCliTool = primary.cliTool;

	// Profile-aware cost selection flags
	const allowDowngrade = behavior.allowCostDowngrade && behavior.downgradeTiers.includes(tier);
	const effectivePriorFailures = behavior.preserveQualityOnFailure ? priorFailures : 0;

	// 7. Resolve non-Anthropic providers
	const nonAnthropic = resolveNonAnthropicProvider({
		cliTool: resolvedCliTool,
		tier,
		priorFailures: effectivePriorFailures,
		allowDowngrade,
	});

	if (nonAnthropic !== null) {
		const decisionReason = nonAnthropic.isLocalFree
			? `local_free | profile=${resolvedProfile}`
			: `${nonAnthropic.reason} | profile=${resolvedProfile}`;

		return {
			provider: nonAnthropic.provider,
			model: nonAnthropic.model,
			effort,
			cliTool: resolvedCliTool,
			decisionReason,
			selectedProfile: resolvedProfile,
		};
	}

	// Default: anthropic / claude-code
	const baseModel = routingConfig[tier] ?? routingConfig["M"] ?? "claude-sonnet-4-6";
	const { model, reason } = selectCostAwareModel({
		provider: "anthropic",
		tier,
		baseModel,
		priorFailures: effectivePriorFailures,
		allowDowngrade,
	});
	log.info(`[model-router] ${task.id} → ${model} (${reason}, profile=${resolvedProfile})`);
	return {
		provider: "anthropic",
		model,
		effort,
		cliTool: resolvedCliTool,
		decisionReason: `${reason} | profile=${resolvedProfile}`,
		selectedProfile: resolvedProfile,
	};
}
