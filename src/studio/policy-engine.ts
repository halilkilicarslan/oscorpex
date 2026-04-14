// ---------------------------------------------------------------------------
// Oscorpex — Policy Engine (v3.7)
// Evaluates configurable governance policies against tasks before execution
// ---------------------------------------------------------------------------

import { getProjectSettingsMap } from "./db.js";
import { eventBus } from "./event-bus.js";
import type { PolicyRule, Task } from "./types.js";

// ---------------------------------------------------------------------------
// Built-in rule names
// ---------------------------------------------------------------------------

const BUILTIN_RULE_MAX_COST = "max_cost_per_task";
const BUILTIN_RULE_LARGE_APPROVAL = "require_approval_for_large";
const BUILTIN_RULE_MULTI_REVIEWER = "multi_reviewer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses policies from a project_settings value (JSON string).
 * Returns an empty array if missing or malformed.
 */
function parsePolicies(raw: string | undefined): PolicyRule[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed?.rules)) return parsed.rules as PolicyRule[];
		if (Array.isArray(parsed)) return parsed as PolicyRule[];
		return [];
	} catch {
		return [];
	}
}

/**
 * Evaluates a built-in policy rule against the task and settings map.
 * Returns a violation message string, or null if the rule passes.
 */
function evaluateBuiltinRule(
	ruleName: string,
	task: Task,
	settingsMap: Record<string, Record<string, string>>,
): string | null {
	switch (ruleName) {
		case BUILTIN_RULE_MAX_COST: {
			const maxCostStr = settingsMap["budget"]?.["maxCostUsd"];
			const maxCost = maxCostStr ? Number.parseFloat(maxCostStr) : null;
			if (maxCost !== null && !Number.isNaN(maxCost)) {
				// We can only flag tasks that explicitly declare an estimated cost;
				// runtime cost enforcement happens in task-engine.ts budget check.
				// This rule blocks tasks with declared budget overrun.
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
		{ id: BUILTIN_RULE_MAX_COST, projectId, name: "Max cost per task", condition: "task.budget > project.maxCost", action: "block", enabled: true },
		{ id: BUILTIN_RULE_LARGE_APPROVAL, projectId, name: "Require approval for large tasks", condition: "task.complexity in [L, XL]", action: "require_approval", enabled: true },
		{ id: BUILTIN_RULE_MULTI_REVIEWER, projectId, name: "Multi-reviewer for sensitive files", condition: "task.targetFiles matches pattern", action: "warn", enabled: true },
	];

	// Merge: custom policies from settings override/supplement builtins
	return [...builtins, ...customPolicies];
}

/**
 * Evaluates all enabled policies against a task.
 *
 * Built-in rules are always evaluated.
 * Custom rules (from project_settings category "policy") are also checked.
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

	const violations: string[] = [];
	let blocked = false;

	// Evaluate built-in rules
	const builtinRuleNames = [BUILTIN_RULE_MAX_COST, BUILTIN_RULE_LARGE_APPROVAL, BUILTIN_RULE_MULTI_REVIEWER];
	for (const ruleName of builtinRuleNames) {
		const violation = evaluateBuiltinRule(ruleName, task, settingsMap as Record<string, Record<string, string>>);
		if (violation) {
			violations.push(violation);
			// "require_approval" and "warn" don't block; only "block" does
			if (ruleName === BUILTIN_RULE_MAX_COST) blocked = true;
		}
	}

	// Evaluate custom rules from project_settings
	for (const rule of customRules) {
		if (!rule.enabled) continue;

		// Custom rule evaluation: condition is a string expression.
		// For safety, we only support a limited set of condition checks.
		const matched = evaluateCustomCondition(rule.condition, task);
		if (matched) {
			violations.push(`Policy "${rule.name}": ${rule.condition}`);
			if (rule.action === "block") blocked = true;
		}
	}

	if (violations.length > 0) {
		eventBus.emit({
			projectId,
			type: "policy:violation",
			taskId: task.id,
			payload: {
				taskTitle: task.title,
				violations,
				blocked,
				evaluatedAt: new Date().toISOString(),
			},
		});
	}

	return { allowed: !blocked, violations };
}

/**
 * Evaluates a simple custom condition string against a task.
 * Supported conditions:
 *   - "complexity == XL"
 *   - "title contains deploy"
 *   - "branch == main"
 */
function evaluateCustomCondition(condition: string, task: Task): boolean {
	try {
		const lower = condition.toLowerCase().trim();

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

		return false;
	} catch {
		return false;
	}
}
