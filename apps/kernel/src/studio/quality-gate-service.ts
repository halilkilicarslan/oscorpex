// ---------------------------------------------------------------------------
// Oscorpex — QualityGateService
// Canonical application service for gate policy loading, append-only
// evaluations, blocking resolution, and release readiness summaries.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { eventBus } from "./event-bus.js";
import {
	findQualityGatePolicy,
	getGoalScope,
	getLatestQualityGateEvaluation,
	hasActiveQualityGateOverride,
	insertQualityGateEvaluation,
	listLatestQualityGateEvaluations,
	listRequiredQualityGates,
	type QualityGateEnvironment,
	type QualityGateEvaluation,
	type QualityGateOutcome,
	type QualityGatePolicy,
} from "./db/quality-gate-repo.js";

export type { QualityGateEnvironment, QualityGateOutcome, QualityGateEvaluation, QualityGatePolicy };

export interface GateEvaluationInput {
	goalId: string;
	tenantId: string | null;
	gateType: string;
	result: QualityGateOutcome;
	reason?: string;
	metadata?: Record<string, unknown>;
	details?: Record<string, unknown>;
	environment: QualityGateEnvironment;
	actor?: string;
	releaseCandidateId?: string | null;
	qualitySignalIds?: string[];
	artifactIds?: string[];
	idempotencyKey?: string | null;
	correlationId?: string;
}

export interface BlockingGate {
	gate: QualityGatePolicy | null;
	evaluation: QualityGateEvaluation | null;
	gateType: string;
	reason: string;
	overridden: boolean;
	overrideAllowed: boolean;
}

export interface GateState {
	gate: QualityGatePolicy | null;
	evaluation: QualityGateEvaluation | null;
	state: "passed" | "failed" | "warning" | "blocked" | "missing" | "overridden";
	blocking: boolean;
	reason: string;
}

export interface ReleaseReadinessSummary {
	ready: boolean;
	environment: QualityGateEnvironment;
	blockingGates: BlockingGate[];
	warnings: GateState[];
	missingEvaluations: GateState[];
	evaluations: QualityGateEvaluation[];
	requiredGates: QualityGatePolicy[];
}

export class TenantRequiredForProductionError extends Error {
	constructor(goalId: string) {
		super(`tenant_id is required for production quality gate decisions for goal ${goalId}`);
		this.name = "TenantRequiredForProductionError";
	}
}

export class QualityGateService {
	async getRequiredGates(goalId: string, environment: QualityGateEnvironment): Promise<QualityGatePolicy[]> {
		await this.assertGoalExists(goalId);
		return listRequiredQualityGates({ goalId, environment });
	}

	async evaluateGate(input: GateEvaluationInput): Promise<QualityGateEvaluation> {
		return this.recordGateEvaluation(input);
	}

	async recordGateEvaluation(input: GateEvaluationInput): Promise<QualityGateEvaluation> {
		const scope = await this.assertGoalExists(input.goalId);
		const tenantId = input.tenantId ?? scope.tenantId;
		if (input.environment === "production" && !tenantId) {
			throw new TenantRequiredForProductionError(input.goalId);
		}

		const gate = await findQualityGatePolicy({
			goalId: input.goalId,
			gateType: input.gateType,
			environment: input.environment,
			tenantId,
			projectId: scope.projectId,
		});
		if (!gate) {
			throw new Error(`quality gate policy not found for ${input.gateType} in ${input.environment}`);
		}

		const evaluation = await insertQualityGateEvaluation({
			tenantId,
			projectId: scope.projectId,
			goalId: input.goalId,
			releaseCandidateId: input.releaseCandidateId ?? null,
			gateId: gate.id,
			gateType: gate.gateType,
			scope: input.environment,
			outcome: input.result,
			blocking: gate.blocking && (input.result === "failed" || input.result === "blocked"),
			required: gate.required,
			reason: input.reason ?? "",
			details: input.details ?? {},
			qualitySignalIds: input.qualitySignalIds ?? [],
			artifactIds: input.artifactIds ?? [],
			evaluatedBy: input.actor ?? "system",
			policyVersion: gate.policyVersion,
			correlationId: input.correlationId ?? randomUUID(),
			idempotencyKey: input.idempotencyKey ?? null,
			metadata: {
				...input.metadata,
				environment: input.environment,
				source: input.metadata?.source ?? "quality-gate-service",
			},
		});

		await eventBus.emitAsync({
			projectId: scope.projectId,
			type: "quality_gate.evaluated",
			payload: {
				goalId: input.goalId,
				gateType: gate.gateType,
				evaluationId: evaluation.id,
				outcome: evaluation.outcome,
				environment: input.environment,
				blocking: evaluation.blocking,
				required: evaluation.required,
				reason: evaluation.reason,
			},
		});

		if (evaluation.blocking) {
			await eventBus.emitAsync({
				projectId: scope.projectId,
				type: "quality_gate.blocked",
				payload: {
					goalId: input.goalId,
					gateType: gate.gateType,
					evaluationId: evaluation.id,
					environment: input.environment,
					reason: evaluation.reason,
					overrideAllowed: gate.overrideAllowed,
				},
			});
		}

		return evaluation;
	}

	async getLatestEvaluations(goalId: string): Promise<QualityGateEvaluation[]> {
		await this.assertGoalExists(goalId);
		return listLatestQualityGateEvaluations(goalId);
	}

	async resolveGateState(
		goalId: string,
		gateType: string,
		environment: QualityGateEnvironment = "production",
	): Promise<GateState> {
		const scope = await this.assertGoalExists(goalId);
		if (environment === "production" && !scope.tenantId) {
			return {
				gate: null,
				evaluation: null,
				state: "blocked",
				blocking: true,
				reason: "production quality decision requires tenant_id",
			};
		}

		const gate = await findQualityGatePolicy({
			goalId,
			gateType,
			environment,
			tenantId: scope.tenantId,
			projectId: scope.projectId,
		});
		const evaluation = await getLatestQualityGateEvaluation({ goalId, gateType, environment });
		if (!gate) {
			return { gate: null, evaluation: evaluation ?? null, state: "missing", blocking: true, reason: "required gate policy missing" };
		}
		return this.resolveStateForGate(gate, evaluation);
	}

	async getBlockingGates(
		goalId: string,
		environment: QualityGateEnvironment = "production",
	): Promise<BlockingGate[]> {
		const summary = await this.calculateReleaseReadiness(goalId, environment, false);
		return summary.blockingGates;
	}

	async isReleaseReady(
		goalId: string,
		environment: QualityGateEnvironment = "production",
	): Promise<ReleaseReadinessSummary> {
		return this.calculateReleaseReadiness(goalId, environment, true);
	}

	protected providerPolicyHook(_input: {
		goalId: string;
		environment: QualityGateEnvironment;
		gate: QualityGatePolicy;
	}): Promise<void> | void {
		// H2-C keeps evaluator integration out of scope. H2-D/H2-E can bind
		// provider_policy_compliance here without changing readiness semantics.
	}

	private async calculateReleaseReadiness(
		goalId: string,
		environment: QualityGateEnvironment,
		emitAudit: boolean,
	): Promise<ReleaseReadinessSummary> {
		const scope = await this.assertGoalExists(goalId);
		const requiredGates = await listRequiredQualityGates({
			goalId,
			environment,
			tenantId: scope.tenantId,
			projectId: scope.projectId,
		});
		const evaluations = await listLatestQualityGateEvaluations(goalId, environment);
		const evaluationByGate = new Map(evaluations.map((evaluation) => [evaluation.gateType, evaluation]));
		const blockingGates: BlockingGate[] = [];
		const warnings: GateState[] = [];
		const missingEvaluations: GateState[] = [];

		if (environment === "production" && !scope.tenantId) {
			blockingGates.push({
				gate: null,
				evaluation: null,
				gateType: "tenant_compliance",
				reason: "production quality decision requires tenant_id",
				overridden: false,
				overrideAllowed: false,
			});
		}

		for (const gate of requiredGates) {
			if (gate.gateType === "provider_policy_compliance") {
				await this.providerPolicyHook({ goalId, environment, gate });
			}
			const evaluation = evaluationByGate.get(gate.gateType) ?? null;
			const state = await this.resolveStateForGate(gate, evaluation);
			if (state.state === "missing") {
				missingEvaluations.push(state);
				if (gate.blocking) {
					blockingGates.push({
						gate,
						evaluation: null,
						gateType: gate.gateType,
						reason: "required gate has no evaluation",
						overridden: false,
						overrideAllowed: gate.overrideAllowed,
					});
				}
				continue;
			}
			if (state.state === "warning") warnings.push(state);
			if (state.blocking) {
				const overridden =
					Boolean(evaluation) &&
					gate.overrideAllowed &&
					(await hasActiveQualityGateOverride({ tenantId: scope.tenantId, evaluationId: evaluation!.id }));
				if (!overridden) {
					blockingGates.push({
						gate,
						evaluation,
						gateType: gate.gateType,
						reason: state.reason,
						overridden,
						overrideAllowed: gate.overrideAllowed,
					});
				}
			}
		}

		const summary: ReleaseReadinessSummary = {
			ready: blockingGates.length === 0 && missingEvaluations.length === 0,
			environment,
			blockingGates,
			warnings,
			missingEvaluations,
			evaluations,
			requiredGates,
		};

		if (emitAudit) {
			await eventBus.emitAsync({
				projectId: scope.projectId,
				type: "quality_gate.release_ready",
				payload: {
					goalId,
					environment,
					ready: summary.ready,
					blockingCount: blockingGates.length,
					warningCount: warnings.length,
					missingEvaluationCount: missingEvaluations.length,
				},
			});
		}

		return summary;
	}

	private async resolveStateForGate(
		gate: QualityGatePolicy,
		evaluation: QualityGateEvaluation | null | undefined,
	): Promise<GateState> {
		if (!evaluation) {
			return {
				gate,
				evaluation: null,
				state: "missing",
				blocking: gate.required && gate.blocking,
				reason: "required gate has no evaluation",
			};
		}
		if (evaluation.outcome === "warning") {
			return { gate, evaluation, state: "warning", blocking: false, reason: evaluation.reason };
		}
		if (evaluation.outcome === "passed") {
			return { gate, evaluation, state: "passed", blocking: false, reason: evaluation.reason };
		}
		const blocksRelease = gate.required && gate.blocking && (evaluation.outcome === "failed" || evaluation.outcome === "blocked");
		if (
			blocksRelease &&
			gate.overrideAllowed &&
			(await hasActiveQualityGateOverride({ tenantId: evaluation.tenantId, evaluationId: evaluation.id }))
		) {
			return { gate, evaluation, state: "overridden", blocking: false, reason: evaluation.reason };
		}
		return {
			gate,
			evaluation,
			state: evaluation.outcome,
			blocking: blocksRelease,
			reason: evaluation.reason,
		};
	}

	private async assertGoalExists(goalId: string) {
		const scope = await getGoalScope(goalId);
		if (!scope) throw new Error(`execution goal not found: ${goalId}`);
		return scope;
	}
}

export const qualityGateService = new QualityGateService();
