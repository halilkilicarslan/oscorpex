// ---------------------------------------------------------------------------
// Oscorpex — ArtifactReferenceService
// Canonical artifact metadata, verification and completeness layer.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
	type ArtifactReferenceRow,
	type ArtifactStatus,
	getArtifactById,
	insertArtifactAndSupersedePrevious,
	insertArtifactReference,
	listArtifactsForGoal,
	listLatestArtifactsForGoal,
	supersedeArtifactById,
} from "./db/artifact-reference-repo.js";
import { type QualityGateEnvironment, getGoalScope } from "./db/quality-gate-repo.js";
import { getLatestReleaseCandidateForGoal } from "./db/release-decision-repo.js";
import { eventBus } from "./event-bus.js";

export interface ArtifactReferenceInput {
	goalId: string;
	tenantId: string | null;
	artifactType: string;
	title: string;
	uri?: string;
	checksum?: string;
	createdBy?: string;
	environment: QualityGateEnvironment;
	releaseCandidateId?: string | null;
	approvalRequestId?: string | null;
	releaseDecisionId?: string | null;
	rollbackTriggerId?: string | null;
	contentType?: string;
	sizeBytes?: number;
	metadata?: Record<string, unknown>;
}

export interface VerifyArtifactInput {
	artifactId: string;
	verifiedBy: string;
	reason?: string;
	metadata?: Record<string, unknown>;
}

export interface RejectArtifactInput {
	artifactId: string;
	rejectedBy: string;
	reason: string;
	metadata?: Record<string, unknown>;
}

export interface SupersedeArtifactInput {
	artifactId: string;
	supersededBy?: string;
	reason?: string;
	metadata?: Record<string, unknown>;
}

export interface ArtifactCompletenessState {
	satisfied: boolean;
	missingArtifacts: string[];
	staleArtifacts: ArtifactReferenceRow[];
	rejectedArtifacts: ArtifactReferenceRow[];
	latestArtifacts: ArtifactReferenceRow[];
	requiredArtifacts: string[];
	environment: QualityGateEnvironment;
}

export class ArtifactReferenceService {
	private static readonly REQUIRED_BY_ENV: Record<QualityGateEnvironment, string[]> = {
		dev: ["test_report", "diff_report", "generated_deliverable"],
		staging: ["test_report", "security_scan_result", "review_summary", "diff_report", "deployment_plan"],
		production: [
			"test_report",
			"security_scan_result",
			"review_summary",
			"diff_report",
			"deployment_plan",
			"rollback_plan",
			"provider_routing_report",
			"approval_evidence",
			"generated_deliverable",
			"incident_note",
		],
	};

	private static readonly STALE_THRESHOLD_MS: Record<QualityGateEnvironment, number> = {
		dev: 7 * 24 * 60 * 60 * 1000,
		staging: 72 * 60 * 60 * 1000,
		production: 24 * 60 * 60 * 1000,
	};

	async registerArtifact(input: ArtifactReferenceInput): Promise<ArtifactReferenceRow> {
		const scope = await this.assertGoalExists(input.goalId);
		const tenantId = input.tenantId ?? scope.tenantId;
		if (input.environment === "production" && !tenantId) {
			throw new Error(`tenant_id is required for production artifacts (goal ${input.goalId})`);
		}

		const releaseCandidateId =
			input.releaseCandidateId ?? (await getLatestReleaseCandidateForGoal(input.goalId))?.id ?? null;

		const row = await insertArtifactAndSupersedePrevious({
			tenantId,
			projectId: scope.projectId,
			goalId: input.goalId,
			releaseCandidateId,
			approvalRequestId: input.approvalRequestId ?? null,
			releaseDecisionId: input.releaseDecisionId ?? null,
			rollbackTriggerId: input.rollbackTriggerId ?? null,
			artifactType: input.artifactType,
			title: input.title,
			status: "registered",
			location: input.uri ?? "",
			digest: input.checksum ?? "",
			producedBy: input.createdBy ?? "system",
			contentType: input.contentType ?? null,
			sizeBytes: input.sizeBytes ?? null,
			policyVersion: "1",
			correlationId: randomUUID(),
			metadata: {
				...input.metadata,
				environment: input.environment,
			},
		});

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "artifact.registered",
			payload: {
				goalId: input.goalId,
				artifactId: row.id,
				artifactType: row.artifactType,
				releaseCandidateId: row.releaseCandidateId ?? undefined,
			},
		});

		return row;
	}

	async verifyArtifact(input: VerifyArtifactInput): Promise<ArtifactReferenceRow> {
		const artifact = await this.requireArtifact(input.artifactId);
		const scope = await this.assertGoalExists(artifact.goalId ?? "");
		const verified = await insertArtifactAndSupersedePrevious({
			tenantId: artifact.tenantId,
			projectId: artifact.projectId ?? scope.projectId,
			goalId: artifact.goalId ?? "",
			releaseCandidateId: artifact.releaseCandidateId,
			approvalRequestId: artifact.approvalRequestId,
			releaseDecisionId: artifact.releaseDecisionId,
			rollbackTriggerId: artifact.rollbackTriggerId,
			artifactType: artifact.artifactType,
			title: artifact.title,
			status: "verified",
			location: artifact.location,
			// Keep original checksum in metadata and ensure append-history rows
			// do not violate uq_artifact_ref_digest_scope.
			digest: `${artifact.digest}#verified:${randomUUID()}`,
			producedBy: artifact.producedBy,
			contentType: artifact.contentType,
			sizeBytes: artifact.sizeBytes,
			policyVersion: artifact.policyVersion,
			correlationId: randomUUID(),
			verifiedAt: new Date().toISOString(),
			metadata: {
				...(artifact.metadata ?? {}),
				originalDigest: artifact.digest,
				verification: {
					verifiedBy: input.verifiedBy,
					reason: input.reason ?? "",
				},
				...input.metadata,
			},
		});
		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "artifact.verified",
			payload: {
				goalId: verified.goalId ?? undefined,
				artifactId: verified.id,
				artifactType: verified.artifactType,
				verifiedBy: input.verifiedBy,
			},
		});
		return verified;
	}

	async rejectArtifact(input: RejectArtifactInput): Promise<ArtifactReferenceRow> {
		const artifact = await this.requireArtifact(input.artifactId);
		const scope = await this.assertGoalExists(artifact.goalId ?? "");
		const rejected = await insertArtifactAndSupersedePrevious({
			tenantId: artifact.tenantId,
			projectId: artifact.projectId ?? scope.projectId,
			goalId: artifact.goalId ?? "",
			releaseCandidateId: artifact.releaseCandidateId,
			approvalRequestId: artifact.approvalRequestId,
			releaseDecisionId: artifact.releaseDecisionId,
			rollbackTriggerId: artifact.rollbackTriggerId,
			artifactType: artifact.artifactType,
			title: artifact.title,
			status: "rejected",
			location: artifact.location,
			digest: `${artifact.digest}#rejected:${randomUUID()}`,
			producedBy: artifact.producedBy,
			contentType: artifact.contentType,
			sizeBytes: artifact.sizeBytes,
			policyVersion: artifact.policyVersion,
			correlationId: randomUUID(),
			metadata: {
				...(artifact.metadata ?? {}),
				originalDigest: artifact.digest,
				rejection: {
					rejectedBy: input.rejectedBy,
					reason: input.reason,
				},
				...input.metadata,
			},
		});
		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "artifact.rejected",
			payload: {
				goalId: rejected.goalId ?? undefined,
				artifactId: rejected.id,
				artifactType: rejected.artifactType,
				reason: input.reason,
			},
		});
		return rejected;
	}

	async supersedeArtifact(input: SupersedeArtifactInput): Promise<void> {
		const artifact = await this.requireArtifact(input.artifactId);
		if (!artifact.goalId) throw new Error(`artifact ${input.artifactId} has no goal reference`);
		const scope = await this.assertGoalExists(artifact.goalId);
		await supersedeArtifactById(input.artifactId);
		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "artifact.superseded",
			payload: {
				goalId: artifact.goalId,
				artifactId: artifact.id,
				artifactType: artifact.artifactType,
				supersededBy: input.supersededBy ?? "system",
				reason: input.reason ?? "",
			},
		});
	}

	async getArtifacts(goalId: string): Promise<ArtifactReferenceRow[]> {
		await this.assertGoalExists(goalId);
		return listArtifactsForGoal(goalId);
	}

	async getRequiredArtifacts(goalId: string): Promise<string[]> {
		const env = await this.resolveEnvironment(goalId);
		return [...ArtifactReferenceService.REQUIRED_BY_ENV[env]];
	}

	async isArtifactCompletenessSatisfied(goalId: string): Promise<ArtifactCompletenessState> {
		return this.resolveArtifactState(goalId);
	}

	async resolveArtifactState(goalId: string): Promise<ArtifactCompletenessState> {
		const scope = await this.assertGoalExists(goalId);
		const environment = await this.resolveEnvironment(goalId);
		const latest = await listLatestArtifactsForGoal(goalId);
		if (environment === "production" && !scope.tenantId) {
			const state: ArtifactCompletenessState = {
				satisfied: false,
				missingArtifacts: [...ArtifactReferenceService.REQUIRED_BY_ENV.production],
				staleArtifacts: [],
				rejectedArtifacts: [],
				latestArtifacts: latest,
				requiredArtifacts: [...ArtifactReferenceService.REQUIRED_BY_ENV.production],
				environment,
			};
			await eventBus.emitAsync({
				projectId: scope.projectId,
				type: "artifact.blocked",
				payload: {
					goalId,
					reason: "tenant_id required for production artifacts",
					missingArtifacts: state.missingArtifacts,
				},
			});
			return state;
		}

		const required = [...ArtifactReferenceService.REQUIRED_BY_ENV[environment]];
		const byType = new Map(latest.map((artifact) => [artifact.artifactType, artifact]));
		const missing = required.filter((type) => !byType.get(type));
		const stale = latest.filter((artifact) => this.isStale(artifact, environment));
		const rejected = latest.filter((artifact) => artifact.status === "rejected");
		const unverifiedRequired = required
			.map((type) => byType.get(type))
			.filter((artifact): artifact is ArtifactReferenceRow => Boolean(artifact))
			.filter((artifact) => environment !== "dev" && artifact.status !== "verified");

		const blocked = missing.length > 0 || stale.length > 0 || rejected.length > 0 || unverifiedRequired.length > 0;
		const result: ArtifactCompletenessState = {
			satisfied: !blocked,
			missingArtifacts: missing,
			staleArtifacts: stale,
			rejectedArtifacts: rejected,
			latestArtifacts: latest,
			requiredArtifacts: required,
			environment,
		};

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: blocked ? "artifact.blocked" : "artifact.completeness_satisfied",
			payload: {
				goalId,
				environment,
				missingArtifacts: missing,
				staleCount: stale.length,
				rejectedCount: rejected.length,
			},
		});

		return result;
	}

	private async assertGoalExists(goalId: string) {
		const scope = await getGoalScope(goalId);
		if (!scope) throw new Error(`execution goal not found: ${goalId}`);
		return scope;
	}

	private async requireArtifact(artifactId: string): Promise<ArtifactReferenceRow> {
		const artifact = await getArtifactById(artifactId);
		if (!artifact) throw new Error(`artifact not found: ${artifactId}`);
		return artifact;
	}

	private async resolveEnvironment(goalId: string): Promise<QualityGateEnvironment> {
		const releaseCandidate = await getLatestReleaseCandidateForGoal(goalId);
		const env = (releaseCandidate?.targetEnvironment ?? "production") as QualityGateEnvironment;
		return env;
	}

	private isStale(artifact: ArtifactReferenceRow, environment: QualityGateEnvironment): boolean {
		if (artifact.status === "stale") return true;
		if (artifact.status === "superseded" || artifact.status === "archived") return true;
		const threshold = ArtifactReferenceService.STALE_THRESHOLD_MS[environment];
		const referenceTs = artifact.verifiedAt ?? artifact.producedAt ?? artifact.createdAt;
		const ts = new Date(referenceTs).getTime();
		if (!Number.isFinite(ts)) return true;
		return Date.now() - ts > threshold;
	}
}

export const artifactReferenceService = new ArtifactReferenceService();
