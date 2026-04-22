// @oscorpex/task-graph — Stage building: DAG-based and linear stage construction
// Pure functions — no DB or event-bus dependencies.

import type { PipelineStage, PipelineStageStatus } from "@oscorpex/core";
import type { DependencyEdge, GraphAgent, PlanPhase, PlanTask, StagePlan } from "./types.js";
import { buildDAGWaves } from "./dag.js";

// ---------------------------------------------------------------------------
// Agent matching utility
// ---------------------------------------------------------------------------

const REVERSE_CATEGORY_MAP: Record<string, string[]> = {
	"backend-dev": ["backend", "backend-developer", "coder"],
	"backend-developer": ["backend", "backend-dev", "coder"],
	"frontend-dev": ["frontend", "frontend-developer"],
	"frontend-developer": ["frontend", "frontend-dev"],
	"backend-qa": ["qa"],
	"frontend-qa": ["qa"],
	"qa-engineer": ["qa"],
	"design-lead": ["design", "designer", "ui-designer"],
	"tech-lead": ["architect", "tech-lead"],
	"scrum-master": ["pm"],
	"product-owner": ["pm"],
	"business-analyst": ["analyst"],
};

export interface AgentMatchSet {
	ids: Set<string>;
	roles: Set<string>;
}

/**
 * Build agent ID and role/name sets for task-to-agent matching.
 * Includes reverse category aliases (e.g. "backend-dev" matches "backend").
 */
export function buildAgentMatchSet(stageAgents: GraphAgent[]): AgentMatchSet {
	const ids = new Set<string>();
	const roles = new Set<string>();

	for (const a of stageAgents) {
		ids.add(a.id);
		if (a.sourceAgentId) ids.add(a.sourceAgentId);
		const roleLower = a.role.toLowerCase();
		roles.add(roleLower);
		roles.add(a.name.toLowerCase());

		const aliases = REVERSE_CATEGORY_MAP[roleLower];
		if (aliases) {
			for (const alias of aliases) roles.add(alias);
		}
		const dashIdx = roleLower.indexOf("-");
		if (dashIdx > 0) {
			roles.add(roleLower.slice(0, dashIdx));
		}
	}
	return { ids, roles };
}

// ---------------------------------------------------------------------------
// Stage builders
// ---------------------------------------------------------------------------

/**
 * Build pipeline stages from a DAG of agent dependencies using Kahn's algorithm.
 * Each wave of agents becomes a stage; tasks are matched to stage agents.
 */
export function buildDAGStages(
	agents: GraphAgent[],
	deps: DependencyEdge[],
	phases: PlanPhase[],
): StagePlan[] {
	const waves = buildDAGWaves(agents, deps);
	const agentMap = new Map(agents.map((a) => [a.id, a]));
	const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
	const usedTaskIds = new Set<string>();

	const allTasks: PlanTask[] = [];
	const reviewTasks: PlanTask[] = [];
	for (const phase of sortedPhases) {
		for (const task of phase.tasks) {
			if (task.title.startsWith("Code Review: ") && task.dependsOn.length > 0) {
				reviewTasks.push(task);
			} else {
				allTasks.push(task);
			}
		}
	}

	const stages = waves.map((waveAgentIds, index) => {
		const waveAgents = waveAgentIds.map((id) => agentMap.get(id)!).filter(Boolean);
		const { ids, roles } = buildAgentMatchSet(waveAgents);

		const stageTasks: PlanTask[] = [];
		let firstMatchedPhaseId: string | undefined;

		for (const task of allTasks) {
			if (usedTaskIds.has(task.id)) continue;
			const assigned = task.assignedAgent ?? "";
			if (ids.has(assigned) || roles.has(assigned.toLowerCase())) {
				stageTasks.push(task);
				usedTaskIds.add(task.id);
				if (!firstMatchedPhaseId) firstMatchedPhaseId = task.phaseId;
			}
		}

		return {
			order: index,
			agents: waveAgents,
			tasks: stageTasks,
			status: "pending" as const,
			phaseId: firstMatchedPhaseId,
		} satisfies StagePlan;
	});

	for (const reviewTask of reviewTasks) {
		if (usedTaskIds.has(reviewTask.id)) continue;
		const depId = reviewTask.dependsOn[0];
		const targetStage = stages.find((s) => s.tasks.some((t) => t.id === depId));
		if (targetStage) {
			targetStage.tasks.push(reviewTask);
			usedTaskIds.add(reviewTask.id);
		} else {
			const last = stages[stages.length - 1];
			if (last) {
				last.tasks.push(reviewTask);
				usedTaskIds.add(reviewTask.id);
			}
		}
	}

	return stages;
}

/**
 * Build linear pipeline stages from agent pipeline_order (backward compat).
 * Groups agents by pipelineOrder, matches tasks to each group.
 */
export function buildLinearStages(agents: GraphAgent[], phases: PlanPhase[]): StagePlan[] {
	const orderGroups = new Map<number, GraphAgent[]>();
	for (const agent of agents) {
		const order = agent.pipelineOrder ?? 0;
		if (!orderGroups.has(order)) orderGroups.set(order, []);
		orderGroups.get(order)!.push(agent);
	}

	const sortedOrders = Array.from(orderGroups.keys()).sort((a, b) => a - b);
	const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
	const usedTaskIds = new Set<string>();

	return sortedOrders.map((order) => {
		const stageAgents = orderGroups.get(order)!;
		const { ids, roles } = buildAgentMatchSet(stageAgents);

		const stageTasks: PlanTask[] = [];
		let firstMatchedPhaseId: string | undefined;

		for (const phase of sortedPhases) {
			for (const task of phase.tasks) {
				if (usedTaskIds.has(task.id)) continue;
				const assigned = task.assignedAgent ?? "";
				if (ids.has(assigned) || roles.has(assigned.toLowerCase())) {
					stageTasks.push(task);
					usedTaskIds.add(task.id);
					if (!firstMatchedPhaseId) firstMatchedPhaseId = phase.id;
				}
			}
		}

		return {
			order,
			agents: stageAgents,
			tasks: stageTasks,
			status: "pending" as const,
			phaseId: firstMatchedPhaseId,
		} satisfies StagePlan;
	});
}