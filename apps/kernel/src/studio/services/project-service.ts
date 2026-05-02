// ---------------------------------------------------------------------------
// Oscorpex — Project Service
// Encapsulates multi-step project operations that were previously inline in routes.
// ---------------------------------------------------------------------------

import { createProject, getProject, listProjectAgents, updateProject } from "../db.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import type { Project } from "../types.js";

const log = createLogger("project-service");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
	name: string;
	description?: string;
	repoPath?: string;
	tenantId?: string;
	ownerId?: string;
	techStack?: string[];
}

export interface ValidationResult {
	valid: boolean;
	error?: string;
	project?: Project;
}

// ---------------------------------------------------------------------------
// createProjectWithDefaults
// ---------------------------------------------------------------------------

/**
 * Create a project record and emit a lifecycle event.
 *
 * Extracts the multi-step creation flow from project-crud-routes so that the
 * route handler is reduced to HTTP concerns only.  Repo-path setup and tool
 * initialisation (git, lint, sonar) still happen in the route because they
 * carry side-effects that depend on the file-system context; this function
 * covers only the DB write + event emission portion.
 */
export async function createProjectWithDefaults(data: CreateProjectInput): Promise<Project> {
	const project = await createProject({
		name: data.name,
		description: data.description ?? "",
		repoPath: data.repoPath ?? "",
		tenantId: data.tenantId,
		ownerId: data.ownerId,
		techStack: data.techStack ?? [],
	});

	log.info({ projectId: project.id, name: project.name }, "project created");

	eventBus.emit({
		projectId: project.id,
		type: "lifecycle:transition",
		payload: {
			entityType: "project",
			entityId: project.id,
			fromStatus: null,
			toStatus: "planning",
			reason: "created",
		},
	});

	return project;
}

// ---------------------------------------------------------------------------
// validateProjectForExecution
// ---------------------------------------------------------------------------

/**
 * Validate that a project is in a state that allows execution to be triggered.
 *
 * Returns a discriminated result rather than throwing so that callers (route
 * handlers, tests, or other services) decide how to surface the error.
 *
 * Checks performed:
 *   1. Project exists.
 *   2. Project is not already running.
 *   3. At least one agent is configured for the project.
 */
export async function validateProjectForExecution(projectId: string): Promise<ValidationResult> {
	const project = await getProject(projectId);
	if (!project) {
		return { valid: false, error: "Project not found" };
	}

	if (project.status === "running") {
		return { valid: false, error: "Project is already running" };
	}

	const agents = await listProjectAgents(projectId);
	if (agents.length === 0) {
		return { valid: false, error: "No agents configured — add team members first" };
	}

	return { valid: true, project };
}

// ---------------------------------------------------------------------------
// updateProjectRepoPath
// ---------------------------------------------------------------------------

/**
 * Persist the resolved repository path after the file-system setup succeeds.
 *
 * Thin wrapper kept here so that route handlers never import updateProject
 * directly for this operation, keeping the service as the single place to
 * adjust project post-creation fields.
 */
export async function updateProjectRepoPath(projectId: string, repoPath: string): Promise<Project | undefined> {
	return updateProject(projectId, { repoPath });
}
