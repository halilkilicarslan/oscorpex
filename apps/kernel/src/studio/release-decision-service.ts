// ---------------------------------------------------------------------------
// Oscorpex — ReleaseDecisionService
// Canonical release candidate evaluation + final release decision layer.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { eventBus } from "./event-bus.js";
import { approvalService, type ApprovalValidityOutput } from "./approval-service.js";
import {
	qualityGateService,
	type ReleaseReadinessSummary,
	TenantRequiredForProductionError as TenantRequiredForProductionGateError,
} from "./quality-gate-service.js";
import {
	getGoalScope,
	findQualityGatePolicy,
	type GoalScope,
	type QualityGateEnvironment,
	type QualityGateEvaluation,
	getQualityGateEvaluationById,
} from "./db/quality-gate-repo.js";
import {
	createReleaseCandidate,
	getLatestReleaseCandidateForGoal,
	getLatestReleaseDecisionForCandidate,
	getReleaseCandidateById,
	insertReleaseDecision,
	insertOverrideActionActive,
	insertRollbackTrigger,
	listActiveRollbackTriggersForCandidate,
	type ReleaseCandidate,
	type ReleaseDecisionRow,
	type ReleaseRollbackTrigger,
} from "./db/release-decision-repo.js";

export interface ReleaseDecisionInput {
	goalId: string;
	tenantId?: string | null;
	environment?: QualityGateEnvironment;
	actor?: string;
	reason?: string;
	metadata?: Record<string, unknown>;
}

export interface ReleaseDecisionRecordInput extends ReleaseDecisionInput {
	releaseCandidateId: string;
}

export interface ManualOverrideInput {
	releaseCandidateId: string;
	gateEvaluationId: string;
	actorId: string;
	actorRoles: string[];
	reason: string;
	expiresAt: string;
	metadata?: Record<string, unknown>;
}

export interface RollbackTriggerInput {
	releaseCandidateId: string;
	triggerType:
		| "deployment_health"
		| "security_violation"
		| "cost_runaway"
		| "tenant_breach"
		| "approval_revoked"
		| "incident"
		| "post_release_validation";
	severity: "info" | "warning" | "high" | "critical";
	automatic?: boolean;
	source: string;
	reason: string;
	qualitySignalIds?: string[];
	artifactIds?: string[];
	incidentId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface BlockingReason {
	code:
		| "missing_evaluation"
		| "blocking_gate"
		| "approval_missing"
		| "approval_expired"
		| "approval_rejected"
		| "tenant_missing"
		| "rollback_required"
		| "rollback_recommended"
		| "unknown";
	source: "quality_gate" | "approval" | "tenant" | "rollback";
	gateType?: string;
	detail?: string;
	overrideAllowed?: boolean;
}

export interface ResolvedReleaseState {
	allowed: boolean;
	blocked: boolean;
	requiresOverride: boolean;
	rollbackRequired: boolean;
	blockingReasons: BlockingReason[];
	qualityGateSummary: ReleaseReadinessSummary | null;
	approvalSummary: ApprovalValidityOutput | null;
	latestDecision: ReleaseDecisionRow | null;
	rollbackTriggers: ReleaseRollbackTrigger[];
}

export class TenantRequiredForProductionReleaseError extends Error {
	constructor(goalId: string) {
		super(`tenant_id is required for production release decisions for goal ${goalId}`);
		this.name = "TenantRequiredForProductionReleaseError";
	}
}

export class ReleaseCandidateNotFoundError extends Error {
	constructor(goalId: string) {
		super(`no release candidate found for goal ${goalId}`);
		this.name = "ReleaseCandidateNotFoundError";
	}
}

export class NonOverridableGateError extends Error {
	constructor(gateType: string) {
		super(`gate ${gateType} cannot be overridden for production release`);
		this.name = "NonOverridableGateError";
	}
}

export class InvalidOverrideInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidOverrideInputError";
	}
}

export class ReleaseDecisionService {
	private static readonly MAX_OVERRIDE_DURATION_MS = 24 * 60 * 60 * 1000;

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	async createReleaseCandidate(input: {
		goalId: string;
		tenantId?: string | null;
		targetEnvironment?: QualityGateEnvironment;
		requestedBy?: string;
		artifactIds?: string[];
		policyVersion?: string;
		correlationId?: string;
		metadata?: Record<string, unknown>;
	}): Promise<ReleaseCandidate> {
		const scope = await this.assertGoalExists(input.goalId);
		const tenantId = input.tenantId ?? scope.tenantId;
		const environment: QualityGateEnvironment = input.targetEnvironment ?? "production";
		if (environment === "production" && !tenantId) {
			throw new TenantRequiredForProductionReleaseError(input.goalId);
		}
		const releaseCandidate = await createReleaseCandidate({
			tenantId,
			projectId: scope.projectId,
			goalIds: [input.goalId],
			targetEnvironment: environment,
			requestedBy: input.requestedBy ?? "system",
			artifactIds: input.artifactIds ?? [],
			policyVersion: input.policyVersion ?? "1",
			correlationId: input.correlationId ?? randomUUID(),
			metadata: input.metadata ?? {},
		});

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "release.candidate_created",
			payload: {
				goalId: input.goalId,
				releaseCandidateId: releaseCandidate.id,
				environment,
				actorId: input.requestedBy ?? "system",
				correlationId: input.correlationId,
			},
		});

		return releaseCandidate;
	}

	async evaluateReleaseDecision(goalId: string): Promise<ResolvedReleaseState> {
		const scope = await this.assertGoalExists(goalId);
		const latestCandidate = await getLatestReleaseCandidateForGoal(goalId);
		if (!latestCandidate) throw new ReleaseCandidateNotFoundError(goalId);
		const environment = latestCandidate.targetEnvironment as QualityGateEnvironment;
		if (environment === "production" && !latestCandidate.tenantId) {
			throw new TenantRequiredForProductionReleaseError(goalId);
		}

		return this.recordReleaseDecision({
			goalId,
			tenantId: latestCandidate.tenantId,
			environment,
		});
	}

	async recordReleaseDecision(input: ReleaseDecisionInput): Promise<ResolvedReleaseState> {
		const scope = await this.assertGoalExists(input.goalId);
		const environment: QualityGateEnvironment = input.environment ?? "production";
		if (environment === "production" && !scope.tenantId && !input.tenantId) {
			throw new TenantRequiredForProductionReleaseError(input.goalId);
		}

		const latestCandidate = await getLatestReleaseCandidateForGoal(input.goalId);
		if (!latestCandidate) throw new ReleaseCandidateNotFoundError(input.goalId);

		const tenantId = input.tenantId ?? latestCandidate.tenantId ?? scope.tenantId;
		if (environment === "production" && !tenantId) {
			throw new TenantRequiredForProductionReleaseError(input.goalId);
		}

		let gates: ReleaseReadinessSummary | null = null;
		let approvals: ApprovalValidityOutput | null = null;
		let blockingReasons: BlockingReason[] = [];

		try {
			gates = await qualityGateService.isReleaseReady(input.goalId, environment);
		} catch (err) {
			if (err instanceof TenantRequiredForProductionGateError) {
				blockingReasons.push({
					code: "tenant_missing",
					source: "tenant",
					detail: err.message,
				});
			} else {
				blockingReasons.push({
					code: "unknown",
					source: "quality_gate",
					detail: (err as Error).message,
				});
			}
		}

		try {
			approvals = await approvalService.resolveApprovalValidity(input.goalId);
		} catch (err) {
			blockingReasons.push({
				code: "unknown",
				source: "approval",
				detail: (err as Error).message,
			});
		}

		const rollbackTriggers = await listActiveRollbackTriggersForCandidate(latestCandidate.id);
		const { rollbackRequired, rollbackBlockingReasons } = this.resolveRollbackState(rollbackTriggers);
		blockingReasons = blockingReasons.concat(rollbackBlockingReasons);

		if (gates) {
			for (const blocking of gates.blockingGates) {
				if (blocking.gate?.gateType === "human_approval") {
					continue;
				}
				blockingReasons.push({
					code: blocking.evaluation ? "blocking_gate" : "missing_evaluation",
					source: "quality_gate",
					gateType: blocking.gateType,
					detail: blocking.reason,
					overrideAllowed: blocking.overrideAllowed,
				});
			}
			for (const missing of gates.missingEvaluations) {
				if (missing.gate?.gateType === "human_approval") {
					continue;
				}
				blockingReasons.push({
					code: "missing_evaluation",
					source: "quality_gate",
					gateType: missing.gate?.gateType,
					detail: missing.reason,
					overrideAllowed: missing.gate?.overrideAllowed,
				});
			}
		}

		if (approvals) {
			if (approvals.expired.length > 0) {
				blockingReasons.push({
					code: "approval_expired",
					source: "approval",
					detail: "one or more required approvals expired",
				});
			}
			if (approvals.rejected.length > 0) {
				blockingReasons.push({
					code: "approval_rejected",
					source: "approval",
					detail: "one or more required approvals were rejected",
				});
			}
			if (!approvals.satisfied) {
				blockingReasons.push({
					code: "approval_missing",
					source: "approval",
					detail: `${approvals.missingApprovals} approval(s) missing`,
				});
			}
		}

		const requiresOverride = (gates?.blockingGates ?? []).some(
			(g) => g.gate?.overrideAllowed && !g.overridden,
		);

		const gatesAreBlocking = this.isGateSummaryBlocking(gates);

		const blockedByGatesOrApprovals =
			(blockingReasons.length > 0 && !rollbackRequired) ||
			gatesAreBlocking ||
			Boolean(approvals && (!approvals.satisfied || approvals.blocked));

		const allowed = !rollbackRequired && !blockedByGatesOrApprovals;
		const blocked = !allowed;

		const decision = allowed ? "approved" : rollbackRequired ? "requires_rollback" : "blocked";

		const decisionRow = await insertReleaseDecision({
			tenantId,
			releaseCandidateId: latestCandidate.id,
			decision,
			allowed,
			blockedReasons: blockingReasons as unknown as Record<string, unknown>[],
			requiredApprovals: approvals
				? approvals.pending.map((state) => state.request.approvalClass)
				: [],
			requiredArtifacts: [],
			gateEvaluationIds: this.collectGateEvaluationIds(gates),
			approvalRequestIds: approvals ? approvals.states.map((state) => state.request.id) : [],
			approvalDecisionIds: approvals
				? approvals.states.flatMap((state) => state.decisions.map((d) => d.id))
				: [],
			overrideActionIds: [],
			rollbackTriggerIds: rollbackTriggers.map((trigger) => trigger.id),
			rollbackAction: rollbackRequired ? "automatic_required" : "none",
			evaluatedBy: input.actor ?? "system",
			policyVersion: latestCandidate.policyVersion,
			correlationId: randomUUID(),
			metadata: input.metadata ?? {},
		});

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "release.decision_recorded",
			payload: {
				goalId: input.goalId,
				releaseCandidateId: latestCandidate.id,
				releaseDecisionId: decisionRow.id,
				decision,
				allowed,
				blocked,
				rollbackRequired,
				blockingReasonCount: blockingReasons.length,
			},
		});

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: allowed ? "release.allowed" : "release.blocked",
			payload: allowed
				? {
						goalId: input.goalId,
						releaseCandidateId: latestCandidate.id,
						releaseDecisionId: decisionRow.id,
					}
				: {
						goalId: input.goalId,
						releaseCandidateId: latestCandidate.id,
						releaseDecisionId: decisionRow.id,
						reasonSummary: blockingReasons[0]?.detail ?? "release blocked",
						blockingReasonCount: blockingReasons.length,
						requiresOverride,
					},
		});

		if (rollbackRequired) {
			await eventBus.emitAsync({
				projectId: scope.projectId,
				type: "release.rollback_required",
				payload: {
					goalId: input.goalId,
					releaseCandidateId: latestCandidate.id,
					reason: "rollback required by active trigger(s)",
				},
			});
		}

		const latestDecision = await getLatestReleaseDecisionForCandidate(latestCandidate.id);

		return {
			allowed,
			blocked,
			requiresOverride,
			rollbackRequired,
			blockingReasons,
			qualityGateSummary: gates,
			approvalSummary: approvals,
			latestDecision: latestDecision ?? decisionRow,
			rollbackTriggers,
		};
	}

	async getReleaseDecision(goalId: string): Promise<ResolvedReleaseState> {
		const scope = await this.assertGoalExists(goalId);
		const latestCandidate = await getLatestReleaseCandidateForGoal(goalId);
		if (!latestCandidate) throw new ReleaseCandidateNotFoundError(goalId);
		const latestDecision = await getLatestReleaseDecisionForCandidate(latestCandidate.id);
		const rollbackTriggers = await listActiveRollbackTriggersForCandidate(latestCandidate.id);
		return {
			allowed: latestDecision?.allowed ?? false,
			blocked: !latestDecision?.allowed,
			requiresOverride: false,
			rollbackRequired: false,
			blockingReasons: [],
			qualityGateSummary: null,
			approvalSummary: null,
			latestDecision: latestDecision ?? null,
			rollbackTriggers,
		};
	}

	async applyManualOverride(_input: ManualOverrideInput): Promise<void> {
		const input = _input;
		if (!input.releaseCandidateId) throw new InvalidOverrideInputError("releaseCandidateId is required");
		if (!input.gateEvaluationId) throw new InvalidOverrideInputError("gateEvaluationId is required");
		if (!input.reason || input.reason.trim().length === 0) throw new InvalidOverrideInputError("reason is required");
		if (!input.expiresAt) throw new InvalidOverrideInputError("expiresAt is required");

		const expiresMs = new Date(input.expiresAt).getTime();
		if (!Number.isFinite(expiresMs)) throw new InvalidOverrideInputError("expiresAt must be a valid ISO timestamp");
		const nowMs = Date.now();
		if (expiresMs <= nowMs) throw new InvalidOverrideInputError("expiresAt must be in the future");
		if (expiresMs - nowMs > ReleaseDecisionService.MAX_OVERRIDE_DURATION_MS) {
			throw new InvalidOverrideInputError("override duration exceeds max allowed window");
		}

		const candidate = await getReleaseCandidateById(input.releaseCandidateId);
		if (!candidate) throw new Error(`release candidate not found: ${input.releaseCandidateId}`);

		const goalId = candidate.goalIds[0];
		if (!goalId) throw new Error("release candidate has no goalIds");

		const scope = await this.assertGoalExists(goalId);
		const environment = candidate.targetEnvironment as QualityGateEnvironment;
		if (environment === "production" && !candidate.tenantId) {
			throw new TenantRequiredForProductionReleaseError(goalId);
		}

		const evaluation = await getQualityGateEvaluationById(input.gateEvaluationId);
		if (!evaluation) throw new Error(`quality gate evaluation not found: ${input.gateEvaluationId}`);
		if (evaluation.releaseCandidateId && evaluation.releaseCandidateId !== candidate.id) {
			throw new InvalidOverrideInputError("gateEvaluationId does not belong to releaseCandidateId");
		}

		const gateType = evaluation.gateType;
		this.assertGateOverridableOrThrow(gateType, evaluation);

		const policy = await findQualityGatePolicy({
			goalId,
			gateType,
			environment,
			tenantId: candidate.tenantId,
			projectId: candidate.projectId,
		});
		if (!policy) throw new Error(`quality gate policy not found for ${gateType} in ${environment}`);
		if (!policy.overrideAllowed) throw new NonOverridableGateError(gateType);
		if (!policy.overrideRoles?.length) throw new InvalidOverrideInputError("overrideRoles not configured for gate policy");
		if (!input.actorRoles.some((role) => policy.overrideRoles.includes(role))) {
			throw new InvalidOverrideInputError("actor lacks required override role");
		}

		await insertOverrideActionActive({
			tenantId: candidate.tenantId,
			releaseCandidateId: candidate.id,
			gateEvaluationId: evaluation.id,
			overrideClass: "gate_override",
			requestedBy: input.actorId,
			approvedBy: input.actorId,
			reason: input.reason,
			expiresAt: input.expiresAt,
			policyVersion: candidate.policyVersion,
			correlationId: randomUUID(),
			metadata: {
				...input.metadata,
				gateType,
				environment,
			},
		});

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "release.override_applied",
			payload: {
				goalId,
				releaseCandidateId: candidate.id,
				gateEvaluationId: evaluation.id,
				gateType,
				actorId: input.actorId,
				reason: input.reason,
				expiresAt: input.expiresAt,
			},
		});
	}

	async triggerRollback(_input: RollbackTriggerInput): Promise<void> {
		const input = _input;
		if (!input.releaseCandidateId) throw new Error("releaseCandidateId is required");
		if (!input.triggerType) throw new Error("triggerType is required");
		if (!input.severity) throw new Error("severity is required");
		if (!input.reason || input.reason.trim().length === 0) throw new Error("reason is required");
		if (!input.source || input.source.trim().length === 0) throw new Error("source is required");

		const candidate = await getReleaseCandidateById(input.releaseCandidateId);
		if (!candidate) throw new Error(`release candidate not found: ${input.releaseCandidateId}`);
		const goalId = candidate.goalIds[0];
		if (!goalId) throw new Error("release candidate has no goalIds");

		const scope = await this.assertGoalExists(goalId);
		const environment = candidate.targetEnvironment as QualityGateEnvironment;
		if (environment === "production" && !candidate.tenantId) {
			throw new TenantRequiredForProductionReleaseError(goalId);
		}

		const state =
			input.severity === "critical"
				? "rollback-required"
				: input.severity === "high"
					? "rollback-recommended"
					: "detected";

		await insertRollbackTrigger({
			tenantId: candidate.tenantId,
			releaseCandidateId: candidate.id,
			triggerType: input.triggerType,
			severity: input.severity,
			state,
			automatic: input.automatic ?? input.severity === "critical",
			source: input.source,
			reason: input.reason,
			qualitySignalIds: input.qualitySignalIds ?? [],
			artifactIds: input.artifactIds ?? [],
			incidentId: input.incidentId ?? null,
			policyVersion: candidate.policyVersion,
			correlationId: randomUUID(),
			metadata: input.metadata ?? {},
		});

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "release.rollback_triggered",
			payload: {
				goalId,
				releaseCandidateId: candidate.id,
				triggerType: input.triggerType,
				severity: input.severity,
				state,
				source: input.source,
				reason: input.reason,
			},
		});

		if (input.severity === "critical") {
			await eventBus.emitAsync({
				projectId: scope.projectId,
				type: "release.rollback_required",
				payload: {
					goalId,
					releaseCandidateId: candidate.id,
					triggerType: input.triggerType,
					severity: input.severity,
					reason: input.reason,
				},
			});
		}
	}

	async resolveReleaseState(goalId: string): Promise<ResolvedReleaseState> {
		return this.getReleaseDecision(goalId);
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private resolveRollbackState(triggers: ReleaseRollbackTrigger[]): {
		rollbackRequired: boolean;
		rollbackBlockingReasons: BlockingReason[];
	} {
		let rollbackRequired = false;
		const reasons: BlockingReason[] = [];
		for (const trigger of triggers) {
			if (trigger.state === "rollback-required" || trigger.severity === "critical") {
				rollbackRequired = true;
				reasons.push({
					code: "rollback_required",
					source: "rollback",
					detail: trigger.reason,
				});
			} else if (trigger.state === "rollback-recommended" || trigger.severity === "high") {
				reasons.push({
					code: "rollback_recommended",
					source: "rollback",
					detail: trigger.reason,
				});
			}
		}
		return { rollbackRequired, rollbackBlockingReasons: reasons };
	}

	private collectGateEvaluationIds(summary: ReleaseReadinessSummary | null): string[] {
		if (!summary) return [];
		const ids = new Set<string>();
		for (const evaluation of summary.evaluations) {
			if (evaluation.id) ids.add(evaluation.id);
		}
		return [...ids];
	}

	private isGateSummaryBlocking(summary: ReleaseReadinessSummary | null): boolean {
		if (!summary) return true;
		const isIgnored = (gateType?: string) => gateType === "human_approval";
		const blocking = summary.blockingGates.filter((g) => !isIgnored(g.gateType));
		const missing = summary.missingEvaluations.filter((g) => !isIgnored(g.gate?.gateType));
		return blocking.length > 0 || missing.length > 0;
	}

	private assertGateOverridableOrThrow(gateType: string, evaluation: QualityGateEvaluation): void {
		const hardFailGateTypes = new Set([
			"tenant_compliance",
			"audit_trail_completeness",
			"review_acceptance",
			"human_approval",
			"rollback_safety_check",
		]);
		if (hardFailGateTypes.has(gateType)) throw new NonOverridableGateError(gateType);

		if (gateType === "security_scan") {
			const severity = String((evaluation.details as any)?.severity ?? (evaluation.details as any)?.findingSeverity ?? "");
			const normalized = severity.toLowerCase();
			const isHardOrUnknown = normalized === "high" || normalized === "critical" || normalized === "";
			if (evaluation.outcome === "failed" || evaluation.outcome === "blocked") {
				if (isHardOrUnknown) throw new NonOverridableGateError(gateType);
			}
		}

		if (gateType === "provider_policy_compliance") {
			const policyState = String((evaluation.details as any)?.policyState ?? (evaluation.details as any)?.result ?? "");
			if (policyState.toLowerCase() === "deny") throw new NonOverridableGateError(gateType);
		}
	}

	private async assertGoalExists(goalId: string): Promise<GoalScope> {
		const scope = await getGoalScope(goalId);
		if (!scope) throw new Error(`execution goal not found: ${goalId}`);
		return scope;
	}
}

export const releaseDecisionService = new ReleaseDecisionService();

