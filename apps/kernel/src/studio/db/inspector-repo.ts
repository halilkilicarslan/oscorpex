// ---------------------------------------------------------------------------
// Oscorpex — Inspector Repository: read-only helpers for task inspector
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import { query, queryOne } from "../pg.js";
const log = createLogger("inspector-repo");

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export async function getTaskForInspector(taskId: string): Promise<Record<string, unknown> | undefined> {
	const row = await queryOne<any>(
		`SELECT t.*, p.project_id
		 FROM tasks t
		 JOIN phases p ON t.phase_id = p.id
		 WHERE t.id = $1`,
		[taskId],
	);
	return row ?? undefined;
}

// ---------------------------------------------------------------------------
// Agent (project agent by ID or role)
// ---------------------------------------------------------------------------

export async function getAgentForInspector(
	projectId: string,
	agentIdOrRole: string,
): Promise<Record<string, unknown> | undefined> {
	// Try by ID first
	const byId = await queryOne<any>(
		`SELECT * FROM project_agents WHERE id = $1 AND project_id = $2`,
		[agentIdOrRole, projectId],
	);
	if (byId) return byId;

	// Fallback: by role
	const byRole = await queryOne<any>(
		`SELECT * FROM project_agents WHERE project_id = $1 AND role = $2 LIMIT 1`,
		[projectId, agentIdOrRole],
	);
	return byRole ?? undefined;
}

// ---------------------------------------------------------------------------
// Session (most recent for task)
// ---------------------------------------------------------------------------

export async function getSessionForTask(
	projectId: string,
	taskId: string,
): Promise<Record<string, unknown> | undefined> {
	const row = await queryOne<any>(
		`SELECT * FROM agent_sessions
		 WHERE project_id = $1 AND task_id = $2
		 ORDER BY created_at DESC LIMIT 1`,
		[projectId, taskId],
	);
	return row ?? undefined;
}

// ---------------------------------------------------------------------------
// Token usage (aggregated per task)
// ---------------------------------------------------------------------------

export async function listTokenUsageForTask(taskId: string): Promise<Record<string, unknown>[]> {
	try {
		return await query<any>(
			`SELECT * FROM token_usage WHERE task_id = $1 ORDER BY created_at ASC`,
			[taskId],
		);
	} catch (err) {
		log.warn({ err }, "token_usage query failed — table may not exist");
		return [];
	}
}

// ---------------------------------------------------------------------------
// Events for task
// ---------------------------------------------------------------------------

export async function listEventsForTask(projectId: string, taskId: string): Promise<Record<string, unknown>[]> {
	try {
		return await query<any>(
			`SELECT * FROM events
			 WHERE project_id = $1 AND task_id = $2
			 ORDER BY timestamp ASC`,
			[projectId, taskId],
		);
	} catch (err) {
		log.warn({ err }, "events query failed");
		return [];
	}
}

// ---------------------------------------------------------------------------
// Episodes for task
// ---------------------------------------------------------------------------

export async function listEpisodesForTask(
	projectId: string,
	taskId: string,
): Promise<Record<string, unknown>[]> {
	try {
		return await query<any>(
			`SELECT * FROM agent_episodes
			 WHERE project_id = $1 AND task_id = $2
			 ORDER BY created_at ASC`,
			[projectId, taskId],
		);
	} catch (err) {
		log.warn({ err }, "agent_episodes query failed");
		return [];
	}
}

// ---------------------------------------------------------------------------
// Task diffs (files changed)
// ---------------------------------------------------------------------------

export async function listTaskDiffs(taskId: string): Promise<Record<string, unknown>[]> {
	try {
		return await query<any>(
			`SELECT file_path, diff_type, lines_added, lines_removed FROM task_diffs
			 WHERE task_id = $1 ORDER BY created_at ASC`,
			[taskId],
		);
	} catch (err) {
		log.warn({ err }, "task_diffs query failed");
		return [];
	}
}

// ---------------------------------------------------------------------------
// Verification results (gates)
// ---------------------------------------------------------------------------

export async function listVerificationResults(taskId: string): Promise<Record<string, unknown>[]> {
	try {
		return await query<any>(
			`SELECT * FROM verification_results WHERE task_id = $1 ORDER BY created_at ASC`,
			[taskId],
		);
	} catch (err) {
		log.warn({ err }, "verification_results query failed");
		return [];
	}
}
