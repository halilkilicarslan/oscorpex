// ---------------------------------------------------------------------------
// Oscorpex — Task Session Inspector Service
// Assembles a read-only inspector payload from existing runtime data.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import {
	getAgentForInspector,
	getSessionForTask,
	getTaskForInspector,
	listEpisodesForTask,
	listEventsForTask,
	listTaskDiffs,
	listTokenUsageForTask,
	listVerificationResults,
} from "../db/inspector-repo.js";
import {
	buildTimeline,
	buildWarnings,
	mapAgent,
	mapExecution,
	mapGates,
	mapObservations,
	mapOutput,
	mapSession,
	mapStrategy,
	mapTask,
	mapUsage,
} from "./task-session-inspector-mappers.js";
import type { TaskSessionInspector } from "./task-session-inspector-types.js";

const log = createLogger("task-session-inspector");

export async function getTaskSessionInspector(
	projectId: string,
	taskId: string,
): Promise<TaskSessionInspector | null> {
	// 1. Fetch task — required
	const taskRow = await getTaskForInspector(taskId);
	if (!taskRow) {
		log.info({ projectId, taskId }, "task not found");
		return null;
	}

	// Verify project ownership
	if (taskRow.project_id !== projectId) {
		log.warn({ projectId, taskId }, "task does not belong to project");
		return null;
	}

	// 2. Fetch optional data in parallel
	const [sessionRow, usageRows, events, episodes, diffs, verifications] = await Promise.all([
		getSessionForTask(projectId, taskId),
		listTokenUsageForTask(taskId),
		listEventsForTask(projectId, taskId),
		listEpisodesForTask(projectId, taskId),
		listTaskDiffs(taskId),
		listVerificationResults(taskId),
	]);

	// 3. Resolve agent
	const agentIdOrRole = (taskRow.assigned_agent_id as string) ?? (taskRow.assigned_agent as string);
	let agentRow: Record<string, unknown> | undefined;
	if (agentIdOrRole) {
		agentRow = await getAgentForInspector(projectId, agentIdOrRole);
	}

	// 4. Assemble inspector payload
	const task = mapTask(taskRow);
	const agent = agentRow ? mapAgent(agentRow) : undefined;
	const session = sessionRow ? mapSession(sessionRow) : undefined;
	const strategy = mapStrategy(sessionRow, events);
	const execution = mapExecution(episodes);
	const usage = mapUsage(usageRows);
	const output = mapOutput(taskRow, diffs);
	const gates = mapGates(verifications);
	const timeline = buildTimeline(taskRow, sessionRow, events, episodes, verifications);
	const observations = mapObservations(sessionRow);
	const warnings = buildWarnings(sessionRow, usageRows, episodes);

	return {
		projectId,
		taskId,
		task,
		agent,
		session,
		strategy,
		execution,
		usage,
		output,
		gates,
		timeline,
		observations,
		warnings,
		raw: {
			task: sanitizeRaw(taskRow),
			session: sessionRow ? sanitizeRaw(sessionRow) : undefined,
			usage: usageRows.length > 0 ? usageRows.map(sanitizeRaw) : undefined,
		},
	};
}

// ---------------------------------------------------------------------------
// Sanitize raw data — strip potential secrets
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
	"api_key",
	"apiKey",
	"secret",
	"password",
	"token",
	"encrypted",
	"private_key",
	"privateKey",
	"credential",
	"credentials",
]);

function sanitizeRaw(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			result[key] = "[REDACTED]";
		} else {
			result[key] = value;
		}
	}
	return result;
}
