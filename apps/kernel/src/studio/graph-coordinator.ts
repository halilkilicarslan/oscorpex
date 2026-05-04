// ---------------------------------------------------------------------------
// Oscorpex — Graph Coordinator: Dynamic DAG mutation at runtime
// Enables agents to insert nodes, split tasks, add/remove edges, defer branches.
// All mutations are auditable via graph_mutations table.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
	createTask,
	getGraphMutation,
	getPipelineRun,
	getTask,
	listGraphMutations,
	listProjectTasks,
	recordGraphMutation,
	updateGraphMutation,
	updateTask,
	type GraphMutationType,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { Task } from "./types.js";

const log = createLogger("graph-coordinator");

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

async function applyInsertNode(
	projectId: string,
	params: {
		phaseId: string;
		title: string;
		description: string;
		assignedAgent: string;
		complexity?: Task["complexity"];
		dependsOn?: string[];
	},
): Promise<{ taskId: string }> {
	const deps = params.dependsOn ?? [];

	const task = await createTask({
		phaseId: params.phaseId,
		title: params.title,
		description: params.description,
		assignedAgent: params.assignedAgent,
		complexity: params.complexity ?? "S",
		dependsOn: deps,
		branch: "main",
		projectId,
	});

	if (deps.length > 0) {
		for (const depId of deps) {
			if (await wouldCreateCycle(depId, task.id, projectId)) {
				throw new GraphInvariantError("cycle", `insertNode: adding dependency ${depId} would create a cycle`);
			}
		}
	}

	return { taskId: task.id };
}

async function applySplitTask(
	projectId: string,
	params: {
		parentTaskId: string;
		children: Array<{
			title: string;
			description: string;
			assignedAgent: string;
			complexity?: Task["complexity"];
		}>;
	},
): Promise<{ parentTaskId: string; childIds: string[] }> {
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
			projectId,
			parentTaskId: parent.id,
		});
		childIds.push(task.id);
	}

	await updateTask(params.parentTaskId, { status: "blocked" });

	// Register child completion listener for parent state propagation
	registerSplitCompletionListener(params.parentTaskId, childIds);

	return { parentTaskId: params.parentTaskId, childIds };
}

/**
 * Propagate child task completion to split parent.
 * All children done → parent done. Any child failed → parent failed.
 */
function registerSplitCompletionListener(parentTaskId: string, childIds: string[]): void {
	const childSet = new Set(childIds);
	let unsubComplete: (() => void) | undefined;
	let unsubFailed: (() => void) | undefined;

	const checkPropagation = async (event: { taskId?: string }) => {
		if (!event.taskId || !childSet.has(event.taskId)) return;

		const children = await Promise.all(childIds.map((id) => getTask(id)));
		const statuses = children.map((c) => c?.status);

		if (statuses.some((s) => s === "failed")) {
			await updateTask(parentTaskId, { status: "failed" });
			unsubComplete?.();
			unsubFailed?.();
			return;
		}

		if (statuses.every((s) => s === "done")) {
			await updateTask(parentTaskId, { status: "done" });
			unsubComplete?.();
			unsubFailed?.();
		}
	};

	unsubComplete = eventBus.on("task:completed", checkPropagation);
	unsubFailed = eventBus.on("task:failed", checkPropagation);
}

async function applyAddEdge(
	params: { fromTaskId: string; toTaskId: string },
	projectId: string,
): Promise<{ fromTaskId: string; toTaskId: string }> {
	await validateAddEdge(params.fromTaskId, params.toTaskId, projectId);

	const toTask = await getTask(params.toTaskId);
	if (!toTask) throw new Error(`Task ${params.toTaskId} not found`);

	const currentDeps = toTask.dependsOn ?? [];
	if (!currentDeps.includes(params.fromTaskId)) {
		await updateTask(params.toTaskId, { dependsOn: [...currentDeps, params.fromTaskId] });
	}
	return params;
}

async function applyRemoveEdge(params: { fromTaskId: string; toTaskId: string }): Promise<{
	fromTaskId: string;
	toTaskId: string;
}> {
	const toTask = await getTask(params.toTaskId);
	if (!toTask) throw new Error(`Task ${params.toTaskId} not found`);

	const currentDeps = toTask.dependsOn ?? [];
	const filtered = currentDeps.filter((d) => d !== params.fromTaskId);
	await updateTask(params.toTaskId, { dependsOn: filtered });
	return params;
}

async function applyDeferBranch(
	projectId: string,
	params: { phaseId: string; reason: string },
): Promise<{ deferredIds: string[]; reason: string }> {
	const tasks = await listProjectTasks(projectId);
	const phaseTasks = tasks.filter((t) => t.phaseId === params.phaseId && t.status === "queued");
	const deferredIds: string[] = [];

	for (const task of phaseTasks) {
		await updateTask(task.id, { status: "deferred" });
		deferredIds.push(task.id);
	}

	return { deferredIds, reason: params.reason };
}

async function applyMergeIntoPhase(
	projectId: string,
	params: {
		sourcePhaseId: string;
		targetPhaseId: string;
		tasks: Array<{ title: string; description: string; assignedAgent: string; complexity?: Task["complexity"] }>;
	},
): Promise<{ createdIds: string[] }> {
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
			projectId,
		});
		createdIds.push(task.id);
	}

	return { createdIds };
}

// ---------------------------------------------------------------------------
// Graph invariant validator — prevents invalid DAG mutations
// ---------------------------------------------------------------------------

export class GraphInvariantError extends Error {
	constructor(
		public readonly violation: "cycle" | "self_edge" | "duplicate_edge" | "task_not_found" | "phase_crossing",
		message: string,
	) {
		super(message);
		this.name = "GraphInvariantError";
	}
}

/**
 * Detect if adding edge fromId→toId would create a cycle.
 * Uses DFS from fromId following existing dependsOn edges.
 * If toId is reachable from fromId, adding toId→fromId creates a cycle.
 */
async function wouldCreateCycle(fromTaskId: string, toTaskId: string, projectId: string): Promise<boolean> {
	// We're adding: toTask.dependsOn += fromTaskId
	// This means toTask depends on fromTask (fromTask must complete before toTask).
	// Cycle exists if fromTask already (transitively) depends on toTask.
	const visited = new Set<string>();
	const stack = [fromTaskId];

	while (stack.length > 0) {
		const current = stack.pop()!;
		if (current === toTaskId) return true;
		if (visited.has(current)) continue;
		visited.add(current);

		const task = await getTask(current);
		if (task?.dependsOn) {
			for (const dep of task.dependsOn) {
				if (!visited.has(dep)) stack.push(dep);
			}
		}
	}
	return false;
}

/**
 * Validate graph invariants before applying an edge mutation.
 * Throws GraphInvariantError if any invariant is violated.
 */
async function validateAddEdge(fromTaskId: string, toTaskId: string, projectId: string): Promise<void> {
	// Self-edge
	if (fromTaskId === toTaskId) {
		throw new GraphInvariantError("self_edge", `Cannot add self-edge on task ${fromTaskId}`);
	}

	// Both tasks must exist
	const [fromTask, toTask] = await Promise.all([getTask(fromTaskId), getTask(toTaskId)]);
	if (!fromTask) throw new GraphInvariantError("task_not_found", `Source task ${fromTaskId} not found`);
	if (!toTask) throw new GraphInvariantError("task_not_found", `Target task ${toTaskId} not found`);

	// Duplicate edge
	if (toTask.dependsOn?.includes(fromTaskId)) {
		throw new GraphInvariantError("duplicate_edge", `Edge ${fromTaskId}→${toTaskId} already exists`);
	}

	// Cycle detection
	if (await wouldCreateCycle(fromTaskId, toTaskId, projectId)) {
		throw new GraphInvariantError("cycle", `Adding edge ${fromTaskId}→${toTaskId} would create a cycle`);
	}
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
	const detail = await applyInsertNode(ctx.projectId, params);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "insert_node",
		payload: { ...detail, phaseId: params.phaseId, title: params.title, dependsOn: params.dependsOn },
		status: "applied",
		appliedAt: new Date().toISOString(),
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: { mutationType: "insert_node", taskId: detail.taskId, title: params.title },
	});

	return { success: true, mutationType: "insert_node", mutationId: mutation.id, detail };
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
	const detail = await applySplitTask(ctx.projectId, params);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "split_task",
		payload: { ...detail, childCount: params.children.length },
		status: "applied",
		appliedAt: new Date().toISOString(),
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: { mutationType: "split_task", ...detail },
	});

	return { success: true, mutationType: "split_task", mutationId: mutation.id, detail };
}

// ---------------------------------------------------------------------------
// Add Edge — create a dependency between tasks
// ---------------------------------------------------------------------------

export async function addEdge(
	ctx: MutationContext,
	params: { fromTaskId: string; toTaskId: string },
): Promise<MutationResult> {
	const detail = await applyAddEdge(params, ctx.projectId);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "add_edge",
		payload: detail,
		status: "applied",
		appliedAt: new Date().toISOString(),
	});

	return { success: true, mutationType: "add_edge", mutationId: mutation.id, detail };
}

// ---------------------------------------------------------------------------
// Remove Edge — drop a dependency between tasks
// ---------------------------------------------------------------------------

export async function removeEdge(
	ctx: MutationContext,
	params: { fromTaskId: string; toTaskId: string },
): Promise<MutationResult> {
	const detail = await applyRemoveEdge(params);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "remove_edge",
		payload: detail,
		status: "applied",
		appliedAt: new Date().toISOString(),
	});

	return { success: true, mutationType: "remove_edge", mutationId: mutation.id, detail };
}

// ---------------------------------------------------------------------------
// Defer Branch — defer all queued tasks in a phase (mark as deferred)
// ---------------------------------------------------------------------------

export async function deferBranch(
	ctx: MutationContext,
	params: { phaseId: string; reason: string },
): Promise<MutationResult> {
	const detail = await applyDeferBranch(ctx.projectId, params);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "defer_branch",
		payload: { phaseId: params.phaseId, deferredTaskIds: detail.deferredIds, reason: detail.reason },
		status: "applied",
		appliedAt: new Date().toISOString(),
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: { mutationType: "defer_branch", phaseId: params.phaseId, deferredCount: detail.deferredIds.length },
	});

	return { success: true, mutationType: "defer_branch", mutationId: mutation.id, detail };
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
	const detail = await applyMergeIntoPhase(ctx.projectId, params);

	const mutation = await recordGraphMutation({
		projectId: ctx.projectId,
		pipelineRunId: ctx.pipelineRunId,
		causedByAgentId: ctx.causedByAgentId,
		mutationType: "merge_into_phase",
		payload: {
			sourcePhaseId: params.sourcePhaseId,
			targetPhaseId: params.targetPhaseId,
			createdTaskIds: detail.createdIds,
		},
		status: "applied",
		appliedAt: new Date().toISOString(),
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "graph:mutation_applied",
		agentId: ctx.causedByAgentId,
		payload: {
			mutationType: "merge_into_phase",
			targetPhaseId: params.targetPhaseId,
			taskCount: detail.createdIds.length,
		},
	});

	return { success: true, mutationType: "merge_into_phase", mutationId: mutation.id, detail };
}

export async function proposeGraphMutation(params: {
	projectId: string;
	causedByAgentId?: string;
	pipelineRunId?: string;
	mutationType: GraphMutationType;
	payload: Record<string, unknown>;
}): Promise<{ mutationId: string }> {
	const run = params.pipelineRunId ? { id: params.pipelineRunId } : await getPipelineRun(params.projectId);
	const mutation = await recordGraphMutation({
		projectId: params.projectId,
		pipelineRunId: run?.id ?? `pending-${params.projectId}`,
		causedByAgentId: params.causedByAgentId,
		mutationType: params.mutationType,
		payload: params.payload,
		status: "pending",
	});

	eventBus.emit({
		projectId: params.projectId,
		type: "graph:mutation_proposed",
		agentId: params.causedByAgentId,
		payload: {
			mutationId: mutation.id,
			mutationType: params.mutationType,
			status: "pending",
		},
	});

	return { mutationId: mutation.id };
}

export async function approveGraphMutationRequest(mutationId: string, approvedBy: string): Promise<MutationResult> {
	const mutation = await getGraphMutation(mutationId);
	if (!mutation) throw new Error(`Graph mutation ${mutationId} not found`);
	if (mutation.status !== "pending") {
		return {
			success: mutation.status === "applied",
			mutationType: mutation.mutationType,
			mutationId: mutation.id,
			detail: mutation.payload,
		};
	}

	// mutation.payload is Record<string,unknown> from DB — cast via unknown to the narrower param types
	type InsertNodeParams = Parameters<typeof applyInsertNode>[1];
	type SplitTaskParams = Parameters<typeof applySplitTask>[1];
	type EdgeParams = Parameters<typeof applyAddEdge>[0];
	type DeferBranchParams = Parameters<typeof applyDeferBranch>[1];
	type MergeIntoPhaseParams = Parameters<typeof applyMergeIntoPhase>[1];

	let detail: Record<string, unknown>;
	switch (mutation.mutationType) {
		case "insert_node":
			detail = await applyInsertNode(mutation.projectId, mutation.payload as unknown as InsertNodeParams);
			break;
		case "split_task":
			detail = await applySplitTask(mutation.projectId, mutation.payload as unknown as SplitTaskParams);
			break;
		case "add_edge":
			detail = await applyAddEdge(mutation.payload as unknown as EdgeParams, mutation.projectId);
			break;
		case "remove_edge":
			detail = await applyRemoveEdge(mutation.payload as unknown as EdgeParams);
			break;
		case "defer_branch":
			detail = await applyDeferBranch(mutation.projectId, mutation.payload as unknown as DeferBranchParams);
			break;
		case "merge_into_phase":
			detail = await applyMergeIntoPhase(mutation.projectId, mutation.payload as unknown as MergeIntoPhaseParams);
			break;
		default:
			throw new Error(`Unsupported pending graph mutation type: ${mutation.mutationType}`);
	}

	await updateGraphMutation(mutation.id, {
		status: "applied",
		approvedBy,
		appliedAt: new Date().toISOString(),
		payload: { ...mutation.payload, appliedDetail: detail },
	});

	eventBus.emit({
		projectId: mutation.projectId,
		type: "graph:mutation_applied",
		agentId: mutation.causedByAgentId,
		payload: {
			mutationId: mutation.id,
			mutationType: mutation.mutationType,
			approvedBy,
			detail,
		},
	});

	const { executionEngine } = await import("./execution-engine.js");
	executionEngine()
		.startProjectExecution(mutation.projectId)
		.catch((err) => log.warn("[graph-coordinator] Non-blocking operation failed:", err?.message ?? err));

	return { success: true, mutationType: mutation.mutationType, mutationId: mutation.id, detail };
}

export async function rejectGraphMutationRequest(mutationId: string, reason: string) {
	const mutation = await getGraphMutation(mutationId);
	if (!mutation) throw new Error(`Graph mutation ${mutationId} not found`);
	if (mutation.status !== "pending") return mutation;

	return updateGraphMutation(mutation.id, {
		status: "rejected",
		rejectedReason: reason,
	});
}

// ---------------------------------------------------------------------------
// Replay — list all mutations for a pipeline run (audit trail)
// ---------------------------------------------------------------------------

export async function getMutationHistory(projectId: string, pipelineRunId: string) {
	return listGraphMutations(projectId, pipelineRunId);
}
