// ---------------------------------------------------------------------------
// Control Plane — Approval Service
// ---------------------------------------------------------------------------

import { execute } from "../pg.js";
import {
	createApproval,
	getApproval,
	listPendingApprovals,
	listApprovals,
	approveApproval,
	rejectApproval,
	expireApproval,
	appendApprovalEvent,
	listApprovalEvents,
	listExpiredApprovals,
	 type ApprovalRow,
} from "./repo.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "escalated";
export type ApprovalKind = "high_risk_task" | "policy_override" | "provider_override" | "runtime_override";

export async function requestApproval(data: {
	projectId?: string | null;
	kind: ApprovalKind;
	title: string;
	description?: string;
	requestedBy?: string;
}): Promise<ApprovalRow> {
	const approval = await createApproval(data);
	await appendApprovalEvent({
		approvalId: approval.id,
		eventType: "created",
		actor: data.requestedBy ?? "system",
	});
	return approval;
}

export async function approve(id: string, actor: string): Promise<ApprovalRow | undefined> {
	const approval = await approveApproval(id, actor);
	if (approval) {
		await appendApprovalEvent({ approvalId: id, eventType: "approved", actor });
	}
	return approval;
}

export async function reject(id: string, actor: string): Promise<ApprovalRow | undefined> {
	const approval = await rejectApproval(id, actor);
	if (approval) {
		await appendApprovalEvent({ approvalId: id, eventType: "rejected", actor });
	}
	return approval;
}

export async function expireStaleApprovals(): Promise<number> {
	const stale = await listExpiredApprovals();
	for (const a of stale) {
		await expireApproval(a.id);
		await appendApprovalEvent({ approvalId: a.id, eventType: "expired", actor: "system" });
	}
	return stale.length;
}

export async function getApprovalWithEvents(id: string): Promise<{ approval: ApprovalRow; events: unknown[] } | undefined> {
	const approval = await getApproval(id);
	if (!approval) return undefined;
	const events = await listApprovalEvents(id);
	return { approval, events };
}

export { listPendingApprovals, listApprovals };

// ---------------------------------------------------------------------------
// SLA & Escalation
// ---------------------------------------------------------------------------

export interface ApprovalSla {
	pendingAgeMinutes: number;
	expiresInMinutes: number;
	isExpiringSoon: boolean;
	isExpired: boolean;
	escalated: boolean;
	escalationTarget: string | null;
}

export interface ApprovalWithSla extends ApprovalRow {
	sla: ApprovalSla;
}

export async function listApprovalsWithSla(status?: string): Promise<ApprovalWithSla[]> {
	const approvals = await listApprovals(status);
	return approvals.map(computeSla);
}

export async function escalateApproval(id: string, target: string, actor: string): Promise<ApprovalRow | undefined> {
	await execute(
		"UPDATE approvals SET escalated = true, escalation_target = $1, status = 'escalated' WHERE id = $2",
		[target, id],
	);
	await appendApprovalEvent({ approvalId: id, eventType: "escalated", actor, payload: { target } });
	return getApproval(id);
}

function computeSla(row: ApprovalRow): ApprovalWithSla {
	const now = Date.now();
	const created = new Date(row.created_at).getTime();
	const expires = new Date(row.expires_at).getTime();
	const pendingAgeMinutes = Math.max(0, Math.floor((now - created) / 60_000));
	const expiresInMinutes = Math.max(0, Math.floor((expires - now) / 60_000));
	return {
		...row,
		sla: {
			pendingAgeMinutes,
			expiresInMinutes,
			isExpiringSoon: expiresInMinutes < 60 && row.status === "pending",
			isExpired: expiresInMinutes <= 0 && row.status === "pending",
			escalated: row.escalated,
			escalationTarget: row.escalation_target,
		},
	};
}
