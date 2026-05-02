import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ApprovalService } from "../approval-service.js";
import { execute, query, queryOne } from "../pg.js";
import { QualityGateService } from "../quality-gate-service.js";
import {
	NonOverridableGateError,
	ReleaseDecisionService,
	TenantRequiredForProductionReleaseError,
} from "../release-decision-service.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM release_decisions LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available or schema missing */
}

const service = new ReleaseDecisionService();
const approvalService = new ApprovalService();
const gateService = new QualityGateService();

const prefix = `release-decision-svc-${randomUUID()}`;
let counter = 0;

async function createGoal(options: { tenant?: boolean } = {}) {
	counter += 1;
	const suffix = `${prefix}-${counter}`;
	const tenantId = options.tenant === false ? null : `tenant-${suffix}`;
	if (tenantId) {
		await execute("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [
			tenantId,
			`Tenant ${suffix}`,
			`tenant-${suffix}`,
		]);
	}
	const projectId = `project-${suffix}`;
	await execute(
		`
		INSERT INTO projects (id, name, description, status, tech_stack, repo_path, tenant_id, created_at, updated_at)
		VALUES ($1, $2, '', 'planning', '[]', '', $3, now(), now())
		`,
		[projectId, `Project ${suffix}`, tenantId],
	);
	const goalId = `goal-${suffix}`;
	await execute("INSERT INTO execution_goals (id, project_id, definition, status) VALUES ($1, $2, $3, 'running')", [
		goalId,
		projectId,
		JSON.stringify({ title: `Goal ${suffix}` }),
	]);
	return { tenantId, projectId, goalId, suffix };
}

async function createReleaseCandidate(input: {
	tenantId: string;
	projectId: string;
	goalId: string;
	suffix: string;
}) {
	return await service.createReleaseCandidate({
		goalId: input.goalId,
		tenantId: input.tenantId,
		targetEnvironment: "production",
		requestedBy: "release-decision-service-test",
		correlationId: randomUUID(),
	});
}

async function seedPassingGateEvaluations(goal: { goalId: string; tenantId: string | null }) {
	const required = await gateService.getRequiredGates(goal.goalId, "production");
	for (const gate of required) {
		if (gate.gateType === "human_approval") continue;
		await gateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: gate.gateType,
			result: "passed",
			reason: "seed pass",
			environment: "production",
			actor: "release-decision-service-test",
		});
	}
}

async function seedApprovedApproval(goal: { goalId: string; tenantId: string | null }) {
	const request = await approvalService.createApprovalRequest({
		goalId: goal.goalId,
		tenantId: goal.tenantId,
		approvalType: "human_approval",
		requiredRole: "release-manager",
		requiredQuorum: 1,
		environment: "production",
		requestedBy: "release-decision-service-test",
	});
	await approvalService.approveRequest({
		approvalRequestId: request.id,
		tenantId: goal.tenantId,
		actorId: "release-decision-service-test-approver",
		actorRoles: ["release-manager"],
		reason: "ok",
	});
}

describe.skipIf(!dbReady)("ReleaseDecisionService", () => {
	beforeEach(async () => {
		await execute("DELETE FROM override_actions WHERE requested_by LIKE 'release-decision-service-test%'");
		await execute("DELETE FROM rollback_triggers WHERE source LIKE 'release-decision-service-test%'");
		await execute("DELETE FROM release_decisions WHERE evaluated_by = 'release-decision-service-test'");
		await execute("DELETE FROM release_candidates WHERE requested_by = 'release-decision-service-test'");
		await execute("DELETE FROM approval_decisions WHERE actor_id LIKE 'release-decision-service-test%'");
		await execute("DELETE FROM approval_requests WHERE requested_by = 'release-decision-service-test'");
		await execute("DELETE FROM quality_gate_evaluations WHERE evaluated_by = 'release-decision-service-test'");
	});

	it("blocking gate blocks release", async () => {
		const goal = await createGoal();
		const rc = await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);
		await seedApprovedApproval(goal);

		await gateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "lint",
			result: "failed",
			reason: "lint failed",
			environment: "production",
			actor: "release-decision-service-test",
			releaseCandidateId: rc.id,
		});

		const state = await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});
		expect(state.allowed).toBe(false);
		expect(state.blocked).toBe(true);
		expect(state.blockingReasons.some((r) => r.gateType === "lint")).toBe(true);
	});

	it("missing approval blocks release", async () => {
		const goal = await createGoal();
		await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);

		const state = await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});
		expect(state.allowed).toBe(false);
		expect(state.blocked).toBe(true);
		expect(state.blockingReasons.some((r) => r.code === "approval_missing")).toBe(true);
	});

	it("quorum satisfied allows release (when gates pass)", async () => {
		const goal = await createGoal();
		await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);
		await seedApprovedApproval(goal);

		const state = await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});
		expect(state.allowed).toBe(true);
		expect(state.blocked).toBe(false);
	});

	it("append-only decision persistence", async () => {
		const goal = await createGoal();
		const rc = await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);
		await seedApprovedApproval(goal);

		await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});
		await gateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "typecheck",
			result: "failed",
			reason: "typecheck failed",
			environment: "production",
			actor: "release-decision-service-test",
			releaseCandidateId: rc.id,
		});
		await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});

		const rows = await query<{ id: string }>(
			"SELECT id FROM release_decisions WHERE release_candidate_id = $1 ORDER BY created_at ASC",
			[rc.id],
		);
		expect(rows.length).toBe(2);
	});

	it("manual override removes allowed blocker", async () => {
		const goal = await createGoal();
		const rc = await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);
		await seedApprovedApproval(goal);

		const evalRow = await gateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "test_coverage",
			result: "failed",
			reason: "coverage low",
			environment: "production",
			actor: "release-decision-service-test",
			releaseCandidateId: rc.id,
		});

		const blocked = await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});
		expect(blocked.allowed).toBe(false);

		await service.applyManualOverride({
			releaseCandidateId: rc.id,
			gateEvaluationId: evalRow.id,
			actorId: "release-decision-service-test-operator",
			actorRoles: ["engineering-lead"],
			reason: "temporary exception",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		});

		const allowed = await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});
		expect(allowed.allowed).toBe(true);
	});

	it("hard security failure cannot override", async () => {
		const goal = await createGoal();
		const rc = await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);
		await seedApprovedApproval(goal);

		const evalRow = await gateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "security_scan",
			result: "failed",
			reason: "critical finding",
			details: { severity: "critical" },
			environment: "production",
			actor: "release-decision-service-test",
			releaseCandidateId: rc.id,
		});

		await expect(
			service.applyManualOverride({
				releaseCandidateId: rc.id,
				gateEvaluationId: evalRow.id,
				actorId: "release-decision-service-test-operator",
				actorRoles: ["security-admin"],
				reason: "try override",
				expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
			}),
		).rejects.toBeInstanceOf(NonOverridableGateError);
	});

	it("rollback trigger persists correctly", async () => {
		const goal = await createGoal();
		const rc = await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);
		await seedApprovedApproval(goal);

		await service.triggerRollback({
			releaseCandidateId: rc.id,
			triggerType: "deployment_health",
			severity: "critical",
			source: "release-decision-service-test-system",
			reason: "health degraded",
		});

		const row = await queryOne<{ state: string; severity: string }>(
			"SELECT state, severity FROM rollback_triggers WHERE release_candidate_id = $1 ORDER BY created_at DESC LIMIT 1",
			[rc.id],
		);
		expect(row?.state).toBe("rollback-required");
		expect(row?.severity).toBe("critical");
	});

	it("production tenant missing => deny", async () => {
		const goal = await createGoal({ tenant: false });
		const releaseCandidateId = `rc-${goal.suffix}`;
		await execute(
			`
			INSERT INTO release_candidates (
			  id, tenant_id, project_id, goal_ids, target_environment, state,
			  requested_by, policy_version, correlation_id
			)
			VALUES ($1, NULL, $2, $3, 'production', 'candidate', 'release-decision-service-test', '1', $4)
			`,
			[releaseCandidateId, goal.projectId, JSON.stringify([goal.goalId]), randomUUID()],
		);
		await expect(service.evaluateReleaseDecision(goal.goalId)).rejects.toBeInstanceOf(
			TenantRequiredForProductionReleaseError,
		);
	});

	it("audit events emitted", async () => {
		const goal = await createGoal();
		const rc = await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		await seedPassingGateEvaluations(goal);
		await seedApprovedApproval(goal);

		await service.recordReleaseDecision({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			environment: "production",
			actor: "release-decision-service-test",
		});
		await service.triggerRollback({
			releaseCandidateId: rc.id,
			triggerType: "deployment_health",
			severity: "high",
			source: "release-decision-service-test-system",
			reason: "degraded",
		});

		const decisionEvent = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'release.decision_recorded' ORDER BY timestamp DESC LIMIT 1",
			[goal.projectId],
		);
		const rollbackEvent = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'release.rollback_triggered' ORDER BY timestamp DESC LIMIT 1",
			[goal.projectId],
		);
		expect(decisionEvent?.id).toBeTruthy();
		expect(rollbackEvent?.id).toBeTruthy();
	});
});
