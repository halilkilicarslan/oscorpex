// ---------------------------------------------------------------------------
// Oscorpex — Policy Engine (v3.7)
// Evaluates configurable governance policies against tasks before execution.
// Pure evaluation logic is in @oscorpex/policy-kit; this module handles
// loading from DB and emitting events (kernel layer).
// ---------------------------------------------------------------------------

import {
	BUILTIN_RULE_LARGE_APPROVAL,
	BUILTIN_RULE_MAX_COST,
	BUILTIN_RULE_MULTI_REVIEWER,
	evaluateBuiltinRule,
	evaluateCustomCondition,
	evaluatePolicyRules,
	parsePolicies,
} from "@oscorpex/policy-kit";
import { getProjectSettingsMap } from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { PolicyRule, Task } from "./types.js";
const log = createLogger("policy-engine");

// Re-export for backward compatibility
export {
	evaluateCustomCondition as evaluateCustomPolicyCondition,
	parsePolicies,
	evaluateBuiltinRule,
	evaluatePolicyRules,
	BUILTIN_RULE_MAX_COST,
	BUILTIN_RULE_LARGE_APPROVAL,
	BUILTIN_RULE_MULTI_REVIEWER,
} from "@oscorpex/policy-kit";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads all configured policies for a project from project_settings.
 */
export async function getPolicies(projectId: string): Promise<PolicyRule[]> {
	const settingsMap = await getProjectSettingsMap(projectId);
	const raw = settingsMap["policy"]?.["rules"];
	const customPolicies = parsePolicies(raw);

	// Built-in rules always exist (represented as synthetic PolicyRule objects)
	const builtins: PolicyRule[] = [
		{
			id: BUILTIN_RULE_MAX_COST,
			projectId,
			name: "Max cost per task",
			condition: "task.budget > project.maxCost",
			action: "block",
			enabled: true,
		},
		{
			id: BUILTIN_RULE_LARGE_APPROVAL,
			projectId: projectId ?? "",
			name: "Require approval for large tasks",
			condition: "task.complexity in [L, XL]",
			action: "require_approval",
			enabled: true,
		},
		{
			id: BUILTIN_RULE_MULTI_REVIEWER,
			projectId: projectId ?? "",
			name: "Multi-reviewer for sensitive files",
			condition: "task.targetFiles matches pattern",
			action: "warn",
			enabled: true,
		},
	];

	// Merge: custom policies from settings override/supplement builtins
	return [...builtins, ...(customPolicies as PolicyRule[])];
}

/**
 * Evaluates all enabled policies against a task.
 * Uses pure evaluation from @oscorpex/policy-kit, then emits events.
 *
 * @returns { allowed: boolean, violations: string[] }
 *   - allowed: false if any "block" action rule fires
 *   - violations: list of human-readable violation messages
 */
export async function evaluatePolicies(
	projectId: string,
	task: Task,
): Promise<{ allowed: boolean; violations: string[] }> {
	const settingsMap = await getProjectSettingsMap(projectId);
	const raw = settingsMap["policy"]?.["rules"];
	const customRules = parsePolicies(raw);

	const result = evaluatePolicyRules(task, settingsMap as Record<string, Record<string, string>>, customRules);

	if (result.violations.length > 0) {
		eventBus.emit({
			projectId,
			type: "policy:violation",
			taskId: task.id,
			payload: {
				taskTitle: task.title,
				violations: result.violations,
				blocked: result.blocked,
				evaluatedAt: new Date().toISOString(),
			},
		});
	}

	return { allowed: result.allowed, violations: result.violations };
}
