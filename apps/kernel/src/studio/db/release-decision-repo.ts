// ---------------------------------------------------------------------------
// Oscorpex — Release Decision Repository
// SQL boundary for release_candidates, release_decisions, override_actions,
// and rollback_triggers (append-only decision history).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { query, queryOne } from "../pg.js";

export type ReleaseTargetEnvironment = "dev" | "staging" | "production";

export interface ReleaseCandidate {
	id: string;
	tenantId: string | null;
	projectId: string | null;
	goalIds: string[];
	targetEnvironment: ReleaseTargetEnvironment;
	state: string;
	requestedBy: string;
	artifactIds: string[];
	policyVersion: string;
	correlationId: string;
	deployWindowStartsAt: string | null;
	deployWindowEndsAt: string | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	metadata: Record<string, unknown>;
}

export interface InsertReleaseCandidateInput {
	tenantId: string | null;
	projectId: string;
	goalIds: string[];
	targetEnvironment: ReleaseTargetEnvironment;
	requestedBy: string;
	artifactIds?: string[];
	policyVersion?: string;
	correlationId?: string;
	deployWindowStartsAt?: string | null;
	deployWindowEndsAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ReleaseDecisionRow {
	id: string;
	tenantId: string | null;
	releaseCandidateId: string;
	decision: string;
	allowed: boolean;
	blockedReasons: Record<string, unknown>[];
	requiredApprovals: string[];
	requiredArtifacts: string[];
	gateEvaluationIds: string[];
	approvalRequestIds: string[];
	approvalDecisionIds: string[];
	overrideActionIds: string[];
	rollbackTriggerIds: string[];
	rollbackAction: string;
	evaluatedBy: string;
	policyVersion: string;
	correlationId: string;
	createdAt: string;
	supersededAt: string | null;
	metadata: Record<string, unknown>;
}

export interface InsertReleaseDecisionInput {
	tenantId: string | null;
	releaseCandidateId: string;
	decision: string;
	allowed: boolean;
	blockedReasons?: Record<string, unknown>[];
	requiredApprovals?: string[];
	requiredArtifacts?: string[];
	gateEvaluationIds?: string[];
	approvalRequestIds?: string[];
	approvalDecisionIds?: string[];
	overrideActionIds?: string[];
	rollbackTriggerIds?: string[];
	rollbackAction?: string;
	evaluatedBy?: string;
	policyVersion: string;
	correlationId?: string;
	metadata?: Record<string, unknown>;
}

export interface ReleaseOverrideAction {
	id: string;
	tenantId: string | null;
	releaseCandidateId: string;
	gateEvaluationId: string | null;
	approvalRequestId: string | null;
	overrideClass: string;
	state: string;
	requestedBy: string;
	approvedBy: string | null;
	reason: string;
	scope: Record<string, unknown>;
	expiresAt: string;
	revokedAt: string | null;
	policyVersion: string;
	correlationId: string;
	createdAt: string;
	updatedAt: string;
	supersededAt: string | null;
	metadata: Record<string, unknown>;
}

export interface InsertOverrideActionInput {
	tenantId: string | null;
	releaseCandidateId: string;
	gateEvaluationId: string | null;
	approvalRequestId?: string | null;
	overrideClass: string;
	requestedBy: string;
	approvedBy?: string | null;
	reason: string;
	scope?: Record<string, unknown>;
	expiresAt: string;
	policyVersion: string;
	correlationId?: string;
	metadata?: Record<string, unknown>;
}

export interface ReleaseRollbackTrigger {
	id: string;
	tenantId: string | null;
	releaseCandidateId: string;
	triggerType: string;
	severity: string;
	state: string;
	automatic: boolean;
	source: string;
	reason: string;
	qualitySignalIds: string[];
	artifactIds: string[];
	incidentId: string | null;
	resolvedBy: string | null;
	resolvedAt: string | null;
	policyVersion: string;
	correlationId: string;
	createdAt: string;
	updatedAt: string;
	supersededAt: string | null;
	metadata: Record<string, unknown>;
}

export interface InsertRollbackTriggerInput {
	tenantId: string | null;
	releaseCandidateId: string;
	triggerType: string;
	severity: string;
	state?: string;
	automatic?: boolean;
	source: string;
	reason: string;
	qualitySignalIds?: string[];
	artifactIds?: string[];
	incidentId?: string | null;
	policyVersion: string;
	correlationId?: string;
	metadata?: Record<string, unknown>;
}

interface ReleaseCandidateRow {
	id: string;
	tenant_id: string | null;
	project_id: string | null;
	goal_ids: string[] | string;
	target_environment: ReleaseTargetEnvironment;
	state: string;
	requested_by: string;
	artifact_ids: string[] | string;
	policy_version: string;
	correlation_id: string;
	deploy_window_starts_at: string | null;
	deploy_window_ends_at: string | null;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	metadata: Record<string, unknown> | string;
}

interface ReleaseDecisionDbRow {
	id: string;
	tenant_id: string | null;
	release_candidate_id: string;
	decision: string;
	allowed: boolean;
	blocked_reasons: Record<string, unknown>[] | string;
	required_approvals: string[] | string;
	required_artifacts: string[] | string;
	gate_evaluation_ids: string[] | string;
	approval_request_ids: string[] | string;
	approval_decision_ids: string[] | string;
	override_action_ids: string[] | string;
	rollback_trigger_ids: string[] | string;
	rollback_action: string;
	evaluated_by: string;
	policy_version: string;
	correlation_id: string;
	created_at: string;
	superseded_at: string | null;
	metadata: Record<string, unknown> | string;
}

interface OverrideActionRow {
	id: string;
	tenant_id: string | null;
	release_candidate_id: string;
	gate_evaluation_id: string | null;
	approval_request_id: string | null;
	override_class: string;
	state: string;
	requested_by: string;
	approved_by: string | null;
	reason: string;
	scope: Record<string, unknown> | string;
	expires_at: string;
	revoked_at: string | null;
	policy_version: string;
	correlation_id: string;
	created_at: string;
	updated_at: string;
	superseded_at: string | null;
	metadata: Record<string, unknown> | string;
}

interface RollbackTriggerRow {
	id: string;
	tenant_id: string | null;
	release_candidate_id: string;
	trigger_type: string;
	severity: string;
	state: string;
	automatic: boolean;
	source: string;
	reason: string;
	quality_signal_ids: string[] | string;
	artifact_ids: string[] | string;
	incident_id: string | null;
	resolved_by: string | null;
	resolved_at: string | null;
	policy_version: string;
	correlation_id: string;
	created_at: string;
	updated_at: string;
	superseded_at: string | null;
	metadata: Record<string, unknown> | string;
}

function parseJson<T>(value: T | string): T {
	return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function rowToReleaseCandidate(row: ReleaseCandidateRow): ReleaseCandidate {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		projectId: row.project_id,
		goalIds: parseJson<string[]>(row.goal_ids),
		targetEnvironment: row.target_environment,
		state: row.state,
		requestedBy: row.requested_by,
		artifactIds: parseJson<string[]>(row.artifact_ids),
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		deployWindowStartsAt: row.deploy_window_starts_at,
		deployWindowEndsAt: row.deploy_window_ends_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		closedAt: row.closed_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

function rowToReleaseDecision(row: ReleaseDecisionDbRow): ReleaseDecisionRow {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		releaseCandidateId: row.release_candidate_id,
		decision: row.decision,
		allowed: row.allowed,
		blockedReasons: parseJson<Record<string, unknown>[]>(row.blocked_reasons),
		requiredApprovals: parseJson<string[]>(row.required_approvals),
		requiredArtifacts: parseJson<string[]>(row.required_artifacts),
		gateEvaluationIds: parseJson<string[]>(row.gate_evaluation_ids),
		approvalRequestIds: parseJson<string[]>(row.approval_request_ids),
		approvalDecisionIds: parseJson<string[]>(row.approval_decision_ids),
		overrideActionIds: parseJson<string[]>(row.override_action_ids),
		rollbackTriggerIds: parseJson<string[]>(row.rollback_trigger_ids),
		rollbackAction: row.rollback_action,
		evaluatedBy: row.evaluated_by,
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		createdAt: row.created_at,
		supersededAt: row.superseded_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

function rowToOverrideAction(row: OverrideActionRow): ReleaseOverrideAction {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		releaseCandidateId: row.release_candidate_id,
		gateEvaluationId: row.gate_evaluation_id,
		approvalRequestId: row.approval_request_id,
		overrideClass: row.override_class,
		state: row.state,
		requestedBy: row.requested_by,
		approvedBy: row.approved_by,
		reason: row.reason,
		scope: parseJson<Record<string, unknown>>(row.scope),
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		supersededAt: row.superseded_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

function rowToRollbackTrigger(row: RollbackTriggerRow): ReleaseRollbackTrigger {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		releaseCandidateId: row.release_candidate_id,
		triggerType: row.trigger_type,
		severity: row.severity,
		state: row.state,
		automatic: row.automatic,
		source: row.source,
		reason: row.reason,
		qualitySignalIds: parseJson<string[]>(row.quality_signal_ids),
		artifactIds: parseJson<string[]>(row.artifact_ids),
		incidentId: row.incident_id,
		resolvedBy: row.resolved_by,
		resolvedAt: row.resolved_at,
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		supersededAt: row.superseded_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

// ---------------------------------------------------------------------------
// Release candidates
// ---------------------------------------------------------------------------

export async function createReleaseCandidate(input: InsertReleaseCandidateInput): Promise<ReleaseCandidate> {
	const id = randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<ReleaseCandidateRow>(
		`
		INSERT INTO release_candidates (
		  id, tenant_id, project_id, goal_ids, target_environment, state,
		  requested_by, artifact_ids, policy_version, correlation_id,
		  deploy_window_starts_at, deploy_window_ends_at, metadata
		)
		VALUES ($1, $2, $3, $4, $5, 'candidate', $6, $7, $8, $9, $10, $11, $12)
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.projectId,
			JSON.stringify(input.goalIds),
			input.targetEnvironment,
			input.requestedBy,
			JSON.stringify(input.artifactIds ?? []),
			input.policyVersion ?? "1",
			correlationId,
			input.deployWindowStartsAt ?? null,
			input.deployWindowEndsAt ?? null,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (!rows[0]) throw new Error("release candidate insert produced no row");
	return rowToReleaseCandidate(rows[0]);
}

export async function getLatestReleaseCandidateForGoal(goalId: string): Promise<ReleaseCandidate | undefined> {
	const row = await queryOne<ReleaseCandidateRow>(
		`
		SELECT *
		FROM release_candidates
		WHERE goal_ids @> $1::jsonb
		ORDER BY created_at DESC, id DESC
		LIMIT 1
		`,
		[JSON.stringify([goalId])],
	);
	return row ? rowToReleaseCandidate(row) : undefined;
}

export async function getReleaseCandidateById(id: string): Promise<ReleaseCandidate | undefined> {
	const row = await queryOne<ReleaseCandidateRow>("SELECT * FROM release_candidates WHERE id = $1", [id]);
	return row ? rowToReleaseCandidate(row) : undefined;
}

// ---------------------------------------------------------------------------
// Release decisions (append-only)
// ---------------------------------------------------------------------------

export async function insertReleaseDecision(input: InsertReleaseDecisionInput): Promise<ReleaseDecisionRow> {
	const id = randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<ReleaseDecisionDbRow>(
		`
		INSERT INTO release_decisions (
		  id, tenant_id, release_candidate_id, decision, allowed,
		  blocked_reasons, required_approvals, required_artifacts,
		  gate_evaluation_ids, approval_request_ids, approval_decision_ids,
		  override_action_ids, rollback_trigger_ids, rollback_action,
		  evaluated_by, policy_version, correlation_id, metadata
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.releaseCandidateId,
			input.decision,
			input.allowed,
			JSON.stringify(input.blockedReasons ?? []),
			JSON.stringify(input.requiredApprovals ?? []),
			JSON.stringify(input.requiredArtifacts ?? []),
			JSON.stringify(input.gateEvaluationIds ?? []),
			JSON.stringify(input.approvalRequestIds ?? []),
			JSON.stringify(input.approvalDecisionIds ?? []),
			JSON.stringify(input.overrideActionIds ?? []),
			JSON.stringify(input.rollbackTriggerIds ?? []),
			input.rollbackAction ?? "none",
			input.evaluatedBy ?? "system",
			input.policyVersion,
			correlationId,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (!rows[0]) throw new Error("release decision insert produced no row");
	return rowToReleaseDecision(rows[0]);
}

export async function getLatestReleaseDecisionForCandidate(
	releaseCandidateId: string,
): Promise<ReleaseDecisionRow | undefined> {
	const row = await queryOne<ReleaseDecisionDbRow>(
		`
		SELECT *
		FROM release_decisions
		WHERE release_candidate_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT 1
		`,
		[releaseCandidateId],
	);
	return row ? rowToReleaseDecision(row) : undefined;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export async function insertOverrideActionActive(input: InsertOverrideActionInput): Promise<ReleaseOverrideAction> {
	const id = randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<OverrideActionRow>(
		`
		INSERT INTO override_actions (
		  id, tenant_id, release_candidate_id, gate_evaluation_id,
		  approval_request_id, override_class, state, requested_by,
		  approved_by, reason, scope, expires_at, policy_version,
		  correlation_id, metadata
		)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.releaseCandidateId,
			input.gateEvaluationId,
			input.approvalRequestId ?? null,
			input.overrideClass,
			input.requestedBy,
			input.approvedBy ?? null,
			input.reason,
			JSON.stringify(input.scope ?? {}),
			input.expiresAt,
			input.policyVersion,
			correlationId,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (!rows[0]) throw new Error("override action insert produced no row");
	return rowToOverrideAction(rows[0]);
}

// ---------------------------------------------------------------------------
// Rollback triggers
// ---------------------------------------------------------------------------

export async function insertRollbackTrigger(input: InsertRollbackTriggerInput): Promise<ReleaseRollbackTrigger> {
	const id = randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<RollbackTriggerRow>(
		`
		INSERT INTO rollback_triggers (
		  id, tenant_id, release_candidate_id, trigger_type, severity, state,
		  automatic, source, reason, quality_signal_ids, artifact_ids,
		  incident_id, policy_version, correlation_id, metadata
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.releaseCandidateId,
			input.triggerType,
			input.severity,
			input.state ?? "detected",
			input.automatic ?? false,
			input.source,
			input.reason,
			JSON.stringify(input.qualitySignalIds ?? []),
			JSON.stringify(input.artifactIds ?? []),
			input.incidentId ?? null,
			input.policyVersion,
			correlationId,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (!rows[0]) throw new Error("rollback trigger insert produced no row");
	return rowToRollbackTrigger(rows[0]);
}

export async function listActiveRollbackTriggersForCandidate(
	releaseCandidateId: string,
): Promise<ReleaseRollbackTrigger[]> {
	const rows = await query<RollbackTriggerRow>(
		`
		SELECT *
		FROM rollback_triggers
		WHERE release_candidate_id = $1
		  AND state IN ('detected', 'validating', 'rollback-required', 'rollback-recommended')
		  AND superseded_at IS NULL
		ORDER BY created_at DESC, id DESC
		`,
		[releaseCandidateId],
	);
	return rows.map(rowToRollbackTrigger);
}
