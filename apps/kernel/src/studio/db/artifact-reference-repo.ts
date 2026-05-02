// ---------------------------------------------------------------------------
// Oscorpex — Artifact Reference Repository
// SQL boundary for artifact_references persistence and version history.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { query, queryOne, withTransaction } from "../pg.js";

export type ArtifactStatus = "registered" | "verified" | "rejected" | "stale" | "superseded" | "archived";

export interface ArtifactReferenceRow {
	id: string;
	tenantId: string | null;
	projectId: string | null;
	goalId: string | null;
	releaseCandidateId: string | null;
	approvalRequestId: string | null;
	releaseDecisionId: string | null;
	rollbackTriggerId: string | null;
	artifactType: string;
	title: string;
	status: ArtifactStatus;
	location: string;
	digest: string;
	producedBy: string;
	contentType: string | null;
	sizeBytes: number | null;
	policyVersion: string;
	correlationId: string;
	producedAt: string;
	verifiedAt: string | null;
	createdAt: string;
	updatedAt: string;
	supersededAt: string | null;
	metadata: Record<string, unknown>;
}

export interface InsertArtifactReferenceInput {
	tenantId: string | null;
	projectId: string;
	goalId: string;
	releaseCandidateId?: string | null;
	approvalRequestId?: string | null;
	releaseDecisionId?: string | null;
	rollbackTriggerId?: string | null;
	artifactType: string;
	title: string;
	status: ArtifactStatus;
	location: string;
	digest: string;
	producedBy: string;
	contentType?: string | null;
	sizeBytes?: number | null;
	policyVersion?: string;
	correlationId?: string;
	producedAt?: string;
	verifiedAt?: string | null;
	metadata?: Record<string, unknown>;
}

interface ArtifactReferenceDbRow {
	id: string;
	tenant_id: string | null;
	project_id: string | null;
	goal_id: string | null;
	release_candidate_id: string | null;
	approval_request_id: string | null;
	release_decision_id: string | null;
	rollback_trigger_id: string | null;
	artifact_type: string;
	title: string;
	status: ArtifactStatus;
	location: string;
	digest: string;
	produced_by: string;
	content_type: string | null;
	size_bytes: number | null;
	policy_version: string;
	correlation_id: string;
	produced_at: string;
	verified_at: string | null;
	created_at: string;
	updated_at: string;
	superseded_at: string | null;
	metadata: Record<string, unknown> | string;
}

function parseJson<T>(value: T | string): T {
	return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function mapRow(row: ArtifactReferenceDbRow): ArtifactReferenceRow {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		projectId: row.project_id,
		goalId: row.goal_id,
		releaseCandidateId: row.release_candidate_id,
		approvalRequestId: row.approval_request_id,
		releaseDecisionId: row.release_decision_id,
		rollbackTriggerId: row.rollback_trigger_id,
		artifactType: row.artifact_type,
		title: row.title,
		status: row.status,
		location: row.location,
		digest: row.digest,
		producedBy: row.produced_by,
		contentType: row.content_type,
		sizeBytes: row.size_bytes,
		policyVersion: row.policy_version,
		correlationId: row.correlation_id,
		producedAt: row.produced_at,
		verifiedAt: row.verified_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		supersededAt: row.superseded_at,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
	};
}

export async function insertArtifactReference(input: InsertArtifactReferenceInput): Promise<ArtifactReferenceRow> {
	const id = randomUUID();
	const correlationId = input.correlationId ?? randomUUID();
	const rows = await query<ArtifactReferenceDbRow>(
		`
		INSERT INTO artifact_references (
		  id, tenant_id, project_id, goal_id, release_candidate_id,
		  approval_request_id, release_decision_id, rollback_trigger_id,
		  artifact_type, title, status, location, digest, produced_by,
		  content_type, size_bytes, policy_version, correlation_id,
		  produced_at, verified_at, metadata
		)
		VALUES (
		  $1, $2, $3, $4, $5,
		  $6, $7, $8,
		  $9, $10, $11, $12, $13, $14,
		  $15, $16, $17, $18,
		  $19, $20, $21
		)
		RETURNING *
		`,
		[
			id,
			input.tenantId,
			input.projectId,
			input.goalId,
			input.releaseCandidateId ?? null,
			input.approvalRequestId ?? null,
			input.releaseDecisionId ?? null,
			input.rollbackTriggerId ?? null,
			input.artifactType,
			input.title,
			input.status,
			input.location,
			input.digest,
			input.producedBy,
			input.contentType ?? null,
			input.sizeBytes ?? null,
			input.policyVersion ?? "1",
			correlationId,
			input.producedAt ?? new Date().toISOString(),
			input.verifiedAt ?? null,
			JSON.stringify(input.metadata ?? {}),
		],
	);
	if (!rows[0]) throw new Error("artifact reference insert produced no row");
	return mapRow(rows[0]);
}

export async function getArtifactById(id: string): Promise<ArtifactReferenceRow | undefined> {
	const row = await queryOne<ArtifactReferenceDbRow>("SELECT * FROM artifact_references WHERE id = $1", [id]);
	return row ? mapRow(row) : undefined;
}

export async function listArtifactsForGoal(goalId: string): Promise<ArtifactReferenceRow[]> {
	const rows = await query<ArtifactReferenceDbRow>(
		`
		SELECT *
		FROM artifact_references
		WHERE goal_id = $1
		ORDER BY created_at DESC, id DESC
		`,
		[goalId],
	);
	return rows.map(mapRow);
}

export async function listLatestArtifactsForGoal(goalId: string): Promise<ArtifactReferenceRow[]> {
	const rows = await query<ArtifactReferenceDbRow>(
		`
		SELECT DISTINCT ON (artifact_type) *
		FROM artifact_references
		WHERE goal_id = $1
		  AND superseded_at IS NULL
		ORDER BY artifact_type, created_at DESC, id DESC
		`,
		[goalId],
	);
	return rows.map(mapRow);
}

export async function supersedeArtifactById(id: string): Promise<void> {
	await query(
		`
		UPDATE artifact_references
		SET superseded_at = now(),
		    updated_at = now()
		WHERE id = $1
		  AND superseded_at IS NULL
		`,
		[id],
	);
}

export async function supersedeActiveArtifactsByType(input: {
	goalId: string;
	artifactType: string;
	excludeArtifactId?: string;
}): Promise<void> {
	await query(
		`
		UPDATE artifact_references
		SET superseded_at = now(),
		    updated_at = now()
		WHERE goal_id = $1
		  AND artifact_type = $2
		  AND superseded_at IS NULL
		  AND ($3::text IS NULL OR id <> $3)
		`,
		[input.goalId, input.artifactType, input.excludeArtifactId ?? null],
	);
}

export async function insertArtifactAndSupersedePrevious(
	input: InsertArtifactReferenceInput,
): Promise<ArtifactReferenceRow> {
	return withTransaction(async (client) => {
		const id = randomUUID();
		const correlationId = input.correlationId ?? randomUUID();
		await client.query(
			`
			UPDATE artifact_references
			SET superseded_at = now(),
			    updated_at = now()
			WHERE goal_id = $1
			  AND artifact_type = $2
			  AND superseded_at IS NULL
			`,
			[input.goalId, input.artifactType],
		);
		const inserted = await client.query<ArtifactReferenceDbRow>(
			`
			INSERT INTO artifact_references (
			  id, tenant_id, project_id, goal_id, release_candidate_id,
			  approval_request_id, release_decision_id, rollback_trigger_id,
			  artifact_type, title, status, location, digest, produced_by,
			  content_type, size_bytes, policy_version, correlation_id,
			  produced_at, verified_at, metadata
			)
			VALUES (
			  $1, $2, $3, $4, $5,
			  $6, $7, $8,
			  $9, $10, $11, $12, $13, $14,
			  $15, $16, $17, $18,
			  $19, $20, $21
			)
			RETURNING *
			`,
			[
				id,
				input.tenantId,
				input.projectId,
				input.goalId,
				input.releaseCandidateId ?? null,
				input.approvalRequestId ?? null,
				input.releaseDecisionId ?? null,
				input.rollbackTriggerId ?? null,
				input.artifactType,
				input.title,
				input.status,
				input.location,
				input.digest,
				input.producedBy,
				input.contentType ?? null,
				input.sizeBytes ?? null,
				input.policyVersion ?? "1",
				correlationId,
				input.producedAt ?? new Date().toISOString(),
				input.verifiedAt ?? null,
				JSON.stringify(input.metadata ?? {}),
			],
		);
		if (!inserted.rows[0]) throw new Error("artifact reference insert produced no row");
		return mapRow(inserted.rows[0]);
	});
}
