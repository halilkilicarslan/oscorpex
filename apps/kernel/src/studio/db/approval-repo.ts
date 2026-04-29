// ---------------------------------------------------------------------------
// Oscorpex — Approval Repository: Risk-based governance rules CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { ApprovalRule, RiskLevel } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("approval-repo");

export type ApprovalRequestState = "pending" | "in-review" | "approved" | "rejected" | "expired" | "superseded" | "cancelled";
export type ApprovalDecisionValue = "approved" | "rejected";

export interface QualityApprovalRequest {
	id: string;
	tenantId: string | null;
	projectId: string | null;
	goalId: string | null;
	releaseCandidateId: string | null;
	approvalClass: string;
	state: ApprovalRequestState;
	requiredRoles: string[];
	requiredQuorum: number;
	rejectionPolicy: string;
	requestedBy: string;
	reason: string;
	artifactIds: string[];
	policyVersion: string;
	correlationId: string;
	expiresAt: string;
	resolvedAt: string | null;
	createdAt: string;
	updatedAt: string;
	supersededAt: string | null;
	metadata: Record<string, unknown>;
}

export interface QualityApprovalDecision {
	id: string;
	tenantId: string | null;
	approvalRequestId: string;
	decision: ApprovalDecisionValue;
	actorId: string;
	actorRoles: string[];
	decisionReason: string;
	artifactIds: string[];
	policyVersion: string;
	correlationId: string;
	createdAt: string;
	supersededAt: string | null;
	metadata: Record<string, unknown>;
}

export interface InsertApprovalRequestInput {
	tenantId: string | null;
	projectId: string;
	goalId: string;
	releaseCandidateId?: string | null;
	approvalClass: string;
	requiredRoles: string[];
	requiredQuorum: number;
	rejectionPolicy?: string;
	requestedBy: string;
	reason?: string;
	artifactIds?: string[];
	policyVersion?: string;
	correlationId?: string;
	expiresAt?: string;
	metadata?: Record<string, unknown>;
}

export interface InsertApprovalDecisionInput {
	tenantId: string | null;
	approvalRequestId: string;
	decision: ApprovalDecisionValue;
	actorId: string;
	actorRoles: string[];
	decisionReason?: string;
	artifactIds?: string[];
	policyVersion: string;
	correlationId?: string;
	metadata?: Record<string, unknown>;
}

interface ApprovalRequestRow {
	id: string;
	tenant_id: string | null;
	project_id: string | null;
	goal_id: string | null;
	release_candidate_id: string | null;
	approval_class: string;
	state: ApprovalRequestState;
	required_roles: string[] | string;
	required_quorum: number;
	rejection_policy: string;
	requested_by: string;
	reason: string;
	artifact_ids: string[] | string;
	policy_version: string;
	correlation_id: string;
	expires_at: string;
	resolved_at: string | null;
	created_at: string;
	updated_at: string;
	superseded_at: string | null;
	metadata: Record<string, unknown> | string;
}

interface ApprovalDecisionRow {
	id: string;
	tenant_id: string | null;
	approval_request_id: string;
	decision: ApprovalDecisionValue;
	actor_id: string;
	actor_roles: string[] | string;
	decision_reason: string;
	artifact_ids: string[] | string;
	policy_version: string;
	correlation_id: string;
	created_at: string;
	superseded_at: string | null;
	metadata: Record<string, unknown> | string;
}

function parseJson<T>(value: T | string): T {
	return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function rowToApprovalRequest(row: ApprovalRequestRow): QualityApprovalRequest {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		projectId: row.project_id,
		goalId: row.goal_id,
		releaseCandidateId: row.release_candidate_id,
		approvalClass: row.approval_class,
		state: row.state,
		requiredRoles: parseJson<string[]>(row.required_roles),
		requiredQuorum: Number(row.required_quorum),
		rejectionPolicy: row.rejection_policy,
		requestedBy: row.requested_by,
		reason: row.reason,
		artifactIds: parseJson<string[]>(row.artifact_ids),
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		expiresAt: row.expires_at,
		resolvedAt: row.resolved_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		supersededAt: row.superseded_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

function rowToApprovalDecision(row: ApprovalDecisionRow): QualityApprovalDecision {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		approvalRequestId: row.approval_request_id,
		decision: row.decision,
		actorId: row.actor_id,
		actorRoles: parseJson<string[]>(row.actor_roles),
		decisionReason: row.decision_reason,
		artifactIds: parseJson<string[]>(row.artifact_ids),
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		createdAt: row.created_at,
		supersededAt: row.superseded_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToRule(row: any): ApprovalRule {
	return {
		id: row.id,
		projectId: row.project_id ?? undefined,
		actionType: row.action_type,
		riskLevel: row.risk_level as RiskLevel,
		requiresApproval: Boolean(row.requires_approval),
		autoApprove: Boolean(row.auto_approve),
		maxPerRun: row.max_per_run != null ? Number(row.max_per_run) : undefined,
		description: row.description ?? undefined,
		createdAt: row.created_at?.toISOString?.() ?? row.created_at,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createApprovalRule(
	data: Omit<ApprovalRule, "id" | "createdAt">,
): Promise<ApprovalRule> {
	const id = randomUUID();
	await execute(
		`INSERT INTO approval_rules (id, project_id, action_type, risk_level, requires_approval, auto_approve, max_per_run, description)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (project_id, action_type, risk_level) DO UPDATE SET
			requires_approval = EXCLUDED.requires_approval,
			auto_approve = EXCLUDED.auto_approve,
			max_per_run = EXCLUDED.max_per_run,
			description = EXCLUDED.description`,
		[
			id,
			data.projectId ?? null,
			data.actionType,
			data.riskLevel,
			data.requiresApproval,
			data.autoApprove,
			data.maxPerRun ?? null,
			data.description ?? null,
		],
	);
	return { ...data, id, createdAt: new Date().toISOString() };
}

/** Get the applicable rule for an action type and risk level.
 *  Checks project-specific rule first, then global (project_id IS NULL). */
export async function getApprovalRule(
	projectId: string,
	actionType: string,
	riskLevel: RiskLevel,
): Promise<ApprovalRule | undefined> {
	// Project-specific first
	const projectRule = await queryOne<any>(
		`SELECT * FROM approval_rules WHERE project_id = $1 AND action_type = $2 AND risk_level = $3`,
		[projectId, actionType, riskLevel],
	);
	if (projectRule) return rowToRule(projectRule);

	// Global fallback
	const globalRule = await queryOne<any>(
		`SELECT * FROM approval_rules WHERE project_id IS NULL AND action_type = $1 AND risk_level = $2`,
		[actionType, riskLevel],
	);
	return globalRule ? rowToRule(globalRule) : undefined;
}

/** Check if an action requires approval */
export async function requiresApproval(
	projectId: string,
	actionType: string,
	riskLevel: RiskLevel,
): Promise<boolean> {
	const rule = await getApprovalRule(projectId, actionType, riskLevel);
	if (!rule) {
		// Default: high/critical require approval, low/medium auto-approve
		return riskLevel === "high" || riskLevel === "critical";
	}
	return rule.requiresApproval && !rule.autoApprove;
}

/** List all rules for a project (including globals) */
export async function listApprovalRules(projectId: string): Promise<ApprovalRule[]> {
	const rows = await query<any>(
		`SELECT * FROM approval_rules WHERE project_id = $1 OR project_id IS NULL ORDER BY action_type, risk_level`,
		[projectId],
	);
	return rows.map(rowToRule);
}

// ---------------------------------------------------------------------------
// Quality Gates Center approvals
// ---------------------------------------------------------------------------

export async function insertApprovalRequest(input: InsertApprovalRequestInput): Promise<QualityApprovalRequest> {
	const id = randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<ApprovalRequestRow>(
		`
		INSERT INTO approval_requests (
		  id, tenant_id, project_id, goal_id, release_candidate_id, approval_class,
		  state, required_roles, required_quorum, rejection_policy, requested_by,
		  reason, artifact_ids, policy_version, correlation_id, expires_at, metadata
		)
		VALUES (
		  $1, $2, $3, $4, $5, $6,
		  'pending', $7, $8, $9, $10,
		  $11, $12, $13, $14, COALESCE($15::timestamptz, now() + interval '24 hours'), $16
		)
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.projectId,
			input.goalId,
			input.releaseCandidateId ?? null,
			input.approvalClass,
			JSON.stringify(input.requiredRoles),
			input.requiredQuorum,
			input.rejectionPolicy ?? "any_rejection_blocks",
			input.requestedBy,
			input.reason ?? "",
			JSON.stringify(input.artifactIds ?? []),
			input.policyVersion ?? "1",
			correlationId,
			input.expiresAt ?? null,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (!rows[0]) throw new Error("approval request insert produced no row");
	return rowToApprovalRequest(rows[0]);
}

export async function getApprovalRequest(id: string): Promise<QualityApprovalRequest | undefined> {
	const row = await queryOne<ApprovalRequestRow>("SELECT * FROM approval_requests WHERE id = $1", [id]);
	return row ? rowToApprovalRequest(row) : undefined;
}

export async function listPendingApprovalRequests(goalId: string): Promise<QualityApprovalRequest[]> {
	const rows = await query<ApprovalRequestRow>(
		`
		SELECT *
		FROM approval_requests
		WHERE goal_id = $1
		  AND state IN ('pending', 'in-review')
		  AND superseded_at IS NULL
		ORDER BY created_at DESC
		`,
		[goalId],
	);
	return rows.map(rowToApprovalRequest);
}

export async function listApprovalRequestsForGoal(goalId: string): Promise<QualityApprovalRequest[]> {
	const rows = await query<ApprovalRequestRow>(
		`
		SELECT *
		FROM approval_requests
		WHERE goal_id = $1
		  AND superseded_at IS NULL
		ORDER BY created_at DESC
		`,
		[goalId],
	);
	return rows.map(rowToApprovalRequest);
}

export async function listApprovalDecisions(approvalRequestId: string): Promise<QualityApprovalDecision[]> {
	const rows = await query<ApprovalDecisionRow>(
		`
		SELECT *
		FROM approval_decisions
		WHERE approval_request_id = $1
		  AND superseded_at IS NULL
		ORDER BY created_at ASC, id ASC
		`,
		[approvalRequestId],
	);
	return rows.map(rowToApprovalDecision);
}

export async function insertApprovalDecision(input: InsertApprovalDecisionInput): Promise<QualityApprovalDecision> {
	const id = randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<ApprovalDecisionRow>(
		`
		INSERT INTO approval_decisions (
		  id, tenant_id, approval_request_id, decision, actor_id, actor_roles,
		  decision_reason, artifact_ids, policy_version, correlation_id, metadata
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT DO NOTHING
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.approvalRequestId,
			input.decision,
			input.actorId,
			JSON.stringify(input.actorRoles),
			input.decisionReason ?? "",
			JSON.stringify(input.artifactIds ?? []),
			input.policyVersion,
			correlationId,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (rows[0]) return rowToApprovalDecision(rows[0]);
	const existing = await queryOne<ApprovalDecisionRow>(
		`
		SELECT *
		FROM approval_decisions
		WHERE approval_request_id = $1
		  AND actor_id = $2
		  AND decision = $3
		ORDER BY created_at DESC
		LIMIT 1
		`,
		[input.approvalRequestId, input.actorId, input.decision],
	);
	if (!existing) throw new Error("approval decision insert produced no row");
	return rowToApprovalDecision(existing);
}

export async function updateApprovalRequestState(input: {
	id: string;
	state: ApprovalRequestState;
	resolvedAt?: string | null;
	supersededAt?: string | null;
}): Promise<QualityApprovalRequest | undefined> {
	const row = await queryOne<ApprovalRequestRow>(
		`
		UPDATE approval_requests
		SET state = $2,
		    resolved_at = COALESCE($3::timestamptz, resolved_at),
		    superseded_at = COALESCE($4::timestamptz, superseded_at),
		    updated_at = now()
		WHERE id = $1
		RETURNING *
		`,
		[input.id, input.state, input.resolvedAt ?? null, input.supersededAt ?? null],
	);
	return row ? rowToApprovalRequest(row) : undefined;
}
