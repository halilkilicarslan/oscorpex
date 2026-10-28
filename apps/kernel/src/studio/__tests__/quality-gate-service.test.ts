import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGoalScope } from "../db.js";
import { execute, query, queryOne } from "../pg.js";
import { QualityGateService, TenantRequiredForProductionError } from "../quality-gate-service.js";
import { TENANT_LOCAL } from "./helpers/tenancy.js";

// F2d: projects can no longer have a NULL tenant. The "production tenant missing" fail-closed paths are
// exercised by making the goal-scope lookup report a missing tenant for the given goal.
vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../db.js")>();
	return { ...actual, getGoalScope: vi.fn(actual.getGoalScope) };
});

afterEach(() => {
	vi.mocked(getGoalScope).mockReset();
});

async function reportTenantMissing(goalId: string) {
	const actual = await vi.importActual<typeof import("../db.js")>("../db.js");
	vi.mocked(getGoalScope).mockImplementation(async (id: string) => {
		const scope = await actual.getGoalScope(id);
		return scope && id === goalId ? { ...scope, tenantId: null } : scope;
	});
}

let dbReady = false;
try {
	await query("SELECT 1 FROM quality_gates LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available or schema missing */
}

const service = new QualityGateService();
const prefix = `qgsvc-${randomUUID()}`;
let counter = 0;

async function createGoal(options: { tenant?: boolean } = {}) {
	counter += 1;
	const suffix = `${prefix}-${counter}`;
	const tenantId = options.tenant === false ? null : TENANT_LOCAL;
	const projectId = `project-${suffix}`;
	await execute(
		`
		INSERT INTO projects (id, name, description, status, tech_stack, repo_path, tenant_id, created_at, updated_at)
		VALUES ($1, $2, '', 'planning', '[]', '', $3, now(), now())
		`,
		[projectId, `Project ${suffix}`, tenantId ?? TENANT_LOCAL],
	);
	const goalId = `goal-${suffix}`;
	await execute("INSERT INTO execution_goals (id, project_id, definition, status) VALUES ($1, $2, $3, 'running')", [
		goalId,
		projectId,
		JSON.stringify({ title: `Goal ${suffix}` }),
	]);
	return { tenantId, projectId, goalId, suffix };
}

async function createReleaseCandidate(input: { tenantId: string; projectId: string; goalId: string; suffix: string }) {
	const releaseCandidateId = `rc-${input.suffix}`;
	await execute(
		`
		INSERT INTO release_candidates (
		  id, tenant_id, project_id, goal_ids, target_environment, state,
		  requested_by, policy_version, correlation_id
		)
		VALUES ($1, $2, $3, $4, 'production', 'candidate', 'test', '1', $5)
		`,
		[releaseCandidateId, input.tenantId, input.projectId, JSON.stringify([input.goalId]), randomUUID()],
	);
	return releaseCandidateId;
}

describe.skipIf(!dbReady)("QualityGateService", () => {
	beforeEach(async () => {
		await execute("DELETE FROM override_actions WHERE requested_by = 'quality-gate-service-test'");
		await execute("DELETE FROM quality_gate_evaluations WHERE evaluated_by = 'quality-gate-service-test'");
	});

	it("records append-only evaluation", async () => {
		const goal = await createGoal();
		await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "typecheck",
			result: "failed",
			reason: "first run failed",
			environment: "production",
			actor: "quality-gate-service-test",
		});
		await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "typecheck",
			result: "passed",
			reason: "second run passed",
			environment: "production",
			actor: "quality-gate-service-test",
		});

		const rows = await query<{ outcome: string }>(
			"SELECT outcome FROM quality_gate_evaluations WHERE goal_id = $1 AND gate_type = 'typecheck' ORDER BY created_at ASC",
			[goal.goalId],
		);
		expect(rows.map((row) => row.outcome)).toEqual(["failed", "passed"]);
	});

	it("resolves latest evaluation deterministically", async () => {
		const goal = await createGoal();
		await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "lint",
			result: "failed",
			reason: "old result",
			environment: "production",
			actor: "quality-gate-service-test",
		});
		const latest = await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "lint",
			result: "passed",
			reason: "new result",
			environment: "production",
			actor: "quality-gate-service-test",
		});

		const state = await service.resolveGateState(goal.goalId, "lint", "production");
		expect(state.evaluation?.id).toBe(latest.id);
		expect(state.state).toBe("passed");
	});

	it("detects blocking gate correctly", async () => {
		const goal = await createGoal();
		await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "security_scan",
			result: "failed",
			reason: "critical finding",
			environment: "production",
			actor: "quality-gate-service-test",
		});

		const blocking = await service.getBlockingGates(goal.goalId, "production");
		expect(blocking.some((gate) => gate.gateType === "security_scan")).toBe(true);
	});

	it("allows active override to remove an overridable blocker", async () => {
		const goal = await createGoal();
		const releaseCandidateId = await createReleaseCandidate({
			tenantId: goal.tenantId!,
			projectId: goal.projectId,
			goalId: goal.goalId,
			suffix: goal.suffix,
		});
		const evaluation = await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "test_coverage",
			result: "failed",
			reason: "coverage below threshold",
			environment: "production",
			actor: "quality-gate-service-test",
			releaseCandidateId,
		});
		await execute(
			`
			INSERT INTO override_actions (
			  id, tenant_id, release_candidate_id, gate_evaluation_id, override_class,
			  state, requested_by, approved_by, reason, expires_at, policy_version, correlation_id
			)
			VALUES ($1, $2, $3, $4, 'gate_override', 'active', 'quality-gate-service-test',
			  'release-manager', 'accepted temporary risk', now() + interval '1 hour', '1', $5)
			`,
			[randomUUID(), goal.tenantId, releaseCandidateId, evaluation.id, randomUUID()],
		);

		const state = await service.resolveGateState(goal.goalId, "test_coverage", "production");
		expect(state.state).toBe("overridden");
		const blocking = await service.getBlockingGates(goal.goalId, "production");
		expect(blocking.some((gate) => gate.gateType === "test_coverage")).toBe(false);
	});

	it("fails closed when production tenant is missing", async () => {
		const goal = await createGoal({ tenant: false });
		await reportTenantMissing(goal.goalId);
		await expect(
			service.recordGateEvaluation({
				goalId: goal.goalId,
				tenantId: null,
				gateType: "typecheck",
				result: "passed",
				environment: "production",
				actor: "quality-gate-service-test",
			}),
		).rejects.toBeInstanceOf(TenantRequiredForProductionError);

		const summary = await service.isReleaseReady(goal.goalId, "production");
		expect(summary.ready).toBe(false);
		expect(summary.blockingGates.some((gate) => gate.gateType === "tenant_compliance")).toBe(true);
	});

	it("returns explanatory release readiness summary", async () => {
		const goal = await createGoal();
		await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "typecheck",
			result: "passed",
			environment: "production",
			actor: "quality-gate-service-test",
		});
		await service.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			gateType: "cost_threshold",
			result: "warning",
			reason: "near cap",
			environment: "production",
			actor: "quality-gate-service-test",
		});

		const summary = await service.isReleaseReady(goal.goalId, "production");
		expect(summary.ready).toBe(false);
		expect(summary.requiredGates.length).toBeGreaterThanOrEqual(14);
		expect(summary.warnings.some((gate) => gate.gate?.gateType === "cost_threshold")).toBe(true);
		expect(summary.missingEvaluations.length).toBeGreaterThan(0);

		const auditEvent = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'quality_gate.release_ready' ORDER BY timestamp DESC LIMIT 1",
			[goal.projectId],
		);
		expect(auditEvent?.id).toBeTruthy();
	});
});
