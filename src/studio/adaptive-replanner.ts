// ---------------------------------------------------------------------------
// Oscorpex — Adaptive Replanner
// Re-evaluates future work after key outcomes (phase end, repeated failures,
// design drift). Produces auditable plan diffs without full reset.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
	getLatestPlan,
	listPhases,
	listProjectTasks,
	getProjectSetting,
	createTask,
	updateTask,
	query,
	queryOne,
	execute,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import type { Task } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplanTrigger =
	| "phase_end"
	| "repeated_review_failure"
	| "repeated_provider_failure"
	| "injection_threshold"
	| "design_drift"
	| "manual";

export type PatchAction = "add_task" | "remove_task" | "modify_task" | "reorder" | "defer_phase";

export interface PlanPatchEntry {
	action: PatchAction;
	targetId?: string;
	payload: Record<string, unknown>;
	riskLevel: "low" | "medium" | "high";
	reason: string;
}

export interface ReplanResult {
	id: string;
	projectId: string;
	trigger: ReplanTrigger;
	patchEntries: PlanPatchEntry[];
	autoApplied: number;
	pendingApproval: number;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Plan diff persistence
// ---------------------------------------------------------------------------

export async function recordReplanEvent(params: {
	projectId: string;
	trigger: ReplanTrigger;
	patchEntries: PlanPatchEntry[];
	autoApplied: number;
	pendingApproval: number;
}): Promise<ReplanResult> {
	const id = randomUUID();
	await execute(
		`INSERT INTO replan_events (id, project_id, trigger, patch_entries, auto_applied, pending_approval)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[id, params.projectId, params.trigger, JSON.stringify(params.patchEntries), params.autoApplied, params.pendingApproval],
	);
	return { id, ...params, createdAt: new Date().toISOString() };
}

export async function listReplanEvents(projectId: string, limit = 20): Promise<ReplanResult[]> {
	const rows = await query(
		`SELECT * FROM replan_events WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
		[projectId, limit],
	);
	return rows.map((r) => ({
		id: r.id as string,
		projectId: r.project_id as string,
		trigger: r.trigger as ReplanTrigger,
		patchEntries: (r.patch_entries as PlanPatchEntry[]) ?? [],
		autoApplied: r.auto_applied as number,
		pendingApproval: r.pending_approval as number,
		createdAt: r.created_at as string,
	}));
}

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

export interface ReplanContext {
	projectId: string;
	trigger: ReplanTrigger;
	phaseId?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Detect if a replan is warranted based on current project state.
 * Called at phase boundaries and after repeated failures.
 */
export async function shouldReplan(projectId: string, trigger: ReplanTrigger): Promise<boolean> {
	// Check if replanning is enabled for this project
	const setting = await getProjectSetting(projectId, "replanning", "enabled");
	if (setting === "false") return false;

	// Rate limit: no more than 1 replan per 10 minutes
	const recent = await queryOne(
		`SELECT id FROM replan_events WHERE project_id = $1 AND created_at > now() - interval '10 minutes' LIMIT 1`,
		[projectId],
	);
	if (recent) return false;

	return true;
}

// ---------------------------------------------------------------------------
// Plan analysis — compare planned vs actual state
// ---------------------------------------------------------------------------

interface ProjectStateSnapshot {
	totalTasks: number;
	completedTasks: number;
	failedTasks: number;
	reviewRejections: number;
	queuedTasks: number;
	blockedTasks: number;
	phases: Array<{ id: string; title: string; status: string; taskCount: number; completedCount: number }>;
}

async function snapshotProjectState(projectId: string): Promise<ProjectStateSnapshot> {
	const tasks = await listProjectTasks(projectId);
	const phases = await listPhases(projectId);
	const plan = await getLatestPlan(projectId);

	const completedTasks = tasks.filter((t) => t.status === "done").length;
	const failedTasks = tasks.filter((t) => t.status === "failed").length;
	const reviewRejections = tasks.filter((t) => t.reviewStatus === "rejected").length;
	const queuedTasks = tasks.filter((t) => t.status === "queued").length;
	const blockedTasks = tasks.filter((t) => t.status === "waiting_approval").length;

	const phaseSnapshots = phases.map((p) => {
		const phaseTasks = tasks.filter((t) => t.phaseId === p.id);
		return {
			id: p.id,
			title: p.name,
			status: p.status,
			taskCount: phaseTasks.length,
			completedCount: phaseTasks.filter((t) => t.status === "done").length,
		};
	});

	return {
		totalTasks: tasks.length,
		completedTasks,
		failedTasks,
		reviewRejections,
		queuedTasks,
		blockedTasks,
		phases: phaseSnapshots,
	};
}

// ---------------------------------------------------------------------------
// Patch generation — propose plan changes
// ---------------------------------------------------------------------------

function generatePatches(snapshot: ProjectStateSnapshot, trigger: ReplanTrigger): PlanPatchEntry[] {
	const patches: PlanPatchEntry[] = [];

	// If too many failures, defer remaining tasks in struggling phases
	for (const phase of snapshot.phases) {
		if (phase.status === "running" || phase.status === "pending") {
			const failureRatio = snapshot.failedTasks / Math.max(snapshot.totalTasks, 1);

			if (failureRatio > 0.5 && trigger === "repeated_review_failure") {
				patches.push({
					action: "defer_phase",
					targetId: phase.id,
					payload: { phaseId: phase.id, phaseTitle: phase.title },
					riskLevel: "medium",
					reason: `High failure ratio (${Math.round(failureRatio * 100)}%) — deferring remaining tasks in "${phase.title}"`,
				});
			}
		}
	}

	// If injection threshold exceeded, suggest consolidation
	if (trigger === "injection_threshold") {
		patches.push({
			action: "reorder",
			payload: { action: "consolidate_injected_tasks" },
			riskLevel: "low",
			reason: "Task injection threshold exceeded — consolidating injected tasks into next phase",
		});
	}

	return patches;
}

// ---------------------------------------------------------------------------
// Apply patches
// ---------------------------------------------------------------------------

async function applyPatch(projectId: string, patch: PlanPatchEntry): Promise<boolean> {
	switch (patch.action) {
		case "remove_task": {
			if (patch.targetId) {
				await updateTask(patch.targetId, { status: "cancelled" } as any);
			}
			return true;
		}
		case "defer_phase": {
			// Defer all queued tasks in the phase
			const phaseId = patch.payload.phaseId as string;
			if (phaseId) {
				const tasks = await listProjectTasks(projectId);
				const queuedInPhase = tasks.filter((t) => t.phaseId === phaseId && t.status === "queued");
				for (const t of queuedInPhase) {
					await updateTask(t.id, { status: "deferred" } as any);
				}
			}
			return true;
		}
		case "add_task": {
			const p = patch.payload as { phaseId: string; title: string; description: string; assignedAgent: string };
			if (p.phaseId && p.title) {
				await createTask({
					phaseId: p.phaseId,
					title: p.title,
					description: p.description ?? "",
					assignedAgent: p.assignedAgent ?? "tech_lead",
					complexity: "S",
					dependsOn: [],
					branch: "main",
					projectId,
				});
			}
			return true;
		}
		default:
			return false;
	}
}

// ---------------------------------------------------------------------------
// Main entry — evaluate and apply replanning
// ---------------------------------------------------------------------------

export async function evaluateReplan(ctx: ReplanContext): Promise<ReplanResult | null> {
	const canReplan = await shouldReplan(ctx.projectId, ctx.trigger);
	if (!canReplan) return null;

	const snapshot = await snapshotProjectState(ctx.projectId);
	const patches = generatePatches(snapshot, ctx.trigger);

	if (patches.length === 0) return null;

	let autoApplied = 0;
	let pendingApproval = 0;

	for (const patch of patches) {
		if (patch.riskLevel === "low") {
			const applied = await applyPatch(ctx.projectId, patch);
			if (applied) autoApplied++;
		} else {
			pendingApproval++;
		}
	}

	const result = await recordReplanEvent({
		projectId: ctx.projectId,
		trigger: ctx.trigger,
		patchEntries: patches,
		autoApplied,
		pendingApproval,
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "plan:replanned",
		payload: {
			trigger: ctx.trigger,
			patchCount: patches.length,
			autoApplied,
			pendingApproval,
		},
	});

	return result;
}
