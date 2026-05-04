// ---------------------------------------------------------------------------
// Oscorpex — ApprovalService
// Canonical human approval request/decision flow for Quality Gates Center.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
	type ApprovalDecisionValue,
	type ApprovalRequestState,
	type QualityApprovalDecision,
	type QualityApprovalRequest,
	getApprovalRequest,
	insertApprovalDecision,
	insertApprovalRequest,
	listApprovalDecisions,
	listApprovalRequestsForGoal,
	listPendingApprovalRequests,
	updateApprovalRequestState,
	type QualityGateEnvironment,
	getGoalScope,
} from "./db.js";
import { eventBus } from "./event-bus.js";

export type ApprovalType =
	| "human_approval"
	| "production_deploy_approval"
	| "security_approval"
	| "policy_override_approval"
	| "rollback_approval"
	| string;

export interface ApprovalRequestInput {
	goalId: string;
	tenantId: string | null;
	approvalType: ApprovalType;
	requiredRole: string;
	requiredRoles?: string[];
	requiredQuorum: number;
	environment: QualityGateEnvironment;
	expiresAt?: string;
	requestedBy?: string;
	reason?: string;
	releaseCandidateId?: string | null;
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
}

export interface ApprovalDecisionInput {
	approvalRequestId: string;
	tenantId?: string | null;
	actorId: string;
	actorRoles: string[];
	reason?: string;
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
}

export interface ApprovalStateOutput {
	request: QualityApprovalRequest;
	state: ApprovalRequestState;
	valid: boolean;
	satisfied: boolean;
	blocked: boolean;
	expired: boolean;
	rejected: boolean;
	approvedCount: number;
	rejectedCount: number;
	requiredQuorum: number;
	missingApprovals: number;
	approvedActorIds: string[];
	rejectedActorIds: string[];
	decisions: QualityApprovalDecision[];
	reason: string;
}

export interface ApprovalValidityOutput {
	goalId: string;
	satisfied: boolean;
	blocked: boolean;
	states: ApprovalStateOutput[];
	pending: ApprovalStateOutput[];
	expired: ApprovalStateOutput[];
	rejected: ApprovalStateOutput[];
	missingApprovals: number;
}

export class TenantRequiredForProductionApprovalError extends Error {
	constructor(goalId: string) {
		super(`tenant_id is required for production approval decisions for goal ${goalId}`);
		this.name = "TenantRequiredForProductionApprovalError";
	}
}

export class InvalidApprovalTransitionError extends Error {
	constructor(from: ApprovalRequestState, to: ApprovalRequestState) {
		super(`invalid approval transition: ${from} -> ${to}`);
		this.name = "InvalidApprovalTransitionError";
	}
}

const TERMINAL_STATES: ApprovalRequestState[] = ["approved", "rejected", "expired", "superseded", "cancelled"];

export class ApprovalService {
	async createApprovalRequest(input: ApprovalRequestInput): Promise<QualityApprovalRequest> {
		const scope = await this.assertGoalExists(input.goalId);
		const tenantId = input.tenantId ?? scope.tenantId;
		if (input.environment === "production" && !tenantId) {
			throw new TenantRequiredForProductionApprovalError(input.goalId);
		}
		const requiredRoles = input.requiredRoles?.length ? input.requiredRoles : [input.requiredRole];
		const request = await insertApprovalRequest({
			tenantId,
			projectId: scope.projectId,
			goalId: input.goalId,
			releaseCandidateId: input.releaseCandidateId ?? null,
			approvalClass: input.approvalType,
			requiredRoles,
			requiredQuorum: Math.max(1, input.requiredQuorum),
			requestedBy: input.requestedBy ?? "system",
			reason: input.reason ?? "",
			artifactIds: input.artifactIds ?? [],
			policyVersion: "1",
			correlationId: randomUUID(),
			expiresAt: input.expiresAt,
			metadata: {
				...input.metadata,
				environment: input.environment,
				source: input.metadata?.source ?? "approval-service",
			},
		});
		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "approval.requested",
			payload: {
				approvalRequestId: request.id,
				goalId: request.goalId ?? undefined,
				approvalClass: request.approvalClass,
				environment: input.environment,
				requiredRoles: request.requiredRoles,
				requiredQuorum: request.requiredQuorum,
				expiresAt: request.expiresAt,
			},
		});
		return request;
	}

	async approveRequest(input: ApprovalDecisionInput): Promise<ApprovalStateOutput> {
		return this.recordDecision(input, "approved");
	}

	async rejectRequest(input: ApprovalDecisionInput): Promise<ApprovalStateOutput> {
		return this.recordDecision(input, "rejected");
	}

	async getPendingApprovals(goalId: string): Promise<QualityApprovalRequest[]> {
		await this.assertGoalExists(goalId);
		const pending = await listPendingApprovalRequests(goalId);
		const resolved: QualityApprovalRequest[] = [];
		for (const request of pending) {
			const state = await this.resolveRequestState(request.id);
			if (state.state === "pending" || state.state === "in-review") resolved.push(state.request);
		}
		return resolved;
	}

	async getApprovalState(goalId: string): Promise<ApprovalValidityOutput> {
		return this.resolveApprovalValidity(goalId);
	}

	async isApprovalSatisfied(goalId: string): Promise<boolean> {
		return (await this.resolveApprovalValidity(goalId)).satisfied;
	}

	async expireApprovalRequest(id: string): Promise<ApprovalStateOutput> {
		const request = await this.assertRequestExists(id);
		this.assertTransitionAllowed(request.state, "expired");
		const updated = await updateApprovalRequestState({ id, state: "expired", resolvedAt: new Date().toISOString() });
		if (!updated) throw new Error(`approval request not found after expire: ${id}`);
		await eventBus.emitAsync({
			projectId: updated.projectId ?? "",
			type: "approval.expired",
			payload: {
				approvalRequestId: updated.id,
				goalId: updated.goalId ?? undefined,
				approvalClass: updated.approvalClass,
				expiredAt: updated.resolvedAt ?? new Date().toISOString(),
			},
		});
		return this.resolveRequestState(updated.id);
	}

	async supersedeApprovalRequest(
		id: string,
		reason = "superseded by newer approval request",
	): Promise<ApprovalStateOutput> {
		const request = await this.assertRequestExists(id);
		this.assertTransitionAllowed(request.state, "superseded");
		const now = new Date().toISOString();
		const updated = await updateApprovalRequestState({ id, state: "superseded", resolvedAt: now, supersededAt: now });
		if (!updated) throw new Error(`approval request not found after supersede: ${id}`);
		await eventBus.emitAsync({
			projectId: updated.projectId ?? "",
			type: "approval.superseded",
			payload: {
				approvalRequestId: updated.id,
				goalId: updated.goalId ?? undefined,
				approvalClass: updated.approvalClass,
				supersededAt: now,
				reason,
			},
		});
		return this.resolveRequestState(updated.id);
	}

	async resolveApprovalValidity(goalId: string): Promise<ApprovalValidityOutput> {
		await this.assertGoalExists(goalId);
		const requests = await listApprovalRequestsForGoal(goalId);
		const states: ApprovalStateOutput[] = [];
		for (const request of requests) {
			states.push(await this.resolveRequestState(request.id));
		}
		const activeStates = states.filter((state) => state.state !== "superseded" && state.state !== "cancelled");
		const blocked = activeStates.some((state) => state.blocked);
		const pending = activeStates.filter((state) => !state.satisfied && !state.blocked && !state.expired);
		return {
			goalId,
			satisfied:
				activeStates.length > 0 && !blocked && pending.length === 0 && activeStates.every((state) => state.satisfied),
			blocked,
			states,
			pending,
			expired: activeStates.filter((state) => state.expired),
			rejected: activeStates.filter((state) => state.rejected),
			missingApprovals: activeStates.reduce((sum, state) => sum + state.missingApprovals, 0),
		};
	}

	protected approvalIntegrationHook(_input: {
		request: QualityApprovalRequest;
		state: ApprovalStateOutput;
		approvalType: ApprovalType;
	}): Promise<void> | void {
		// H2-D keeps release decision integration out of scope. H2-E can bind
		// human_approval, production_deploy_approval, security_approval,
		// policy_override_approval, and rollback_approval here.
	}

	private async recordDecision(
		input: ApprovalDecisionInput,
		decisionValue: ApprovalDecisionValue,
	): Promise<ApprovalStateOutput> {
		const request = await this.assertRequestExists(input.approvalRequestId);
		const environment = String(request.metadata.environment ?? "production") as QualityGateEnvironment;
		if (environment === "production" && !request.tenantId) {
			throw new TenantRequiredForProductionApprovalError(request.goalId ?? request.id);
		}
		const preState = await this.resolveRequestState(request.id);
		if (TERMINAL_STATES.includes(preState.state)) {
			throw new InvalidApprovalTransitionError(preState.state, decisionValue === "approved" ? "approved" : "rejected");
		}
		this.assertActorCanDecide(request, input.actorRoles);
		const decision = await insertApprovalDecision({
			tenantId: input.tenantId ?? request.tenantId,
			approvalRequestId: request.id,
			decision: decisionValue,
			actorId: input.actorId,
			actorRoles: input.actorRoles,
			decisionReason: input.reason ?? "",
			artifactIds: input.artifactIds ?? [],
			policyVersion: request.policyVersion,
			correlationId: randomUUID(),
			metadata: input.metadata ?? {},
		});

		let state = await this.resolveRequestState(request.id);
		if (decisionValue === "rejected") {
			const updated = await updateApprovalRequestState({
				id: request.id,
				state: "rejected",
				resolvedAt: new Date().toISOString(),
			});
			if (!updated) throw new Error(`approval request not found after rejection: ${request.id}`);
			state = await this.resolveRequestState(updated.id);
		} else if (state.satisfied) {
			const updated = await updateApprovalRequestState({
				id: request.id,
				state: "approved",
				resolvedAt: new Date().toISOString(),
			});
			if (!updated) throw new Error(`approval request not found after approval: ${request.id}`);
			state = await this.resolveRequestState(updated.id);
		} else if (request.state === "pending") {
			const updated = await updateApprovalRequestState({ id: request.id, state: "in-review" });
			if (!updated) throw new Error(`approval request not found after in-review transition: ${request.id}`);
			state = await this.resolveRequestState(updated.id);
		}

		await eventBus.emitAsync({
			projectId: request.projectId ?? "",
			type: decisionValue === "approved" ? "approval.approved" : "approval.rejected",
			payload: {
				approvalRequestId: request.id,
				approvalDecisionId: decision.id,
				goalId: request.goalId ?? undefined,
				approvalClass: request.approvalClass,
				actorId: decision.actorId,
				decision: decision.decision,
				reason: decision.decisionReason,
			},
		});
		if (decisionValue === "rejected") {
			await eventBus.emitAsync({
				projectId: request.projectId ?? "",
				type: "approval.blocked",
				payload: {
					approvalRequestId: request.id,
					goalId: request.goalId ?? undefined,
					approvalClass: request.approvalClass,
					reason: state.reason,
				},
			});
		}
		if (state.satisfied) {
			await eventBus.emitAsync({
				projectId: request.projectId ?? "",
				type: "approval.quorum_satisfied",
				payload: {
					approvalRequestId: request.id,
					goalId: request.goalId ?? undefined,
					approvalClass: request.approvalClass,
					approvedCount: state.approvedCount,
					requiredQuorum: state.requiredQuorum,
				},
			});
		}
		await this.approvalIntegrationHook({ request, state, approvalType: request.approvalClass });
		return state;
	}

	private async resolveRequestState(id: string): Promise<ApprovalStateOutput> {
		const request = await this.assertRequestExists(id);
		const nowMs = Date.now();
		const expiresMs = new Date(request.expiresAt).getTime();
		if (
			(request.state === "pending" || request.state === "in-review") &&
			Number.isFinite(expiresMs) &&
			expiresMs <= nowMs
		) {
			await this.expireApprovalRequest(id);
			const expired = await this.assertRequestExists(id);
			return this.buildState(expired, await listApprovalDecisions(id));
		}
		return this.buildState(request, await listApprovalDecisions(id));
	}

	private buildState(request: QualityApprovalRequest, decisions: QualityApprovalDecision[]): ApprovalStateOutput {
		const approvedActorIds = new Set<string>();
		const rejectedActorIds = new Set<string>();
		for (const decision of decisions) {
			if (decision.decision === "approved") approvedActorIds.add(decision.actorId);
			if (decision.decision === "rejected") rejectedActorIds.add(decision.actorId);
		}
		const approvedCount = approvedActorIds.size;
		const rejectedCount = rejectedActorIds.size;
		const expired = request.state === "expired";
		const rejected = request.state === "rejected" || rejectedCount > 0;
		const missingApprovals = Math.max(0, request.requiredQuorum - approvedCount);
		const quorumSatisfied = approvedCount >= request.requiredQuorum;
		const terminalInvalid = request.state === "superseded" || request.state === "cancelled";
		const satisfied = !terminalInvalid && !expired && !rejected && quorumSatisfied;
		const blocked = expired || rejected || terminalInvalid;
		let reason = "approval pending";
		if (satisfied) reason = "approval quorum satisfied";
		else if (rejected) reason = "approval rejected";
		else if (expired) reason = "approval expired";
		else if (terminalInvalid) reason = `approval ${request.state}`;
		else if (missingApprovals > 0) reason = `${missingApprovals} approval(s) missing`;
		return {
			request,
			state: request.state,
			valid: satisfied,
			satisfied,
			blocked,
			expired,
			rejected,
			approvedCount,
			rejectedCount,
			requiredQuorum: request.requiredQuorum,
			missingApprovals,
			approvedActorIds: [...approvedActorIds],
			rejectedActorIds: [...rejectedActorIds],
			decisions,
			reason,
		};
	}

	private assertTransitionAllowed(from: ApprovalRequestState, to: ApprovalRequestState): void {
		if (from === to) return;
		if (from === "approved" && to === "superseded") return;
		if (TERMINAL_STATES.includes(from)) throw new InvalidApprovalTransitionError(from, to);
		const allowed: Record<ApprovalRequestState, ApprovalRequestState[]> = {
			pending: ["in-review", "approved", "rejected", "expired", "superseded", "cancelled"],
			"in-review": ["approved", "rejected", "expired", "superseded", "cancelled"],
			approved: [],
			rejected: [],
			expired: [],
			superseded: [],
			cancelled: [],
		};
		if (!allowed[from].includes(to)) throw new InvalidApprovalTransitionError(from, to);
	}

	private assertActorCanDecide(request: QualityApprovalRequest, actorRoles: string[]): void {
		if (request.requiredRoles.length === 0) return;
		if (!actorRoles.some((role) => request.requiredRoles.includes(role))) {
			throw new Error(`actor lacks required approval role: ${request.requiredRoles.join(", ")}`);
		}
	}

	private async assertGoalExists(goalId: string) {
		const scope = await getGoalScope(goalId);
		if (!scope) throw new Error(`execution goal not found: ${goalId}`);
		return scope;
	}

	private async assertRequestExists(id: string): Promise<QualityApprovalRequest> {
		const request = await getApprovalRequest(id);
		if (!request) throw new Error(`approval request not found: ${id}`);
		return request;
	}
}

export const approvalService = new ApprovalService();
