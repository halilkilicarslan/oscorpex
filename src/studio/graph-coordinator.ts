// ---------------------------------------------------------------------------
// Oscorpex — Graph Coordinator: Dynamic DAG mutation at runtime
// Enables agents to insert nodes, split tasks, add/remove edges, defer branches.
// All mutations are auditable via graph_mutations table.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
	createTask,
	getTask,
	updateTask,
	listProjectTasks,
	recordGraphMutation,
	listGraphMutations,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import type { GraphMutationType } from "./db/graph-mutation-repo.js";
import type { Task } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MutationContext {
	projectId: string;
	pipelineRunId: string;
	causedByAgentId?: string;
}

export interface MutationResult {
	success: boolean;
	mutationType: GraphMutationType;
	mutationId: string;
	detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Insert Node — add a new task into an existing phase
// ---------------------------------------------------------------------------

export async function insertNode(
	ctx: MutationContext,
	params: {
		phaseId: string;
		title: string;
		description: string;
		assignedAgent: string;
		complexity?: Task["complexity"];
		dependsOn?: string[];
	},
): Promise<MutationResult> {
	const task = await createTask({
		phaseId: params.phaseId,
		title: params.title,
		description: params.description,
		assignedAgent: params.assignedAgent,
		complexity: params.complexity ?? "S",
		dependsOn: params.dependsOn ?? [],
		branch: "main",
		projectId: ctx.projectId,
	});

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "insert_node",
		payload: { taskId: task.id, phaseId: params.phaseId, title: params.title, dependsOn: params.dependsOn },
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: { mutationType: "insert_node", taskId: task.id, title: params.title },
	});

	return { success: true, mutationType: "insert_node", mutationId: mutation.id, detail: { taskId: task.id } };
}

// ---------------------------------------------------------------------------
// Split Task — decompose a task into children, mark parent as "split"
// ---------------------------------------------------------------------------

export async function splitTask(
	ctx: MutationContext,
	params: {
		parentTaskId: string;
		children: Array<{
			title: string;
			description: string;
			assignedAgent: string;
			complexity?: Task["complexity"];
		}>;
	},
): Promise<MutationResult> {
	const parent = await getTask(params.parentTaskId);
	if (!parent) throw new Error(`Task ${params.parentTaskId} not found`);

	const childIds: string[] = [];

	for (const child of params.children) {
		const task = await createTask({
			phaseId: parent.phaseId,
			title: child.title,
			description: child.description,
			assignedAgent: child.assignedAgent,
			complexity: child.complexity ?? "S",
			dependsOn: [],
			branch: parent.branch ?? "main",
			projectId: ctx.projectId,
			parentTaskId: parent.id,
		});
		childIds.push(task.id);
	}

	// Mark parent as blocked until children complete
	await updateTask(params.parentTaskId, { status: "blocked" } as any);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "split_task",
		payload: { parentTaskId: params.parentTaskId, childIds, childCount: params.children.length },
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: { mutationType: "split_task", parentTaskId: params.parentTaskId, childIds },
	});

	return { success: true, mutationType: "split_task", mutationId: mutation.id, detail: { parentTaskId: params.parentTaskId, childIds } };
}

// ---------------------------------------------------------------------------
// Add Edge — create a dependency between tasks
// ---------------------------------------------------------------------------

export async function addEdge(
	ctx: MutationContext,
	params: { fromTaskId: string; toTaskId: string },
): Promise<MutationResult> {
	const toTask = await getTask(params.toTaskId);
	if (!toTask) throw new Error(`Task ${params.toTaskId} not found`);

	const currentDeps = toTask.dependsOn ?? [];
	if (!currentDeps.includes(params.fromTaskId)) {
		await updateTask(params.toTaskId, { dependsOn: [...currentDeps, params.fromTaskId] } as any);
	}

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "add_edge",
		payload: { fromTaskId: params.fromTaskId, toTaskId: params.toTaskId },
	});

	return { success: true, mutationType: "add_edge", mutationId: mutation.id, detail: params };
}

// ---------------------------------------------------------------------------
// Remove Edge — drop a dependency between tasks
// ---------------------------------------------------------------------------

export async function removeEdge(
	ctx: MutationContext,
	params: { fromTaskId: string; toTaskId: string },
): Promise<MutationResult> {
	const toTask = await getTask(params.toTaskId);
	if (!toTask) throw new Error(`Task ${params.toTaskId} not found`);

	const currentDeps = toTask.dependsOn ?? [];
	const filtered = currentDeps.filter((d) => d !== params.fromTaskId);
	await updateTask(params.toTaskId, { dependsOn: filtered } as any);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "remove_edge",
		payload: { fromTaskId: params.fromTaskId, toTaskId: params.toTaskId },
	});

	return { success: true, mutationType: "remove_edge", mutationId: mutation.id, detail: params };
}

// ---------------------------------------------------------------------------
// Defer Branch — defer all queued tasks in a phase (mark as deferred)
// ---------------------------------------------------------------------------

export async function deferBranch(
	ctx: MutationContext,
	params: { phaseId: string; reason: string },
): Promise<MutationResult> {
	const tasks = await listProjectTasks(ctx.projectId);
	const phaseTasks = tasks.filter((t) => t.phaseId === params.phaseId && t.status === "queued");
	const deferredIds: string[] = [];

	for (const task of phaseTasks) {
		await updateTask(task.id, { status: "deferred" } as any);
		deferredIds.push(task.id);
	}

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "defer_branch",
		payload: { phaseId: params.phaseId, reason: params.reason, deferredTaskIds: deferredIds },
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: { mutationType: "defer_branch", phaseId: params.phaseId, deferredCount: deferredIds.length },
	});

	return { success: true, mutationType: "defer_branch", mutationId: mutation.id, detail: { deferredIds, reason: params.reason } };
}

// ---------------------------------------------------------------------------
// Merge Findings — inject tasks from one phase into a future phase
// ---------------------------------------------------------------------------

export async function mergeIntoPhase(
	ctx: MutationContext,
	params: {
		sourcePhaseId: string;
		targetPhaseId: string;
		tasks: Array<{ title: string; description: string; assignedAgent: string; complexity?: Task["complexity"] }>;
	},
): Promise<MutationResult> {
	const createdIds: string[] = [];

	for (const t of params.tasks) {
		const task = await createTask({
			phaseId: params.targetPhaseId,
			title: t.title,
			description: t.description,
			assignedAgent: t.assignedAgent,
			complexity: t.complexity ?? "S",
			dependsOn: [],
			branch: "main",
			projectId: ctx.projectId,
		});
		createdIds.push(task.id);
	}

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "merge_into_phase",
		payload: { sourcePhaseId: params.sourcePhaseId, targetPhaseId: params.targetPhaseId, createdTaskIds: createdIds },
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: { mutationType: "merge_into_phase", targetPhaseId: params.targetPhaseId, taskCount: createdIds.length },
	});

	return { success: true, mutationType: "merge_into_phase", mutationId: mutation.id, detail: { createdIds } };
}

// ---------------------------------------------------------------------------
// Replay — list all mutations for a pipeline run (audit trail)
// ---------------------------------------------------------------------------

export async function getMutationHistory(projectId: string, pipelineRunId: string) {
	return listGraphMutations(projectId, pipelineRunId);
}
