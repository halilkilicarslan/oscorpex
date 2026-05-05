import { randomUUID } from "node:crypto";
import { execute, query } from "../pg.js";

export interface CommandAuditLog {
	id: string;
	projectId: string;
	taskId: string;
	agentId?: string;
	agentRole?: string;
	command: string;
	allowed: boolean;
	policyRole?: string;
	matchedPattern?: string;
	violationReason?: string;
	createdAt: string;
}

export async function recordCommandAudit(entry: Omit<CommandAuditLog, "id" | "createdAt">): Promise<void> {
	await execute(
		`INSERT INTO command_audit_logs (id, project_id, task_id, agent_id, agent_role, command, allowed, policy_role, matched_pattern, violation_reason)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			randomUUID(),
			entry.projectId,
			entry.taskId,
			entry.agentId ?? null,
			entry.agentRole ?? null,
			entry.command,
			entry.allowed,
			entry.policyRole ?? null,
			entry.matchedPattern ?? null,
			entry.violationReason ?? null,
		],
	);
}

export async function recordCommandAuditBatch(entries: Omit<CommandAuditLog, "id" | "createdAt">[]): Promise<void> {
	if (entries.length === 0) return;
	const placeholders: string[] = [];
	const values: unknown[] = [];
	let idx = 1;
	for (const entry of entries) {
		placeholders.push(
			`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9})`,
		);
		values.push(
			randomUUID(),
			entry.projectId,
			entry.taskId,
			entry.agentId ?? null,
			entry.agentRole ?? null,
			entry.command,
			entry.allowed,
			entry.policyRole ?? null,
			entry.matchedPattern ?? null,
			entry.violationReason ?? null,
		);
		idx += 10;
	}
	await execute(
		`INSERT INTO command_audit_logs (id, project_id, task_id, agent_id, agent_role, command, allowed, policy_role, matched_pattern, violation_reason) VALUES ${placeholders.join(", ")}`,
		values,
	);
}

export async function getCommandViolations(projectId: string, limit = 50): Promise<CommandAuditLog[]> {
	return query<CommandAuditLog>(
		`SELECT id, project_id AS "projectId", task_id AS "taskId", agent_id AS "agentId", agent_role AS "agentRole",
		        command, allowed, policy_role AS "policyRole", matched_pattern AS "matchedPattern",
		        violation_reason AS "violationReason", created_at AS "createdAt"
		 FROM command_audit_logs
		 WHERE project_id = $1 AND allowed = FALSE
		 ORDER BY created_at DESC
		 LIMIT $2`,
		[projectId, limit],
	);
}
