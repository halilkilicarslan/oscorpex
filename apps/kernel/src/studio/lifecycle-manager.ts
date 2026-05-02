// ---------------------------------------------------------------------------
// Oscorpex — Lifecycle Manager (v3.5)
// Project state machine: validates transitions, triggers hotfixes, emits events
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createTask, getLatestPlan, getProject, listPhases, updateProject } from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { ProjectStatus } from "./types.js";
const log = createLogger("lifecycle-manager");

// ---------------------------------------------------------------------------
// Valid state machine transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
	planning: ["approved", "archived"],
	approved: ["running", "planning"],
	running: ["paused", "completed", "failed"],
	paused: ["running", "failed"],
	completed: ["maintenance", "archived"],
	failed: ["planning", "archived"],
	maintenance: ["archived", "planning"],
	archived: [],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the allowed next states for the given current status.
 */
export function getValidTransitions(currentStatus: ProjectStatus): ProjectStatus[] {
	return VALID_TRANSITIONS[currentStatus] ?? [];
}

/**
 * Transitions a project to a new status, validating the state machine first.
 * Emits a lifecycle:transition event on success.
 *
 * @throws Error if the transition is not allowed or the project doesn't exist
 */
export async function transitionProject(projectId: string, newStatus: ProjectStatus): Promise<void> {
	const project = await getProject(projectId);
	if (!project) {
		throw new Error(`Project ${projectId} not found`);
	}

	const allowed = getValidTransitions(project.status);
	if (!allowed.includes(newStatus)) {
		throw new Error(`Invalid transition: ${project.status} → ${newStatus}. Allowed: [${allowed.join(", ") || "none"}]`);
	}

	await updateProject(projectId, { status: newStatus });

	eventBus.emit({
		projectId,
		type: "lifecycle:transition",
		payload: {
			from: project.status,
			to: newStatus,
			projectName: project.name,
			transitionedAt: new Date().toISOString(),
		},
	});

	log.info(`[lifecycle-manager] Project ${projectId} transitioned: ${project.status} → ${newStatus}`);
}

/**
 * Creates an urgent hotfix task for a project in "completed" or "maintenance" status.
 * Finds the most recent phase and attaches the task there.
 *
 * @returns The created task ID
 * @throws Error if the project is not in a valid state for hotfix or has no plan
 */
export async function triggerHotfix(projectId: string, description: string): Promise<string> {
	const project = await getProject(projectId);
	if (!project) {
		throw new Error(`Project ${projectId} not found`);
	}

	if (project.status !== "completed" && project.status !== "maintenance") {
		throw new Error(`Hotfix requires project in "completed" or "maintenance" status (current: ${project.status})`);
	}

	const plan = await getLatestPlan(projectId);
	if (!plan) {
		throw new Error(`Project ${projectId} has no plan — cannot create hotfix task`);
	}

	const phases = await listPhases(plan.id);
	if (phases.length === 0) {
		throw new Error(`Project ${projectId} plan has no phases — cannot create hotfix task`);
	}

	// Use the last phase as the hotfix container
	const targetPhase = phases[phases.length - 1];

	const hotfixId = randomUUID().slice(0, 8).toUpperCase();
	const task = await createTask({
		phaseId: targetPhase.id,
		title: `[HOTFIX-${hotfixId}] ${description.slice(0, 80)}`,
		description,
		assignedAgent: "tech-lead",
		complexity: "S",
		dependsOn: [],
		branch: `hotfix/${hotfixId.toLowerCase()}`,
		requiresApproval: true,
	});

	// Transition to maintenance if currently completed
	if (project.status === "completed") {
		await updateProject(projectId, { status: "maintenance" });
		eventBus.emit({
			projectId,
			type: "lifecycle:transition",
			payload: {
				from: "completed",
				to: "maintenance",
				reason: "hotfix triggered",
				hotfixTaskId: task.id,
			},
		});
	}

	eventBus.emit({
		projectId,
		type: "task:assigned",
		taskId: task.id,
		payload: {
			title: task.title,
			hotfix: true,
			hotfixId,
			description,
		},
	});

	log.info(`[lifecycle-manager] Hotfix task created: ${task.id} (project=${projectId})`);

	return task.id;
}
