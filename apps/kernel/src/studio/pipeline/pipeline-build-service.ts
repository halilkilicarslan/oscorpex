// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Build Service
// Builds kernel pipeline state from project agents, dependencies, and phases.
// ---------------------------------------------------------------------------

import {
	buildDAGStages,
	buildLinearStages,
} from "@oscorpex/task-graph";
import type { DependencyEdge, GraphAgent, PlanPhase, StagePlan } from "@oscorpex/task-graph";
import {
	getLatestPlan,
	getProject,
	listAgentDependencies,
	listPhases,
	listProjectAgents,
} from "../db.js";
import type {
	AgentDependency,
	Phase,
	PipelineStage,
	PipelineState,
	ProjectAgent,
	Task,
} from "../types.js";

export class PipelineBuildService {
	async buildPipeline(projectId: string): Promise<PipelineState> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

		const agents = await listProjectAgents(projectId);
		const plan = await getLatestPlan(projectId);
		const phases: Phase[] = plan ? await listPhases(plan.id) : [];

		const deps = await listAgentDependencies(projectId);
		const hasDeps = deps.some((d) => d.type !== "hierarchy");

		const stagePlans: StagePlan[] = hasDeps
			? buildDAGStages(toGraphAgents(agents), toDependencyEdges(deps), toPlanPhases(phases))
			: buildLinearStages(toGraphAgents(agents), toPlanPhases(phases));

		const stages: PipelineStage[] = stagePlans.map((sp) => ({
			order: sp.order,
			agents: agents.filter((a) => sp.agents.some((ga) => ga.id === a.id)),
			tasks: toKernelTasks(phases, sp),
			status: sp.status as PipelineStage["status"],
			phaseId: sp.phaseId,
		}));

		return {
			projectId,
			stages,
			currentStage: 0,
			status: "idle",
		};
	}
}

function toGraphAgents(agents: ProjectAgent[]): GraphAgent[] {
	return agents.map((a) => ({
		id: a.id,
		name: a.name,
		role: a.role,
		skills: a.skills,
		sourceAgentId: a.sourceAgentId,
		reportsTo: a.reportsTo,
		pipelineOrder: a.pipelineOrder,
		personality: a.personality,
	}));
}

function toDependencyEdges(deps: AgentDependency[]): DependencyEdge[] {
	return deps.map((d) => ({
		fromAgentId: d.fromAgentId,
		toAgentId: d.toAgentId,
		type: d.type,
		metadata: d.metadata,
	}));
}

function toPlanPhases(phases: Phase[]): PlanPhase[] {
	return phases.map((ph) => ({
		id: ph.id,
		order: ph.order,
		name: ph.name,
		status: ph.status,
		tasks: (ph.tasks ?? []).map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			assignedAgent: t.assignedAgent,
			assignedAgentId: t.assignedAgentId,
			complexity: t.complexity,
			description: t.description,
			targetFiles: t.targetFiles,
			dependsOn: t.dependsOn,
			phaseId: t.phaseId,
			output: t.output,
		})),
	}));
}

function toKernelTasks(phases: Phase[], stagePlan: StagePlan): Task[] {
	const allKernelTasks = phases.flatMap((ph) => ph.tasks ?? []);
	const stageTaskIds = new Set(stagePlan.tasks.map((t) => t.id));
	return allKernelTasks.filter((t) => stageTaskIds.has(t.id));
}
