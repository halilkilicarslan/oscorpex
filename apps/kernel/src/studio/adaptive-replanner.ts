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
import { createLogger } from "./logger.js";
const log = createLogger("adaptive-replanner");

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
	status: "pending" | "applied" | "rejected";
	approvedBy?: string;
	rejectedReason?: string;
	appliedAt?: string;
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
	status: ReplanResult["status"];
	approvedBy?: string;
	rejectedReason?: string;
	appliedAt?: string;
}): Promise<ReplanResult> {
	const id = randomUUID();
	await execute(
		`INSERT INTO replan_events (id, project_id, trigger, patch_entries, auto_applied, pending_approval, status, approved_by, rejected_reason, applied_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			id,
			params.projectId,
			params.trigger,
			JSON.stringify(params.patchEntries),
			params.autoApplied,
			params.pendingApproval,
			params.status,
			params.approvedBy ?? null,
			params.rejectedReason ?? null,
			params.appliedAt ?? null,
		],
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
		status: (r.status as ReplanResult["status"]) ?? "applied",
		approvedBy: (r.approved_by as string) ?? undefined,
		rejectedReason: (r.rejected_reason as string) ?? undefined,
		appliedAt: (r.applied_at as string) ?? undefined,
		createdAt: r.created_at as string,
	}));
}

export async function getReplanEvent(id: string): Promise<ReplanResult | null> {
	const row = await queryOne(`SELECT * FROM replan_events WHERE id = $1`, [id]);
	if (!row) return null;
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		trigger: row.trigger as ReplanTrigger,
		patchEntries: (row.patch_entries as PlanPatchEntry[]) ?? [],
		autoApplied: row.auto_applied as number,
		pendingApproval: row.pending_approval as number,
		status: (row.status as ReplanResult["status"]) ?? "applied",
		approvedBy: (row.approved_by as string) ?? undefined,
		rejectedReason: (row.rejected_reason as string) ?? undefined,
		appliedAt: (row.applied_at as string) ?? undefined,
		createdAt: row.created_at as string,
	};
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
	staleQueuedTasks: number;
	oldestQueuedMinutes: number;
	blockedTasks: number;
	queueRatio: number;
	blockRatio: number;
	phases: Array<{ id: string; title: string; status: string; taskCount: number; completedCount: number }>;
}

async function snapshotProjectState(projectId: string): Promise<ProjectStateSnapshot> {
	const tasks = await listProjectTasks(projectId);
	const plan = await getLatestPlan(projectId);
	const phases = plan ? await listPhases(plan.id) : [];

	const completedTasks = tasks.filter((t) => t.status === "done").length;
	const failedTasks = tasks.filter((t) => t.status === "failed").length;
	const reviewRejections = tasks.filter((t) => t.reviewStatus === "rejected").length;
	const queuedTasks = tasks.filter((t) => t.status === "queued").length;
	const queuedWithAge = tasks
		.filter((t) => t.status === "queued")
		.map((t) => {
			const createdAtMs = t.createdAt ? Date.parse(t.createdAt) : Number.NaN;
			const ageMs = Number.isFinite(createdAtMs) ? Math.max(0, Date.now() - createdAtMs) : 0;
			return { task: t, ageMs };
		});
	const staleQueuedTasks = queuedWithAge.filter((x) => x.ageMs >= 15 * 60 * 1000).length;
	const oldestQueuedMinutes =
		queuedWithAge.length > 0 ? Math.floor(Math.max(...queuedWithAge.map((x) => x.ageMs)) / (60 * 1000)) : 0;
	const blockedTasks = tasks.filter((t) => t.status === "blocked" || t.status === "waiting_approval").length;

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

	const total = Math.max(tasks.length, 1);
	return {
		totalTasks: tasks.length,
		completedTasks,
		failedTasks,
		reviewRejections,
		queuedTasks,
		staleQueuedTasks,
		oldestQueuedMinutes,
		blockedTasks,
		queueRatio: queuedTasks / total,
		blockRatio: blockedTasks / total,
		phases: phaseSnapshots,
	};
}

async function hasOpenQueueTriageTask(projectId: string, phaseId: string): Promise<boolean> {
	const row = await queryOne<{ id: string }>(
		`SELECT t.id
		 FROM tasks t
		 JOIN phases ph ON ph.id = t.phase_id
		 JOIN project_plans pp ON pp.id = ph.plan_id
		 WHERE pp.project_id = $1
		   AND t.phase_id = $2
		   AND t.title = 'Triage queued task bottleneck'
		   AND t.status IN ('queued', 'assigned', 'running', 'review', 'revision', 'waiting_approval', 'blocked')
		 LIMIT 1`,
		[projectId, phaseId],
	);
	return !!row;
}

async function autoCloseResolvedQueueTriageTasks(projectId: string): Promise<number> {
	const rows = await query<{ id: string }>(
		`SELECT t.id
		 FROM tasks t
		 JOIN phases ph ON ph.id = t.phase_id
		 JOIN project_plans pp ON pp.id = ph.plan_id
		 WHERE pp.project_id = $1
		   AND t.title = 'Triage queued task bottleneck'
		   AND t.status IN ('queued', 'assigned', 'running', 'review', 'revision', 'waiting_approval', 'blocked')`,
		[projectId],
	);
	let closed = 0;
	for (const row of rows) {
		await updateTask(row.id, {
			status: "done",
			completedAt: new Date().toISOString(),
			output: {
				filesCreated: [],
				filesModified: [],
				logs: ["Queue pressure normalized; triage task auto-closed."],
			},
		});
		closed++;
	}
	return closed;
}

// ---------------------------------------------------------------------------
// Patch generation — propose plan changes
// ---------------------------------------------------------------------------

function generatePatches(
	snapshot: ProjectStateSnapshot,
	trigger: ReplanTrigger,
	options?: { canAddQueueTriage?: boolean },
): PlanPatchEntry[] {
	const patches: PlanPatchEntry[] = [];
	const futurePhase = snapshot.phases.find((phase) => phase.status === "running" || phase.status === "pending");

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

	if (trigger === "phase_end" && futurePhase && snapshot.reviewRejections > 0) {
		patches.push({
			action: "add_task",
			payload: {
				phaseId: futurePhase.id,
				title: "Address review findings before next phase",
				description: `Review rejections detected (${snapshot.reviewRejections}). Validate unresolved concerns before downstream execution.`,
				assignedAgent: "tech-lead",
			},
			riskLevel: "medium",
			reason: `Phase ended with ${snapshot.reviewRejections} rejected review cycle(s) — add stabilization follow-up.`,
		});
	}

	// If injection threshold exceeded, suggest consolidation
	if (trigger === "injection_threshold" && futurePhase) {
		patches.push({
			action: "add_task",
			payload: {
				phaseId: futurePhase.id,
				title: "Consolidate injected task backlog",
				description: "Review and consolidate agent-injected tasks before continuing execution.",
				assignedAgent: "tech-lead",
			},
			riskLevel: "low",
			reason: "Task injection threshold exceeded — add explicit consolidation checkpoint",
		});
	}

	// Queue bottleneck: too many tasks stuck in queued state
	const canAddQueueTriage = options?.canAddQueueTriage ?? true;
	if (
		trigger === "phase_end" &&
		futurePhase &&
		canAddQueueTriage &&
		snapshot.queueRatio > 0.4 &&
		snapshot.oldestQueuedMinutes >= 15
	) {
		patches.push({
			action: "add_task",
			payload: {
				phaseId: futurePhase.id,
				title: "Triage queued task bottleneck",
				description: `Queue ratio is ${Math.round(snapshot.queueRatio * 100)}% and oldest queued task is ${snapshot.oldestQueuedMinutes}m old. Review blocked dependencies and reassign stalled tasks.`,
				assignedAgent: "tech-lead",
				testExpectation: "none",
			},
			riskLevel: "low",
			reason: `Queue bottleneck detected (${snapshot.queuedTasks}/${snapshot.totalTasks} queued, oldest=${snapshot.oldestQueuedMinutes}m) — add triage task.`,
		});
	}

	// Provider failure: defer active phase until provider recovers
	if (trigger === "repeated_provider_failure" && futurePhase) {
		patches.push({
			action: "defer_phase",
			targetId: futurePhase.id,
			payload: { phaseId: futurePhase.id, phaseTitle: futurePhase.title },
			riskLevel: "medium",
			reason: "Repeated provider failures — deferring phase until provider recovery.",
		});
	}

	// Blocked tasks: too many tasks waiting on dependencies or approval
	if (trigger === "phase_end" && futurePhase && snapshot.blockedTasks > 3) {
		patches.push({
			action: "add_task",
			payload: {
				phaseId: futurePhase.id,
				title: "Resolve blocked task dependencies",
				description: `${snapshot.blockedTasks} tasks are blocked/waiting_approval. Review and unblock before proceeding.`,
				assignedAgent: "tech-lead",
			},
			riskLevel: "low",
			reason: `${snapshot.blockedTasks} blocked tasks — add dependency resolution sweep.`,
		});
	}

	// Design drift: modify task complexity when drift detected
	if (trigger === "design_drift" && snapshot.phases.length > 0) {
		const runningPhase = snapshot.phases.find((p) => p.status === "running");
		if (runningPhase) {
			patches.push({
				action: "modify_task",
				targetId: runningPhase.id,
				payload: { complexity: "L" },
				riskLevel: "medium",
				reason: "Design drift detected — escalating remaining work complexity.",
			});
		}
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
				await updateTask(patch.targetId, { status: "cancelled" });
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
					await updateTask(t.id, { status: "deferred" });
				}
			}
			return true;
		}
		case "add_task": {
			const p = patch.payload as {
				phaseId: string;
				title: string;
				description: string;
				assignedAgent: string;
				testExpectation?: Task["testExpectation"];
			};
			if (p.phaseId && p.title) {
				await createTask({
					phaseId: p.phaseId,
					title: p.title,
					description: p.description ?? "",
					assignedAgent: p.assignedAgent ?? "tech_lead",
					complexity: "S",
					dependsOn: [],
					branch: "main",
					testExpectation: p.testExpectation ?? "optional",
					projectId,
				});
			}
			return true;
		}
		case "modify_task": {
			if (patch.targetId) {
				const updates: Record<string, unknown> = {};
				if (patch.payload.complexity) updates.complexity = patch.payload.complexity;
				if (patch.payload.assignedAgent) updates.assignedAgent = patch.payload.assignedAgent;
				if (patch.payload.title) updates.title = patch.payload.title;
				if (patch.payload.description) updates.description = patch.payload.description;
				if (Object.keys(updates).length > 0) {
					await updateTask(patch.targetId, updates as any);
				}
			}
			return true;
		}
		case "reorder": {
			if (patch.targetId && Array.isArray(patch.payload.dependsOn)) {
				await updateTask(patch.targetId, { dependsOn: patch.payload.dependsOn as string[] });
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
	const futurePhase = snapshot.phases.find((phase) => phase.status === "running" || phase.status === "pending");
	const queuePressureNormalized = snapshot.queueRatio < 0.25 || snapshot.queuedTasks === 0;
	if (ctx.trigger === "phase_end" && queuePressureNormalized) {
		const closed = await autoCloseResolvedQueueTriageTasks(ctx.projectId);
		if (closed > 0) {
			log.info(`[adaptive-replanner] Queue normalized — auto-closed ${closed} triage task(s)`);
		}
	}
	const canAddQueueTriage =
		!futurePhase ? false : !(await hasOpenQueueTriageTask(ctx.projectId, futurePhase.id));
	const patches = generatePatches(snapshot, ctx.trigger, { canAddQueueTriage });

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
		status: pendingApproval > 0 ? "pending" : "applied",
		appliedAt: pendingApproval > 0 ? undefined : new Date().toISOString(),
	});

	eventBus.emit({
		projectId: ctx.projectId,
		type: "plan:replanned",
		payload: {
			trigger: ctx.trigger,
			patchCount: patches.length,
			autoApplied,
			pendingApproval,
			replanEventId: result.id,
			patchSummary: patches.map((p) => ({ action: p.action, targetId: p.targetId, riskLevel: p.riskLevel })),
		},
	});

	return result;
}

export async function approveReplanEvent(eventId: string, approvedBy: string): Promise<ReplanResult> {
	const event = await getReplanEvent(eventId);
	if (!event) throw new Error(`Replan event ${eventId} not found`);
	if (event.status !== "pending") return event;

	let autoApplied = event.autoApplied;
	for (const patch of event.patchEntries) {
		if (patch.riskLevel === "low") continue;
		const applied = await applyPatch(event.projectId, patch);
		if (applied) autoApplied++;
	}

	await execute(
		`UPDATE replan_events
		 SET status = 'applied', approved_by = $2, applied_at = now(), auto_applied = $3
		 WHERE id = $1`,
		[eventId, approvedBy, autoApplied],
	);

	const updated = await getReplanEvent(eventId);
	if (!updated) throw new Error(`Replan event ${eventId} disappeared after approval`);

	eventBus.emit({
		projectId: updated.projectId,
		type: "plan:replanned",
		payload: {
			trigger: updated.trigger,
			patchCount: updated.patchEntries.length,
			autoApplied: updated.autoApplied,
			pendingApproval: 0,
			approvedBy,
			replanEventId: updated.id,
		},
	});

	return updated;
}

export async function rejectReplanEvent(eventId: string, reason: string): Promise<ReplanResult> {
	const event = await getReplanEvent(eventId);
	if (!event) throw new Error(`Replan event ${eventId} not found`);
	if (event.status !== "pending") return event;

	await execute(
		`UPDATE replan_events
		 SET status = 'rejected', rejected_reason = $2
		 WHERE id = $1`,
		[eventId, reason],
	);

	const updated = await getReplanEvent(eventId);
	if (!updated) throw new Error(`Replan event ${eventId} disappeared after rejection`);
	return updated;
}
