// ---------------------------------------------------------------------------
// Operator Actions — Service Layer
// All actions directly mutate kernel tables and are audit-logged.
// ---------------------------------------------------------------------------

import { execute, query, queryOne } from "../pg.ts";
import { randomUUID } from "node:crypto";
import { appendAuditEvent } from "../audit/repo.ts";
import type { OperatorActionRequest, OperatorActionResult, OperatorActionRow, OperatorFlagRow } from "./index.ts";

export { type OperatorActionRequest, type OperatorActionResult, type OperatorActionRow, type OperatorFlagRow };

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

export async function disableProvider(providerId: string, actor: string, reason: string): Promise<OperatorActionResult> {
	await execute(
		"UPDATE provider_runtime_registry SET status = 'unavailable', updated_at = now() WHERE id = $1",
		[providerId],
	);
	return logAction({ actionType: "provider_disable", targetId: providerId, targetType: "provider", actor, reason });
}

export async function enableProvider(providerId: string, actor: string, reason: string): Promise<OperatorActionResult> {
	await execute(
		"UPDATE provider_runtime_registry SET status = 'available', updated_at = now() WHERE id = $1",
		[providerId],
	);
	return logAction({ actionType: "provider_enable", targetId: providerId, targetType: "provider", actor, reason });
}

export async function retryTask(taskId: string, actor: string, reason: string): Promise<OperatorActionResult> {
	await execute(
		`UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
		 retry_count = retry_count + 1, error = NULL, completed_at = NULL
		 WHERE id = $1`,
		[taskId],
	);
	return logAction({ actionType: "retry_task", targetId: taskId, targetType: "task", actor, reason });
}

export async function cancelTask(taskId: string, actor: string, reason: string): Promise<OperatorActionResult> {
	await execute(
		"UPDATE tasks SET status = 'cancelled', completed_at = now() WHERE id = $1",
		[taskId],
	);
	return logAction({ actionType: "cancel_task", targetId: taskId, targetType: "task", actor, reason });
}

export async function pauseQueue(actor: string, reason: string): Promise<OperatorActionResult> {
	await setOperatorFlag("queue-paused", "true", actor, reason);
	return logAction({ actionType: "pause_queue", actor, reason });
}

export async function resumeQueue(actor: string, reason: string): Promise<OperatorActionResult> {
	await setOperatorFlag("queue-paused", "false", actor, reason);
	return logAction({ actionType: "resume_queue", actor, reason });
}

export async function resetCooldown(providerId: string, actor: string, reason: string): Promise<OperatorActionResult> {
	await execute(
		`UPDATE provider_state SET cooldown_until = NULL, consecutive_failures = 0, updated_at = now()
		 WHERE adapter = $1`,
		[providerId],
	);
	await execute(
		"UPDATE provider_runtime_registry SET cooldown_until = NULL, status = 'available', updated_at = now() WHERE id = $1",
		[providerId],
	);
	return logAction({ actionType: "reset_cooldown", targetId: providerId, targetType: "provider", actor, reason });
}

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

export async function executeOperatorAction(req: OperatorActionRequest): Promise<OperatorActionResult> {
	switch (req.actionType) {
		case "provider_disable":
			if (!req.targetId) throw new Error("provider_disable requires targetId");
			return disableProvider(req.targetId, req.actor, req.reason);
		case "provider_enable":
			if (!req.targetId) throw new Error("provider_enable requires targetId");
			return enableProvider(req.targetId, req.actor, req.reason);
		case "retry_task":
			if (!req.targetId) throw new Error("retry_task requires targetId");
			return retryTask(req.targetId, req.actor, req.reason);
		case "cancel_task":
			if (!req.targetId) throw new Error("cancel_task requires targetId");
			return cancelTask(req.targetId, req.actor, req.reason);
		case "pause_queue":
			return pauseQueue(req.actor, req.reason);
		case "resume_queue":
			return resumeQueue(req.actor, req.reason);
		case "reset_cooldown":
			if (!req.targetId) throw new Error("reset_cooldown requires targetId");
			return resetCooldown(req.targetId, req.actor, req.reason);
		default:
			throw new Error(`Unknown action type: ${req.actionType}`);
	}
}

// ---------------------------------------------------------------------------
// Audit & logging helpers
// ---------------------------------------------------------------------------

async function logAction(data: {
	actionType: string;
	targetId?: string;
	targetType?: string;
	actor: string;
	reason: string;
	status?: string;
	result?: Record<string, unknown>;
}): Promise<OperatorActionResult> {
	const id = randomUUID();
	const status = data.status ?? "success";
	await execute(
		`INSERT INTO operator_actions (id, action_type, target_id, target_type, actor, reason, status, result)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[id, data.actionType, data.targetId ?? null, data.targetType ?? null, data.actor, data.reason, status, JSON.stringify(data.result ?? {})],
	);

	// Cross-cutting audit
	await appendAuditEvent({
		category: "operator",
		severity: "info",
		actor: data.actor,
		action: `operator_action_${data.actionType}`,
		details: {
			actionId: id,
			targetId: data.targetId,
			targetType: data.targetType,
			reason: data.reason,
			status,
		},
	});

	return {
		id,
		actionType: data.actionType as OperatorActionRequest["actionType"],
		targetId: data.targetId,
		status: status as OperatorActionResult["status"],
		message: `${data.actionType} executed`,
		createdAt: new Date().toISOString(),
	};
}

async function setOperatorFlag(key: string, value: string, setBy: string, reason: string): Promise<void> {
	await execute(
		`INSERT INTO operator_flags (key, value, set_by, reason, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (key) DO UPDATE SET
		   value = EXCLUDED.value,
		   set_by = EXCLUDED.set_by,
		   reason = EXCLUDED.reason,
		   updated_at = now()`,
		[key, value, setBy, reason],
	);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export async function listOperatorActions(limit = 100): Promise<OperatorActionRow[]> {
	return query<OperatorActionRow>("SELECT * FROM operator_actions ORDER BY created_at DESC LIMIT $1", [limit]);
}

export async function getOperatorFlag(key: string): Promise<OperatorFlagRow | undefined> {
	return queryOne<OperatorFlagRow>("SELECT * FROM operator_flags WHERE key = $1", [key]) ?? undefined;
}

export async function isQueuePaused(): Promise<boolean> {
	const row = await getOperatorFlag("queue-paused");
	return row?.value === "true";
}
