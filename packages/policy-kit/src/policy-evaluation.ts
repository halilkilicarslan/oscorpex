// @oscorpex/policy-kit — Policy evaluation engine
// Pure evaluation functions extracted from kernel's policy-engine.ts.
// No DB or event-bus dependencies — those remain in the kernel layer.

import type { PolicyAction, RiskLevel, ApprovalStatus } from "@oscorpex/core";
import type { PolicyEvaluationInput } from "@oscorpex/core";

// Re-export canonical types from @oscorpex/core
export type {
	PolicyAction,
	RiskLevel,
	ApprovalStatus,
	PolicyDecision,
	PolicyRule,
	SandboxEnforcementMode,
	SandboxViolation,
	SandboxPolicy,
	SandboxSession,
	PolicyEvaluationInput,
} from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Policy evaluation result
// ---------------------------------------------------------------------------

export interface PolicyEvaluationResult {
	allowed: boolean;
	violations: string[];
	blocked: boolean;
}

// ---------------------------------------------------------------------------
// Built-in rule definitions
// ---------------------------------------------------------------------------

export const BUILTIN_RULE_MAX_COST = "max_cost_per_task";
export const BUILTIN_RULE_LARGE_APPROVAL = "require_approval_for_large";
export const BUILTIN_RULE_MULTI_REVIEWER = "multi_reviewer";

// ---------------------------------------------------------------------------
// Policy evaluation — pure functions
// ---------------------------------------------------------------------------

/**
 * Evaluate a built-in policy rule against a task and settings map.
 * Returns a violation message string, or null if the rule passes.
 */
export function evaluateBuiltinRule(
	ruleName: string,
	task: {
		complexity?: string;
		requiresApproval?: boolean;
		approvalStatus?: string | null;
		title: string;
		targetFiles?: string[];
	},
	settingsMap: Record<string, Record<string, string>>,
): string | null {
	switch (ruleName) {
		case BUILTIN_RULE_MAX_COST: {
			const maxCostStr = settingsMap["budget"]?.["maxCostUsd"];
			const maxCost = maxCostStr ? Number.parseFloat(maxCostStr) : null;
			if (maxCost !== null && !Number.isNaN(maxCost)) {
				const taskBudget = settingsMap["policy"]?.["task_budget_usd"];
				const perTask = taskBudget ? Number.parseFloat(taskBudget) : null;
				if (perTask !== null && !Number.isNaN(perTask) && perTask > maxCost) {
					return `Task budget ($${perTask}) exceeds project max cost ($${maxCost})`;
				}
			}
			return null;
		}

		case BUILTIN_RULE_LARGE_APPROVAL: {
			if (task.complexity === "L" || task.complexity === "XL") {
				if (!task.requiresApproval && task.approvalStatus !== "approved") {
					return `Large/XL complexity task "${task.title}" requires approval (complexity: ${task.complexity})`;
				}
			}
			return null;
		}

		case BUILTIN_RULE_MULTI_REVIEWER: {
			const patternStr = settingsMap["policy"]?.["multi_reviewer_pattern"];
			if (!patternStr || !task.targetFiles || task.targetFiles.length === 0) return null;
			try {
				const pattern = new RegExp(patternStr, "i");
				const matchedFiles = task.targetFiles.filter((f) => pattern.test(f));
				if (matchedFiles.length > 0) {
					return `Files matching pattern "${patternStr}" require multiple reviewers: ${matchedFiles.slice(0, 3).join(", ")}`;
				}
			} catch {
				// Invalid regex pattern — skip silently
			}
			return null;
		}

		default:
			return null;
	}
}

/**
 * Evaluate a simple custom condition string against a task.
 * Supported conditions:
 *   - "complexity == XL", "complexity >= L"
 *   - "title contains deploy"
 *   - "branch == main"
 *   - "description contains ..."
 *   - "assigned_agent == ..."
 *   - "target_files contains ..."
 *   - "retry_count >= N"
 */
export function evaluateCustomCondition(
	condition: string,
	task: {
		complexity?: string;
		title: string;
		branch?: string;
		description: string;
		assignedAgent?: string;
		targetFiles?: string[];
		retryCount?: number;
	},
): boolean {
	try {
		const lower = condition.toLowerCase().trim();

		if (lower.includes("complexity >=")) {
			const tiers = ["S", "M", "L", "XL"];
			const val = lower.split("complexity >=")[1].trim().toUpperCase();
			const taskIdx = tiers.indexOf(task.complexity ?? "M");
			const threshIdx = tiers.indexOf(val);
			return threshIdx >= 0 && taskIdx >= threshIdx;
		}
		if (lower.includes("complexity ==")) {
			const val = lower.split("complexity ==")[1].trim().toUpperCase();
			return task.complexity === val;
		}
		if (lower.includes("title contains")) {
			const val = lower.split("title contains")[1].trim();
			return task.title.toLowerCase().includes(val);
		}
		if (lower.includes("branch ==")) {
			const val = lower.split("branch ==")[1].trim();
			return (task.branch ?? "").toLowerCase() === val;
		}
		if (lower.includes("description contains")) {
			const val = lower.split("description contains")[1].trim();
			return task.description.toLowerCase().includes(val);
		}
		if (lower.includes("assigned_agent ==")) {
			const val = lower.split("assigned_agent ==")[1].trim();
			return (task.assignedAgent ?? "").toLowerCase() === val;
		}
		if (lower.includes("target_files contains")) {
			const val = lower.split("target_files contains")[1].trim();
			const files = task.targetFiles ?? [];
			return Array.isArray(files) && files.some((f) => f.toLowerCase().includes(val));
		}
		if (lower.includes("retry_count >=")) {
			const val = Number.parseInt(lower.split("retry_count >=")[1].trim(), 10);
			return !isNaN(val) && (task.retryCount ?? 0) >= val;
		}

		return false;
	} catch {
		return false;
	}
}

/**
 * Parse policies from a raw JSON string (project_settings value).
 * Returns an empty array if missing or malformed.
 */
export function parsePolicies(raw: string | undefined): Array<{
	id: string;
	projectId?: string;
	actionType?: string;
	riskLevel?: string;
	requiresApproval?: boolean;
	autoApprove?: boolean;
	maxPerRun?: number;
	description?: string;
	enabled?: boolean;
	name?: string;
	condition?: string;
	action?: string;
}> {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed?.rules)) return parsed.rules;
		if (Array.isArray(parsed)) return parsed;
		return [];
	} catch {
		return [];
	}
}

/**
 * Evaluate all enabled policies against a task.
 * Pure function — no side effects. Returns evaluation result.
 */
export function evaluatePolicyRules(
	task: {
		complexity?: string;
		requiresApproval?: boolean;
		approvalStatus?: string | null;
		title: string;
		targetFiles?: string[];
		branch?: string;
		description: string;
		assignedAgent?: string;
		retryCount?: number;
	},
	settingsMap: Record<string, Record<string, string>>,
	customRules: Array<{ condition?: string; action?: string; enabled?: boolean; name?: string }>,
): PolicyEvaluationResult {
	const violations: string[] = [];
	let blocked = false;

	// Evaluate built-in rules
	const builtinRuleNames = [BUILTIN_RULE_MAX_COST, BUILTIN_RULE_LARGE_APPROVAL, BUILTIN_RULE_MULTI_REVIEWER];
	for (const ruleName of builtinRuleNames) {
		const violation = evaluateBuiltinRule(ruleName, task, settingsMap);
		if (violation) {
			violations.push(violation);
			if (ruleName === BUILTIN_RULE_MAX_COST) blocked = true;
		}
	}

	// Evaluate custom rules
	for (const rule of customRules) {
		if (!rule.enabled) continue;
		const matched = rule.condition ? evaluateCustomCondition(rule.condition, task) : false;
		if (matched) {
			violations.push(`Policy "${rule.name}": ${rule.condition}`);
			if (rule.action === "block") blocked = true;
		}
	}

	return { allowed: !blocked, violations, blocked };
}