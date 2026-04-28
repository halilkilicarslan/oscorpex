// ---------------------------------------------------------------------------
// Control Plane — Approval Service
// ---------------------------------------------------------------------------

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
} from "./approval-repo.js";

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
