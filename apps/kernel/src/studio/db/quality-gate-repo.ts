// ---------------------------------------------------------------------------
// Oscorpex — Quality Gate Repository
// SQL boundary for Quality Gates Center gate policy and evaluation persistence.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";

export type QualityGateEnvironment = "dev" | "staging" | "production";
export type QualityGateOutcome = "passed" | "failed" | "warning" | "blocked";

export interface QualityGatePolicy {
	id: string;
	name: string;
	description: string;
	tenantId: string | null;
	projectId: string | null;
	gateType: string;
	environment: QualityGateEnvironment;
	required: boolean;
	blocking: boolean;
	autoEvaluated: boolean;
	humanReviewed: boolean;
	overrideAllowed: boolean;
	overrideRoles: string[];
	ownerRole: string;
	thresholds: Record<string, unknown>;
	status: string;
	policyVersion: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	supersededAt: string | null;
}

export interface QualityGateEvaluation {
	id: string;
	tenantId: string | null;
	projectId: string | null;
	goalId: string;
	releaseCandidateId: string | null;
	gateId: string;
	gateType: string;
	scope: string;
	outcome: QualityGateOutcome;
	blocking: boolean;
	required: boolean;
	reason: string;
	details: Record<string, unknown>;
	qualitySignalIds: string[];
	artifactIds: string[];
	evaluatedBy: string;
	policyVersion: string;
	correlationId: string;
	idempotencyKey: string | null;
	createdAt: string;
	supersededAt: string | null;
	metadata: Record<string, unknown>;
}

export interface GoalScope {
	goalId: string;
	projectId: string;
	tenantId: string | null;
}

export interface RecordQualityGateEvaluationRowInput {
	id?: string;
	tenantId: string | null;
	projectId: string;
	goalId: string;
	releaseCandidateId?: string | null;
	gateId: string;
	gateType: string;
	scope: string;
	outcome: QualityGateOutcome;
	blocking: boolean;
	required: boolean;
	reason: string;
	details?: Record<string, unknown>;
	qualitySignalIds?: string[];
	artifactIds?: string[];
	evaluatedBy: string;
	policyVersion: string;
	correlationId?: string;
	idempotencyKey?: string | null;
	metadata?: Record<string, unknown>;
}

interface QualityGatePolicyRow {
	id: string;
	name: string;
	description: string;
	tenant_id: string | null;
	project_id: string | null;
	gate_type: string;
	environment: QualityGateEnvironment;
	required: boolean;
	blocking: boolean;
	auto_evaluated: boolean;
	human_reviewed: boolean;
	override_allowed: boolean;
	override_roles: string[] | string;
	owner_role: string;
	thresholds: Record<string, unknown> | string;
	status: string;
	policy_version: string;
	metadata: Record<string, unknown> | string;
	created_at: string;
	updated_at: string;
	superseded_at: string | null;
}

interface QualityGateEvaluationRow {
	id: string;
	tenant_id: string | null;
	project_id: string | null;
	goal_id: string;
	release_candidate_id: string | null;
	gate_id: string;
	gate_type: string;
	scope: string;
	outcome: QualityGateOutcome;
	blocking: boolean;
	required: boolean;
	reason: string;
	details: Record<string, unknown> | string;
	quality_signal_ids: string[] | string;
	artifact_ids: string[] | string;
	evaluated_by: string;
	policy_version: string;
	correlation_id: string;
	idempotency_key: string | null;
	created_at: string;
	superseded_at: string | null;
	metadata: Record<string, unknown> | string;
}

function parseJson<T>(value: T | string): T {
	return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function rowToGate(row: QualityGatePolicyRow): QualityGatePolicy {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		tenantId: row.tenant_id,
		projectId: row.project_id,
		gateType: row.gate_type,
		environment: row.environment,
		required: row.required,
		blocking: row.blocking,
		autoEvaluated: row.auto_evaluated,
		humanReviewed: row.human_reviewed,
		overrideAllowed: row.override_allowed,
		overrideRoles: parseJson<string[]>(row.override_roles),
		ownerRole: row.owner_role,
		thresholds: parseJson<Record<string, unknown>>(row.thresholds),
		status: row.status,
		policyVersion: row.policy_version,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		supersededAt: row.superseded_at,
	};
}

function rowToEvaluation(row: QualityGateEvaluationRow): QualityGateEvaluation {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		projectId: row.project_id,
		goalId: row.goal_id,
		releaseCandidateId: row.release_candidate_id,
		gateId: row.gate_id,
		gateType: row.gate_type,
		scope: row.scope,
		outcome: row.outcome,
		blocking: row.blocking,
		required: row.required,
		reason: row.reason,
		details: parseJson<Record<string, unknown>>(row.details),
		qualitySignalIds: parseJson<string[]>(row.quality_signal_ids),
		artifactIds: parseJson<string[]>(row.artifact_ids),
		evaluatedBy: row.evaluated_by,
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		idempotencyKey: row.idempotency_key,
		createdAt: row.created_at,
		supersededAt: row.superseded_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

export async function getGoalScope(goalId: string): Promise<GoalScope | undefined> {
	const row = await queryOne<{ goal_id: string; project_id: string; tenant_id: string | null }>(
		`
		SELECT g.id AS goal_id, g.project_id, p.tenant_id
		FROM execution_goals g
		JOIN projects p ON p.id = g.project_id
		WHERE g.id = $1
		`,
		[goalId],
	);
	if (!row) return undefined;
	return { goalId: row.goal_id, projectId: row.project_id, tenantId: row.tenant_id };
}

export async function listRequiredQualityGates(input: {
	goalId: string;
	environment: QualityGateEnvironment;
	tenantId?: string | null;
	projectId?: string | null;
}): Promise<QualityGatePolicy[]> {
	const scope = input.projectId === undefined ? await getGoalScope(input.goalId) : undefined;
	const projectId = input.projectId ?? scope?.projectId ?? null;
	const tenantId = input.tenantId ?? scope?.tenantId ?? null;
	const rows = await query<QualityGatePolicyRow>(
		`
		SELECT DISTINCT ON (gate_type) *
		FROM quality_gates
		WHERE environment = $1
		  AND status = 'active'
		  AND superseded_at IS NULL
		  AND required = true
		  AND (tenant_id IS NULL OR tenant_id = $2)
		  AND (project_id IS NULL OR project_id = $3)
		ORDER BY
		  gate_type,
		  CASE WHEN project_id = $3 THEN 2 WHEN project_id IS NULL THEN 0 ELSE -1 END DESC,
		  CASE WHEN tenant_id = $2 THEN 2 WHEN tenant_id IS NULL THEN 0 ELSE -1 END DESC,
		  policy_version DESC,
		  created_at DESC
		`,
		[input.environment, tenantId, projectId],
	);
	return rows.map(rowToGate);
}

export async function findQualityGatePolicy(input: {
	goalId: string;
	gateType: string;
	environment: QualityGateEnvironment;
	tenantId?: string | null;
	projectId?: string | null;
}): Promise<QualityGatePolicy | undefined> {
	const scope = input.projectId === undefined ? await getGoalScope(input.goalId) : undefined;
	const projectId = input.projectId ?? scope?.projectId ?? null;
	const tenantId = input.tenantId ?? scope?.tenantId ?? null;
	const row = await queryOne<QualityGatePolicyRow>(
		`
		SELECT *
		FROM quality_gates
		WHERE gate_type = $1
		  AND environment = $2
		  AND status = 'active'
		  AND superseded_at IS NULL
		  AND (tenant_id IS NULL OR tenant_id = $3)
		  AND (project_id IS NULL OR project_id = $4)
		ORDER BY
		  CASE WHEN project_id = $4 THEN 2 WHEN project_id IS NULL THEN 0 ELSE -1 END DESC,
		  CASE WHEN tenant_id = $3 THEN 2 WHEN tenant_id IS NULL THEN 0 ELSE -1 END DESC,
		  policy_version DESC,
		  created_at DESC
		LIMIT 1
		`,
		[input.gateType, input.environment, tenantId, projectId],
	);
	return row ? rowToGate(row) : undefined;
}

export async function insertQualityGateEvaluation(
	input: RecordQualityGateEvaluationRowInput,
): Promise<QualityGateEvaluation> {
	const id = input.id ?? randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<QualityGateEvaluationRow>(
		`
		INSERT INTO quality_gate_evaluations (
		  id, tenant_id, project_id, goal_id, release_candidate_id, gate_id, gate_type,
		  scope, outcome, blocking, required, reason, details, quality_signal_ids,
		  artifact_ids, evaluated_by, policy_version, correlation_id, idempotency_key, metadata
		)
		VALUES (
		  $1, $2, $3, $4, $5, $6, $7,
		  $8, $9, $10, $11, $12, $13, $14,
		  $15, $16, $17, $18, $19, $20
		)
		ON CONFLICT DO NOTHING
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.projectId,
			input.goalId,
			input.releaseCandidateId ?? null,
			input.gateId,
			input.gateType,
			input.scope,
			input.outcome,
			input.blocking,
			input.required,
			input.reason,
			JSON.stringify(input.details ?? {}),
			JSON.stringify(input.qualitySignalIds ?? []),
			JSON.stringify(input.artifactIds ?? []),
			input.evaluatedBy,
			input.policyVersion,
			correlationId,
			input.idempotencyKey ?? null,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (rows[0]) return rowToEvaluation(rows[0]);
	if (!input.idempotencyKey || !input.tenantId) {
		throw new Error("quality gate evaluation insert produced no row");
	}
	const existing = await queryOne<QualityGateEvaluationRow>(
		"SELECT * FROM quality_gate_evaluations WHERE tenant_id = $1 AND idempotency_key = $2",
		[input.tenantId, input.idempotencyKey],
	);
	if (!existing) throw new Error("quality gate evaluation idempotency lookup failed");
	return rowToEvaluation(existing);
}

export async function listLatestQualityGateEvaluations(
	goalId: string,
	environment?: QualityGateEnvironment,
): Promise<QualityGateEvaluation[]> {
	const environmentClause = environment ? "AND scope = $2" : "";
	const params = environment ? [goalId, environment] : [goalId];
	const rows = await query<QualityGateEvaluationRow>(
		`
		SELECT DISTINCT ON (gate_type) *
		FROM quality_gate_evaluations
		WHERE goal_id = $1
		  AND superseded_at IS NULL
		  ${environmentClause}
		ORDER BY gate_type, created_at DESC, id DESC
		`,
		params,
	);
	return rows.map(rowToEvaluation);
}

export async function getLatestQualityGateEvaluation(input: {
	goalId: string;
	gateType: string;
	environment?: QualityGateEnvironment;
}): Promise<QualityGateEvaluation | undefined> {
	const environmentClause = input.environment ? "AND scope = $3" : "";
	const params = input.environment ? [input.goalId, input.gateType, input.environment] : [input.goalId, input.gateType];
	const row = await queryOne<QualityGateEvaluationRow>(
		`
		SELECT *
		FROM quality_gate_evaluations
		WHERE goal_id = $1
		  AND gate_type = $2
		  AND superseded_at IS NULL
		  ${environmentClause}
		ORDER BY created_at DESC, id DESC
		LIMIT 1
		`,
		params,
	);
	return row ? rowToEvaluation(row) : undefined;
}

export async function getQualityGateEvaluationById(id: string): Promise<QualityGateEvaluation | undefined> {
	const row = await queryOne<QualityGateEvaluationRow>("SELECT * FROM quality_gate_evaluations WHERE id = $1", [id]);
	return row ? rowToEvaluation(row) : undefined;
}

export async function hasActiveQualityGateOverride(input: {
	tenantId: string | null;
	evaluationId: string;
}): Promise<boolean> {
	const row = await queryOne<{ id: string }>(
		`
		SELECT id
		FROM override_actions
		WHERE gate_evaluation_id = $1
		  AND state = 'active'
		  AND superseded_at IS NULL
		  AND revoked_at IS NULL
		  AND expires_at > now()
		  AND ($2::text IS NULL OR tenant_id = $2)
		ORDER BY created_at DESC
		LIMIT 1
		`,
		[input.evaluationId, input.tenantId],
	);
	return Boolean(row);
}

// ---------------------------------------------------------------------------
// Verification Results — task-level artifact verification records
// ---------------------------------------------------------------------------

export interface VerificationResultRow {
	id: string;
	taskId: string;
	verificationType: string;
	status: "passed" | "failed";
	details: Record<string, unknown>;
	createdAt: string;
}

export async function recordVerificationResult(data: {
	taskId: string;
	verificationType: string;
	passed: boolean;
	details?: unknown;
}): Promise<void> {
	await execute(
		`INSERT INTO verification_results (id, task_id, verification_type, status, details, created_at)
		 VALUES ($1, $2, $3, $4, $5, now())`,
		[
			randomUUID(),
			data.taskId,
			data.verificationType,
			data.passed ? "passed" : "failed",
			JSON.stringify(data.details ?? {}),
		],
	);
}
