import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ApprovalService } from "../approval-service.js";
import { artifactReferenceService } from "../artifact-reference-service.js";
import { execute, query, queryOne } from "../pg.js";
import { QualityGateService } from "../quality-gate-service.js";
import { NonOverridableGateError, ReleaseDecisionService } from "../release-decision-service.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM release_decisions LIMIT 0");
	dbReady = true;
} catch {
	/* db yoksa skip */
}

const prefix = `rel-flow-int-${randomUUID()}`;
let counter = 0;

const approvalService = new ApprovalService();
const gateService = new QualityGateService();
const releaseService = new ReleaseDecisionService();

async function createGoal() {
	counter += 1;
	const suffix = `${prefix}-${counter}`;
	const tenantId = `tenant-${suffix}`;
	const projectId = `project-${suffix}`;
	const goalId = `goal-${suffix}`;

	await execute("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [
		tenantId,
		`Tenant ${suffix}`,
		`tenant-${suffix}`,
	]);
	await execute(
		"INSERT INTO projects (id, name, description, status, tech_stack, repo_path, tenant_id, created_at, updated_at) VALUES ($1, $2, '', 'planning', '[]', '', $3, now(), now())",
		[projectId, `Project ${suffix}`, tenantId],
	);
	await execute("INSERT INTO execution_goals (id, project_id, definition, status) VALUES ($1, $2, $3, 'running')", [
		goalId,
		projectId,
		JSON.stringify({ title: `Goal ${suffix}` }),
	]);
	return { tenantId, projectId, goalId };
}

async function baselineReady(goalId: string, tenantId: string) {
	const rc = await releaseService.createReleaseCandidate({
		goalId,
		tenantId,
		targetEnvironment: "production",
		requestedBy: "release-flow-int",
	});
	const required = await gateService.getRequiredGates(goalId, "production");
	for (const gate of required) {
		if (gate.gateType === "human_approval") continue;
		await gateService.recordGateEvaluation({
			goalId,
			tenantId,
			gateType: gate.gateType,
			result: "passed",
			reason: "baseline pass",
			environment: "production",
			actor: "release-flow-int",
			releaseCandidateId: rc.id,
		});
	}
	const req = await approvalService.createApprovalRequest({
		goalId,
		tenantId,
		approvalType: "human_approval",
		requiredRole: "release-manager",
		requiredQuorum: 1,
		environment: "production",
		requestedBy: "release-flow-int",
	});
	await approvalService.approveRequest({
		approvalRequestId: req.id,
		tenantId,
		actorId: "release-flow-int-approver",
		actorRoles: ["release-manager"],
		reason: "approved baseline",
	});
	return rc;
}

describe.skipIf(!dbReady)("H2-I Release Flow Integration", () => {
	beforeEach(async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
	});

	it("6) Hard-fail override must be impossible", async () => {
		const goal = await createGoal();
		const rc = await baselineReady(goal.goalId, goal.tenantId);
		const secEval = await gateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "security_scan",
			result: "failed",
			reason: "critical security finding",
			details: { severity: "critical" },
			environment: "production",
			actor: "release-flow-int",
			releaseCandidateId: rc.id,
		});

		await expect(
			releaseService.applyManualOverride({
				releaseCandidateId: rc.id,
				gateEvaluationId: secEval.id,
				actorId: "release-flow-int-operator",
				actorRoles: ["security-admin"],
				reason: "try hard-fail bypass",
				expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
			}),
		).rejects.toBeInstanceOf(NonOverridableGateError);
	});

	it("7) Soft-fail override allowed and release can proceed", async () => {
		const goal = await createGoal();
		const rc = await baselineReady(goal.goalId, goal.tenantId);
		const coverageEval = await gateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "test_coverage",
			result: "failed",
			reason: "coverage warning",
			environment: "production",
			actor: "release-flow-int",
			releaseCandidateId: rc.id,
		});

		const blocked = await releaseService.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-flow-int",
		});
		expect(blocked.blocked).toBe(true);

		await releaseService.applyManualOverride({
			releaseCandidateId: rc.id,
			gateEvaluationId: coverageEval.id,
			actorId: "release-flow-int-engineering-lead",
			actorRoles: ["engineering-lead"],
			reason: "accepted risk for hotfix",
			expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
		});
		const allowed = await releaseService.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-flow-int",
		});
		expect(allowed.allowed).toBe(true);
	});

	it("9) Rollback trigger persists and rollbackRequired=true", async () => {
		const goal = await createGoal();
		const rc = await baselineReady(goal.goalId, goal.tenantId);
		await releaseService.triggerRollback({
			releaseCandidateId: rc.id,
			triggerType: "post_release_validation",
			severity: "critical",
			source: "release-flow-integration",
			reason: "post-release validation failed",
		});
		await releaseService.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-flow-int",
		});

		const triggerRow = await queryOne<{ state: string }>(
			"SELECT state FROM rollback_triggers WHERE release_candidate_id = $1 ORDER BY created_at DESC LIMIT 1",
			[rc.id],
		);
		expect(triggerRow?.state).toBe("rollback-required");

		const rollbackEvent = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'release.rollback_required' ORDER BY timestamp DESC LIMIT 1",
			[goal.projectId],
		);
		expect(rollbackEvent?.id).toBeTruthy();
	});

	it("12) Audit trail persistence includes actor/tenant/reason signals", async () => {
		const goal = await createGoal();
		const rc = await baselineReady(goal.goalId, goal.tenantId);
		const reg = await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "security_scan_result",
			title: "security scan output",
			environment: "production",
			createdBy: "release-flow-int",
		});
		await artifactReferenceService.rejectArtifact({
			artifactId: reg.id,
			rejectedBy: "release-flow-int-reviewer",
			reason: "scan output malformed",
		});
		await releaseService.triggerRollback({
			releaseCandidateId: rc.id,
			triggerType: "security_violation",
			severity: "critical",
			source: "release-flow-int",
			reason: "security escalation",
		});

		const auditRows = await query<{ type: string; correlation_id: string | null; payload: string }>(
			"SELECT type, correlation_id, payload FROM events WHERE project_id = $1 AND type IN ('quality_gate.evaluated','approval.approved','release.decision_recorded','release.rollback_triggered','artifact.rejected') ORDER BY timestamp DESC",
			[goal.projectId],
		);
		expect(auditRows.length).toBeGreaterThan(0);
		expect(auditRows.every((row) => Boolean(row.correlation_id))).toBe(true);

		const withActor = auditRows.some((row) => {
			const payload = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
			return (
				typeof payload.actorId === "string" ||
				typeof payload.verifiedBy === "string" ||
				typeof payload.evaluatedBy === "string"
			);
		});
		const withReason = auditRows.some((row) => {
			const payload = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
			return (
				typeof payload.reason === "string" ||
				typeof payload.decisionReason === "string" ||
				typeof payload.reasonSummary === "string"
			);
		});
		expect(withActor).toBe(true);
		expect(withReason).toBe(true);
	});
});
