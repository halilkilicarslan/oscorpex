import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { signJwt } from "../auth/jwt.js";
import { accessGuard } from "../auth/access-guard.js";
import { qualityGateRoutes } from "../routes/quality-gates.js";
import { approvalRoutes } from "../routes/approvals.js";
import { releaseRoutes } from "../routes/releases.js";
import { artifactRoutes } from "../routes/artifacts.js";
import { qualityGateService } from "../quality-gate-service.js";
import { artifactReferenceService } from "../artifact-reference-service.js";
import { execute, query, queryOne } from "../pg.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM quality_gate_evaluations LIMIT 0");
	dbReady = true;
} catch {
	/* db yoksa testleri skip et */
}

const prefix = `qg-int-${randomUUID()}`;
let counter = 0;

function buildApp() {
	const app = new Hono();
	app.use("*", accessGuard);
	app.route("/", qualityGateRoutes);
	app.route("/", approvalRoutes);
	app.route("/", releaseRoutes);
	app.route("/", artifactRoutes);
	return app;
}

function authHeaders(role: string, tenantId: string) {
	const token = signJwt({
		sub: `user-${role}-${tenantId || "none"}`,
		email: `${role}@example.com`,
		tenantId,
		role,
	});
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"x-correlation-id": randomUUID(),
		"x-request-source": "integration-test",
	};
}

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
		"INSERT INTO projects (id, name, description, status, tech_stack, repo_path, tenant_id, created_at, updated_at) VALUES ($1, $2, '', 'planning', '[]', '', $3, now(), now())",
		[projectId, `Project ${suffix}`, tenantId],
	);
	const goalId = `goal-${suffix}`;
	await execute("INSERT INTO execution_goals (id, project_id, definition, status) VALUES ($1, $2, $3, 'running')", [
		goalId,
		projectId,
		JSON.stringify({ title: `Goal ${suffix}` }),
	]);
	return { goalId, projectId, tenantId };
}

async function createCandidate(app: Hono, goalId: string, tenantId: string) {
	const res = await app.request("/release-candidates/create", {
		method: "POST",
		headers: authHeaders("admin", tenantId),
		body: JSON.stringify({ goalId, targetEnvironment: "production" }),
	});
	expect(res.status).toBe(200);
	const body = (await res.json()) as { data: { id: string } };
	return body.data.id;
}

async function passRequiredGates(app: Hono, goalId: string, tenantId: string) {
	const required = await qualityGateService.getRequiredGates(goalId, "production");
	for (const gate of required) {
		if (gate.gateType === "human_approval") continue;
		const res = await app.request("/quality-gates/evaluate", {
			method: "POST",
			headers: authHeaders("admin", tenantId),
			body: JSON.stringify({
				goalId,
				gateType: gate.gateType,
				result: "passed",
				environment: "production",
				reason: "integration pass",
			}),
		});
		expect(res.status).toBe(200);
	}
}

async function satisfyApproval(app: Hono, goalId: string, tenantId: string) {
	const requestRes = await app.request("/approvals/request", {
		method: "POST",
		headers: authHeaders("admin", tenantId),
		body: JSON.stringify({
			goalId,
			approvalType: "human_approval",
			requiredRole: "admin",
			requiredQuorum: 1,
			environment: "production",
			reason: "integration approval request",
		}),
	});
	expect(requestRes.status).toBe(200);
	const requestBody = (await requestRes.json()) as { data: { id: string } };

	const approveRes = await app.request(`/approvals/${requestBody.data.id}/approve`, {
		method: "POST",
		headers: authHeaders("admin", tenantId),
		body: JSON.stringify({ reason: "approved in integration test" }),
	});
	expect(approveRes.status).toBe(200);
}

async function satisfyArtifacts(app: Hono, goalId: string, tenantId: string) {
	const required = await artifactReferenceService.getRequiredArtifacts(goalId);
	for (const artifactType of required) {
		const regRes = await app.request("/artifacts/register", {
			method: "POST",
			headers: authHeaders("admin", tenantId),
			body: JSON.stringify({
				goalId,
				artifactType,
				title: `${artifactType} title`,
				environment: "production",
				uri: `artifact://${artifactType}/${randomUUID()}`,
				checksum: randomUUID(),
			}),
		});
		expect(regRes.status).toBe(200);
		const regBody = (await regRes.json()) as { data: { id: string } };

		const verifyRes = await app.request(`/artifacts/${regBody.data.id}/verify`, {
			method: "POST",
			headers: authHeaders("admin", tenantId),
			body: JSON.stringify({ reason: "verified in integration test" }),
		});
		expect(verifyRes.status).toBe(200);
	}
}

describe.skipIf(!dbReady)("H2-I Quality Gates Integration", () => {
	beforeEach(async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
	});

	it("1) Happy path: production release allowed", async () => {
		const app = buildApp();
		const goal = await createGoal();
		const tenantId = goal.tenantId as string;

		await createCandidate(app, goal.goalId, tenantId);
		await passRequiredGates(app, goal.goalId, tenantId);
		await satisfyApproval(app, goal.goalId, tenantId);
		await satisfyArtifacts(app, goal.goalId, tenantId);

		const releaseEval = await app.request(`/release/${goal.goalId}/evaluate`, {
			method: "POST",
			headers: authHeaders("admin", tenantId),
		});
		expect(releaseEval.status).toBe(200);
		const body = (await releaseEval.json()) as { data: { allowed: boolean; blocked: boolean; rollbackRequired: boolean } };
		expect(body.data.allowed).toBe(true);
		expect(body.data.blocked).toBe(false);
		expect(body.data.rollbackRequired).toBe(false);
	});

	it("2) Missing approval blocks release", async () => {
		const app = buildApp();
		const goal = await createGoal();
		const tenantId = goal.tenantId as string;

		await createCandidate(app, goal.goalId, tenantId);
		await passRequiredGates(app, goal.goalId, tenantId);
		await satisfyArtifacts(app, goal.goalId, tenantId);

		const releaseEval = await app.request(`/release/${goal.goalId}/evaluate`, {
			method: "POST",
			headers: authHeaders("admin", tenantId),
		});
		expect(releaseEval.status).toBe(200);
		const body = (await releaseEval.json()) as { data: { blocked: boolean; blockingReasons: Array<{ code: string }> } };
		expect(body.data.blocked).toBe(true);
		expect(body.data.blockingReasons.some((x) => x.code === "approval_missing")).toBe(true);
	});

	it("3) Approval rejected blocks release", async () => {
		const app = buildApp();
		const goal = await createGoal();
		const tenantId = goal.tenantId as string;
		await createCandidate(app, goal.goalId, tenantId);
		await passRequiredGates(app, goal.goalId, tenantId);
		await satisfyArtifacts(app, goal.goalId, tenantId);

		const requestRes = await app.request("/approvals/request", {
			method: "POST",
			headers: authHeaders("admin", tenantId),
			body: JSON.stringify({
				goalId: goal.goalId,
				approvalType: "human_approval",
				requiredRole: "admin",
				requiredQuorum: 1,
				environment: "production",
				reason: "integration reject path",
			}),
		});
		const requestBody = (await requestRes.json()) as { data: { id: string } };
		const rejectRes = await app.request(`/approvals/${requestBody.data.id}/reject`, {
			method: "POST",
			headers: authHeaders("admin", tenantId),
			body: JSON.stringify({ reason: "explicit reject in integration test" }),
		});
		expect(rejectRes.status).toBe(200);

		const releaseEval = await app.request(`/release/${goal.goalId}/evaluate`, {
			method: "POST",
			headers: authHeaders("admin", tenantId),
		});
		const releaseBody = (await releaseEval.json()) as { data: { blocked: boolean; blockingReasons: Array<{ code: string }> } };
		expect(releaseBody.data.blocked).toBe(true);
		expect(releaseBody.data.blockingReasons.some((x) => x.code === "approval_rejected")).toBe(true);
	});

	it("4/5) Missing or rejected artifact creates blocked completeness and blocks release", async () => {
		const app = buildApp();
		const goal = await createGoal();
		const tenantId = goal.tenantId as string;
		await createCandidate(app, goal.goalId, tenantId);
		await passRequiredGates(app, goal.goalId, tenantId);
		await satisfyApproval(app, goal.goalId, tenantId);

		const completeness = await app.request(`/artifacts/${goal.goalId}/completeness`, {
			method: "GET",
			headers: authHeaders("admin", tenantId),
		});
		expect(completeness.status).toBe(200);
		const completenessBody = (await completeness.json()) as { data: { satisfied: boolean } };
		expect(completenessBody.data.satisfied).toBe(false);

		const regRes = await app.request("/artifacts/register", {
			method: "POST",
			headers: authHeaders("admin", tenantId),
			body: JSON.stringify({
				goalId: goal.goalId,
				artifactType: "security_scan_result",
				title: "security report",
				environment: "production",
			}),
		});
		const regBody = (await regRes.json()) as { data: { id: string } };
		const rejectRes = await app.request(`/artifacts/${regBody.data.id}/reject`, {
			method: "POST",
			headers: authHeaders("admin", tenantId),
			body: JSON.stringify({ reason: "invalid scan output" }),
		});
		expect(rejectRes.status).toBe(200);

		await qualityGateService.recordGateEvaluation({
			goalId: goal.goalId,
			tenantId,
			gateType: "audit_trail_completeness",
			result: "failed",
			environment: "production",
			actor: "integration-test",
			reason: "artifact completeness failed",
		});

		const releaseEval = await app.request(`/release/${goal.goalId}/evaluate`, {
			method: "POST",
			headers: authHeaders("admin", tenantId),
		});
		const releaseBody = (await releaseEval.json()) as { data: { blocked: boolean } };
		expect(releaseBody.data.blocked).toBe(true);

		const blockedEvent = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'artifact.blocked' ORDER BY timestamp DESC LIMIT 1",
			[goal.projectId],
		);
		expect(blockedEvent?.id).toBeTruthy();
	});

	it("8) Production missing tenant_id must deny (fail-closed)", async () => {
		const app = buildApp();
		const goal = await createGoal({ tenant: false });
		const res = await app.request(`/release/${goal.goalId}/evaluate`, {
			method: "POST",
			headers: authHeaders("admin", ""),
		});
		expect(res.status).toBe(403);
	});
});
