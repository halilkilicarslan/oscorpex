// ---------------------------------------------------------------------------
// Oscorpex — Proposal Repository: Task injection proposals CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { ProposalStatus, TaskProposal } from "../types.js";

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
		`INSERT INTO task_proposals (id, project_id, originating_task_id, originating_agent_id, proposal_type, title, description, severity, suggested_role)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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

export async function approveProposal(id: string, approvedBy: string): Promise<TaskProposal | undefined> {
	const row = await queryOne<any>(
		`UPDATE task_proposals SET status = 'approved', approved_by = $1 WHERE id = $2 AND status = 'pending' RETURNING *`,
		[approvedBy, id],
	);
	return row ? rowToProposal(row) : undefined;
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
