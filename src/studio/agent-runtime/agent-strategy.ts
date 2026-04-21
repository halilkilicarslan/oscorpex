// ---------------------------------------------------------------------------
// Oscorpex — Agent Strategy: Strategy selection and catalog management
// Selects the best strategy for an agent based on role, task type,
// and historical performance patterns.
// ---------------------------------------------------------------------------

import { getBestStrategies, getDefaultStrategy, getStrategiesForRole } from "../db.js";
import type { AgentStrategy, AgentStrategyPattern, Task } from "../types.js";
import { getBehaviorRoleKey } from "../roles.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategySelection {
	strategy: AgentStrategy;
	reason: string;
	confidence: number; // 0-1
}

// ---------------------------------------------------------------------------
// Built-in strategy catalog (seeded on first use if DB is empty)
// ---------------------------------------------------------------------------

export const BUILTIN_STRATEGIES: Omit<AgentStrategy, "id">[] = [
	// Backend
	{ agentRole: "backend-dev", name: "test_first", description: "Write tests before implementation. Start with failing tests, then implement to make them pass.", promptAddendum: "IMPORTANT: Write failing tests FIRST, then implement the code to make them pass. Follow TDD strictly.", allowedTaskTypes: ["ai"], isDefault: false },
	{ agentRole: "backend-dev", name: "scaffold_then_refine", description: "Create the basic structure first, then iterate on details. Get the skeleton working before polishing.", promptAddendum: "Start with a minimal working skeleton. Get the basic structure compiling and running first, then add details and error handling.", allowedTaskTypes: ["ai"], isDefault: true },
	{ agentRole: "backend-dev", name: "minimal_patch", description: "Make the smallest possible change to achieve the goal. Minimize blast radius.", promptAddendum: "Make the MINIMUM change needed. Do not refactor surrounding code. Touch as few files as possible.", allowedTaskTypes: ["ai"], isDefault: false },

	// Frontend
	{ agentRole: "frontend-dev", name: "component_first", description: "Build reusable components before composing pages. Focus on component isolation and reusability.", promptAddendum: "Build isolated, reusable components first. Each component should work standalone before being composed into pages.", allowedTaskTypes: ["ai"], isDefault: true },
	{ agentRole: "frontend-dev", name: "page_shell_then_wire", description: "Create the page layout shell first, then wire up data and interactivity.", promptAddendum: "Start with the page layout and static structure. Get the visual layout right, then add data fetching and interactivity.", allowedTaskTypes: ["ai"], isDefault: false },

	// QA / Reviewer
	{ agentRole: "reviewer", name: "risk_hotspot_review", description: "Focus review on high-risk code paths: auth, data mutation, external integrations.", promptAddendum: "Prioritize reviewing: authentication/authorization code, database mutations, external API calls, and error handling paths. These are the highest-risk areas.", allowedTaskTypes: ["ai"], isDefault: true },
	{ agentRole: "reviewer", name: "test_gap_review", description: "Focus on identifying missing test coverage and untested edge cases.", promptAddendum: "Focus on: Which code paths lack tests? What edge cases are untested? What error scenarios are not covered? Recommend specific tests to add.", allowedTaskTypes: ["ai"], isDefault: false },

	// Tech Lead
	{ agentRole: "tech-lead", name: "spec_contract_first", description: "Define interfaces, types, and contracts before implementation details.", promptAddendum: "Start by defining interfaces, types, and API contracts. Ensure the contract is solid before implementing any logic.", allowedTaskTypes: ["ai"], isDefault: true },

	// DevOps
	{ agentRole: "devops", name: "config_validation_first", description: "Validate all configuration before applying changes. Check for conflicts and compatibility.", promptAddendum: "Before making any infrastructure changes: validate all config values, check for port/resource conflicts, verify compatibility with existing setup.", allowedTaskTypes: ["ai"], isDefault: true },
];

// ---------------------------------------------------------------------------
// Strategy selection
// ---------------------------------------------------------------------------

/**
 * Select the best strategy for an agent about to execute a task.
 * Priority: historical patterns → role catalog → builtin default.
 */
export async function selectStrategy(
	projectId: string,
	agentRole: string,
	task: Task,
): Promise<StrategySelection> {
	const strategyRole = getBehaviorRoleKey(agentRole);
	const taskType = task.taskType ?? "ai";

	// 1. Check historical patterns — use the strategy with highest success rate
	const patterns = await getBestStrategies(projectId, strategyRole, taskType, 1);
	if (patterns.length > 0 && patterns[0].sampleCount >= 3 && patterns[0].successRate >= 0.6) {
		const bestPattern = patterns[0];
		// Find the matching strategy definition
			const strategies = await getStrategiesForRole(strategyRole, taskType);
		const matchingStrategy = strategies.find((s) => s.name === bestPattern.strategy);
		if (matchingStrategy) {
			return {
				strategy: matchingStrategy,
				reason: `Historical best: ${(bestPattern.successRate * 100).toFixed(0)}% success over ${bestPattern.sampleCount} samples`,
				confidence: bestPattern.successRate,
			};
		}
	}

	// 1b. v8.0: Check cross-project learning patterns (weighted lower than project-local)
	try {
		const { getLearningPatterns } = await import("../cross-project-learning.js");
		const { queryOne: qo } = await import("../pg.js");
		const projRow = await qo<{ tenant_id: string | null }>(
			"SELECT tenant_id FROM projects WHERE id = $1",
			[projectId],
		);
		const learningPatterns = await getLearningPatterns(taskType, strategyRole, projRow?.tenant_id ?? undefined);
		if (learningPatterns.length > 0 && learningPatterns[0].sampleCount >= 5 && learningPatterns[0].successRate >= 0.65) {
			const lpBest = learningPatterns[0];
			const strategyName = (lpBest.pattern as { strategy?: string }).strategy;
			if (strategyName) {
				const strategies = await getStrategiesForRole(strategyRole, taskType);
				const match = strategies.find((s) => s.name === strategyName);
				if (match) {
					return {
						strategy: match,
						reason: `Cross-project learning: ${(lpBest.successRate * 100).toFixed(0)}% success (${lpBest.sampleCount} samples, ${lpBest.isGlobal ? "global" : "tenant"})`,
						confidence: lpBest.successRate * 0.8, // 20% discount vs project-local
					};
				}
			}
		}
	} catch {
		// Cross-project learning unavailable — continue with defaults
	}

	// 2. Check role-specific default strategy from DB
	const defaultStrategy = await getDefaultStrategy(strategyRole);
	if (defaultStrategy) {
		return {
			strategy: defaultStrategy,
			reason: "Role default strategy",
			confidence: 0.5,
		};
	}

	// 3. Fallback to builtin
	const builtin = BUILTIN_STRATEGIES.find((s) => s.agentRole === strategyRole && s.isDefault);
	if (builtin) {
		return {
			strategy: { ...builtin, id: `builtin-${strategyRole}-${builtin.name}` },
			reason: "Built-in default strategy",
			confidence: 0.3,
		};
	}

	// 4. Ultimate fallback
	return {
		strategy: {
			id: "builtin-generic",
			agentRole: strategyRole,
			name: "scaffold_then_refine",
			description: "Build basic structure first, then refine",
			allowedTaskTypes: [],
			isDefault: true,
		},
		reason: "Generic fallback",
		confidence: 0.2,
	};
}
