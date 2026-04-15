// ---------------------------------------------------------------------------
// Oscorpex — Incremental Planner (v3.3)
// Mutate a live plan without creating a brand-new plan version:
//   - appendPhaseToPlan: add a phase after the last phase of the latest plan
//   - appendTaskToPhase: add a task to an existing phase (optionally under a parent)
//   - replanUnfinishedTasks: mark queued/assigned/failed tasks as cancelled so
//     PM can lay down a fresh set of phases/tasks for remaining work
//
// After each mutation we best-effort refresh the pipeline so running projects
// surface the new work without a full restart.
// ---------------------------------------------------------------------------

import {
	createPhase,
	createTask,
	getLatestPlan,
	listProjectAgents,
	updateTask,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import { pipelineEngine } from "./pipeline-engine.js";
import type { Phase, ProjectPlan, Task, TaskComplexity } from "./types.js";

export interface AppendPhaseInput {
	name: string;
	dependsOnPhaseIds?: string[];
}

export interface AppendTaskInput {
	title: string;
	description: string;
	assignedRole: string;
	assignedAgentId?: string;
	complexity: TaskComplexity;
	branch: string;
	dependsOnTaskIds?: string[];
	targetFiles?: string[];
	estimatedLines?: number;
	taskType?: "ai" | "integration-test" | "run-app";
	requiresApproval?: boolean;
	parentTaskId?: string;
}

async function bestEffortRefresh(projectId: string): Promise<void> {
	try {
		await pipelineEngine.refreshPipeline(projectId);
	} catch (err) {
		// Pipeline not running yet or not found — safe to ignore
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("refresh edilemiyor") && !msg.includes("bulunamadı")) {
			console.warn(`[incremental-planner] refreshPipeline failed: ${msg}`);
		}
	}
}

/** Append a phase to the end of the project's latest plan. */
export async function appendPhaseToPlan(
	projectId: string,
	input: AppendPhaseInput,
): Promise<{ plan: ProjectPlan; phase: Phase }> {
	const plan = await getLatestPlan(projectId);
	if (!plan) throw new Error(`No plan found for project ${projectId}`);

	const maxOrder = plan.phases.reduce((m, p) => Math.max(m, p.order), 0);
	const phase = await createPhase({
		planId: plan.id,
		name: input.name,
		order: maxOrder + 1,
		dependsOn: input.dependsOnPhaseIds ?? [],
	});

	eventBus.emit({
		projectId,
		type: "plan:phase_added" as any,
		payload: { planId: plan.id, phaseId: phase.id, name: phase.name, order: phase.order },
	});

	await bestEffortRefresh(projectId);
	return { plan, phase };
}

/** Resolve a role string to an existing project agent id when possible. */
async function resolveAgentId(projectId: string, role: string): Promise<string | undefined> {
	const agents = await listProjectAgents(projectId);
	const lower = role.toLowerCase();
	return (
		agents.find((a) => a.role.toLowerCase() === lower)?.id ??
		agents.find((a) => a.role.toLowerCase().includes(lower))?.id ??
		agents.find((a) => a.name.toLowerCase() === lower)?.id
	);
}

/** Append a task to an existing phase. */
export async function appendTaskToPhase(
	projectId: string,
	phaseId: string,
	input: AppendTaskInput,
): Promise<Task> {
	const plan = await getLatestPlan(projectId);
	if (!plan) throw new Error(`No plan found for project ${projectId}`);

	const phase = plan.phases.find((p) => p.id === phaseId);
	if (!phase) throw new Error(`Phase ${phaseId} not found on latest plan`);

	const assignedAgentId = input.assignedAgentId ?? (await resolveAgentId(projectId, input.assignedRole));

	const task = await createTask({
		phaseId,
		title: input.title,
		description: input.description,
		assignedAgent: assignedAgentId ?? input.assignedRole,
		assignedAgentId,
		complexity: input.complexity,
		dependsOn: input.dependsOnTaskIds ?? [],
		branch: input.branch,
		taskType: input.taskType ?? "ai",
		targetFiles: input.targetFiles ?? [],
		estimatedLines: input.estimatedLines,
		requiresApproval: input.requiresApproval ?? false,
		parentTaskId: input.parentTaskId,
	});

	eventBus.emit({
		projectId,
		type: "task:added" as any,
		taskId: task.id,
		payload: { title: task.title, phaseId, complexity: task.complexity },
	});

	await bestEffortRefresh(projectId);
	return task;
}

export interface ReplanResult {
	cancelledCount: number;
	cancelledTaskIds: string[];
	keptCompletedCount: number;
}

/**
 * Mark all unfinished tasks (queued/assigned/failed) as failed with a
 * "[replanned]" prefix. Completed tasks remain untouched so history + audit
 * is preserved. Caller is expected to follow up with appendPhaseToPlan /
 * appendTaskToPhase to lay down the refreshed work.
 */
export async function replanUnfinishedTasks(
	projectId: string,
	reason: string,
): Promise<ReplanResult> {
	const plan = await getLatestPlan(projectId);
	if (!plan) throw new Error(`No plan found for project ${projectId}`);

	const cancelledTaskIds: string[] = [];
	let keptCompletedCount = 0;

	for (const phase of plan.phases) {
		for (const task of phase.tasks) {
			if (task.status === "done") {
				keptCompletedCount++;
				continue;
			}
			if (task.status === "queued" || task.status === "assigned" || task.status === "failed") {
				await updateTask(task.id, {
					status: "failed",
					error: `[replanned] ${reason}`,
				});
				cancelledTaskIds.push(task.id);
			}
		}
	}

	eventBus.emit({
		projectId,
		type: "plan:replanned" as any,
		payload: { reason, cancelledCount: cancelledTaskIds.length, keptCompletedCount },
	});

	return {
		cancelledCount: cancelledTaskIds.length,
		cancelledTaskIds,
		keptCompletedCount,
	};
}
