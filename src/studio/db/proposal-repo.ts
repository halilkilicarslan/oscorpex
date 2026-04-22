// ---------------------------------------------------------------------------
// Oscorpex — Proposal Repository: Task injection proposals CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne, withTransaction } from "../pg.js";
import type { ProposalStatus, TaskProposal } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("proposal-repo");

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToProposal(row: any): TaskProposal {
	return {
		id: row.id,
		projectId: row.project_id,
		originatingTaskId: row.originating_task_id ?? undefined,
		originatingAgentId: row.originating_agent_id,
		proposalType: row.proposal_type,
		title: row.title,
		description: row.description,
		severity: row.severity ?? undefined,
		suggestedRole: row.suggested_role ?? undefined,
		phaseId: row.phase_id ?? undefined,
		complexity: row.complexity ?? undefined,
		createdTaskId: row.created_task_id ?? undefined,
		status: row.status as ProposalStatus,
		approvedBy: row.approved_by ?? undefined,
		rejectedReason: row.rejected_reason ?? undefined,
		createdAt: row.created_at?.toISOString?.() ?? row.created_at,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createProposal(
	data: Omit<TaskProposal, "id" | "status" | "createdAt" | "approvedBy" | "rejectedReason">,
): Promise<TaskProposal> {
	const id = randomUUID();
	await execute(
		`INSERT INTO task_proposals (id, project_id, originating_task_id, originating_agent_id, proposal_type, title, description, severity, suggested_role, phase_id, complexity)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			id,
			data.projectId,
			data.originatingTaskId ?? null,
			data.originatingAgentId,
			data.proposalType,
			data.title,
			data.description,
			data.severity ?? null,
			data.suggestedRole ?? null,
			data.phaseId ?? null,
			data.complexity ?? null,
		],
	);
	return (await getProposal(id))!;
}

export async function getProposal(id: string): Promise<TaskProposal | undefined> {
	const row = await queryOne<any>("SELECT * FROM task_proposals WHERE id = $1", [id]);
	return row ? rowToProposal(row) : undefined;
}

export async function listProposals(projectId: string, status?: ProposalStatus): Promise<TaskProposal[]> {
	if (status) {
		const rows = await query<any>(
			`SELECT * FROM task_proposals WHERE project_id = $1 AND status = $2 ORDER BY created_at DESC`,
			[projectId, status],
		);
		return rows.map(rowToProposal);
	}
	const rows = await query<any>(
		`SELECT * FROM task_proposals WHERE project_id = $1 ORDER BY created_at DESC`,
		[projectId],
	);
	return rows.map(rowToProposal);
}

export async function approveProposal(
	id: string,
	approvedBy: string,
): Promise<{ proposal: TaskProposal; taskId?: string } | undefined> {
	return withTransaction(async (client) => {
		const result = await client.query<any>("SELECT * FROM task_proposals WHERE id = $1 FOR UPDATE", [id]);
		const proposalRow = result.rows[0];
		if (!proposalRow) return undefined;

		if (proposalRow.created_task_id) {
			const proposal = rowToProposal(proposalRow);
			return { proposal, taskId: proposal.createdTaskId };
		}

		if (proposalRow.status !== "pending") {
			return { proposal: rowToProposal(proposalRow), taskId: proposalRow.created_task_id ?? undefined };
		}

		const originTask = proposalRow.originating_task_id
			? (
					await client.query<{
						phase_id: string | null;
						branch: string | null;
					}>("SELECT phase_id, branch FROM tasks WHERE id = $1", [proposalRow.originating_task_id])
				).rows[0]
			: undefined;

		const phaseId = proposalRow.phase_id ?? originTask?.phase_id ?? null;
		if (!phaseId) {
			throw new Error(`Proposal ${id} cannot be materialized without phaseId or originating task phase`);
		}

		const taskId = randomUUID();
		await client.query(
			`INSERT INTO tasks (id, phase_id, project_id, title, description, assigned_agent, status, complexity, depends_on, branch, retry_count, task_type, requires_approval, assigned_agent_id)
			 VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, 0, 'ai', 0, NULL)`,
			[
				taskId,
				phaseId,
				proposalRow.project_id,
				proposalRow.title,
				proposalRow.description,
				proposalRow.suggested_role ?? "tech-lead",
				proposalRow.complexity ?? "S",
				JSON.stringify(proposalRow.originating_task_id ? [proposalRow.originating_task_id] : []),
				originTask?.branch ?? "main",
			],
		);

		const approved = await client.query<any>(
			`UPDATE task_proposals
			 SET status = 'approved', approved_by = $1, created_task_id = $2
			 WHERE id = $3
			 RETURNING *`,
			[approvedBy, taskId, id],
		);
		const row = approved.rows[0];
		return row ? { proposal: rowToProposal(row), taskId } : undefined;
	});
}

export async function rejectProposal(id: string, reason: string): Promise<TaskProposal | undefined> {
	const row = await queryOne<any>(
		`UPDATE task_proposals SET status = 'rejected', rejected_reason = $1 WHERE id = $2 AND status = 'pending' RETURNING *`,
		[reason, id],
	);
	return row ? rowToProposal(row) : undefined;
}

export async function autoApproveProposal(id: string): Promise<TaskProposal | undefined> {
	const row = await queryOne<any>(
		`UPDATE task_proposals SET status = 'auto_approved', approved_by = 'system' WHERE id = $1 AND status = 'pending' RETURNING *`,
		[id],
	);
	return row ? rowToProposal(row) : undefined;
}
