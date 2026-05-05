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
import { TIERS, type Tier, getDefaultRoutingConfig, getModelContextLimit } from "./providers/provider-model-catalog.js";
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
		agentId?: string;
		agentRole?: string;
	},
): Promise<ResolvedModel> {
	const {
		projectId,
		priorFailures = 0,
		reviewRejections = 0,
		riskLevel,
		cliTool,
		profile,
		agentId,
		agentRole,
	} = context;

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

	// Token optimization: review tasks always use cheapest model (haiku)
	// Reviews read and evaluate — they don't generate complex code, so expensive models waste tokens.
	const isReviewTask = task.title?.startsWith("Code Review:") || task.assignedAgent?.includes("reviewer");
	if (isReviewTask) {
		const cheapModel = "claude-haiku-4-5-20251001";
		log.info(`[model-router] ${task.id} → ${cheapModel} (review_task_downgrade, profile=${resolvedProfile})`);
		return {
			provider: "anthropic",
			model: cheapModel,
			effort: "low",
			cliTool: cliTool ?? "claude-code",
			decisionReason: `review_task_downgrade | profile=${resolvedProfile}`,
			selectedProfile: resolvedProfile,
		};
	}

	// Skill-based provider/model hints — skills can suggest optimal provider for the task
	if (agentId && agentRole) {
		try {
			const { resolveSkillsForTask } = await import("./skill-resolver.js");
			const skillResult = await resolveSkillsForTask(task, agentId, agentRole, projectId, 0);
			const hintSkill = skillResult.skills.find((s) => s.skill.providerHint || s.skill.modelHint);
			if (hintSkill) {
				const hint = hintSkill.skill;
				if (hint.modelHint) {
					log.info(
						`[model-router] ${task.id} → ${hint.modelHint} (skill_hint: ${hint.name}, profile=${resolvedProfile})`,
					);
					return {
						provider: hint.providerHint ?? "anthropic",
						model: hint.modelHint,
						effort: effortForTier((task.complexity as Tier) ?? "M"),
						cliTool: cliTool ?? "claude-code",
						decisionReason: `skill_hint:${hint.name} | profile=${resolvedProfile}`,
						selectedProfile: resolvedProfile,
					};
				}
			}
		} catch {
			// Skill resolution failed — continue with normal routing
		}
	}

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
	const baseModel = routingConfig[tier] ?? routingConfig.M ?? "claude-sonnet-4-6";
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
