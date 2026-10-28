import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, vi } from "vitest";
import { accessGuard } from "../auth/access-guard.js";
import { signJwt } from "../auth/jwt.js";
import { seedUser } from "./helpers/identity.js";
import { itInTenant } from "./helpers/outside-scope.js";
import { seedTestTenants } from "./helpers/tenancy.js";

const { mockQualityGateService, mockApprovalService, mockReleaseDecisionService, mockArtifactReferenceService } =
	vi.hoisted(() => ({
		mockQualityGateService: {
			isReleaseReady: vi.fn(),
			evaluateGate: vi.fn(),
			getLatestEvaluations: vi.fn(),
			getBlockingGates: vi.fn(),
		},
		mockApprovalService: {
			rejectRequest: vi.fn(),
			createApprovalRequest: vi.fn(),
			approveRequest: vi.fn(),
			getPendingApprovals: vi.fn(),
			getApprovalState: vi.fn(),
			isApprovalSatisfied: vi.fn(),
		},
		mockReleaseDecisionService: {
			createReleaseCandidate: vi.fn(),
			getReleaseCandidate: vi.fn(),
			evaluateReleaseDecision: vi.fn(),
			resolveReleaseState: vi.fn(),
			applyManualOverride: vi.fn(),
			triggerRollback: vi.fn(),
		},
		mockArtifactReferenceService: {
			registerArtifact: vi.fn(),
			verifyArtifact: vi.fn(),
			rejectArtifact: vi.fn(),
			supersedeArtifact: vi.fn(),
			getArtifacts: vi.fn(),
			isArtifactCompletenessSatisfied: vi.fn(),
		},
	}));

vi.mock("../quality-gate-service.js", () => ({
	qualityGateService: mockQualityGateService,
	TenantRequiredForProductionError: class TenantRequiredForProductionError extends Error {},
}));

vi.mock("../approval-service.js", () => ({
	approvalService: mockApprovalService,
	TenantRequiredForProductionApprovalError: class TenantRequiredForProductionApprovalError extends Error {},
	InvalidApprovalTransitionError: class InvalidApprovalTransitionError extends Error {},
}));

vi.mock("../release-decision-service.js", () => ({
	releaseDecisionService: mockReleaseDecisionService,
	InvalidOverrideInputError: class InvalidOverrideInputError extends Error {},
	NonOverridableGateError: class NonOverridableGateError extends Error {},
	ReleaseCandidateNotFoundError: class ReleaseCandidateNotFoundError extends Error {},
	TenantRequiredForProductionReleaseError: class TenantRequiredForProductionReleaseError extends Error {},
}));

vi.mock("../artifact-reference-service.js", () => ({
	artifactReferenceService: mockArtifactReferenceService,
}));

async function buildApp() {
	const { qualityGateRoutes } = await import("../routes/quality-gates.js");
	const { approvalRoutes } = await import("../routes/approvals.js");
	const { releaseRoutes } = await import("../routes/releases.js");
	const { artifactRoutes } = await import("../routes/artifacts.js");
	const app = new Hono();
	app.use("*", accessGuard);
	app.route("/", qualityGateRoutes);
	app.route("/", approvalRoutes);
	app.route("/", releaseRoutes);
	app.route("/", artifactRoutes);
	return app;
}

// Identity is verified against the DB on every JWT request, so the actors are real users in a real tenant.
const TENANT = "00000000-0000-0000-0000-00000000000a"; // TENANT_A
const actorId = (role: string) => `qg-routes-${role}`;

beforeAll(async () => {
	await seedTestTenants();
	for (const role of ["admin", "viewer"]) await seedUser({ tenantId: TENANT, role, id: actorId(role) });
});

function authHeader(role: string, tenantId = TENANT) {
	const token = signJwt({
		sub: actorId(role),
		email: `${actorId(role)}@f2r.test`,
		tenantId,
		role,
	});
	return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const it = itInTenant(TENANT);

describe("H2-G route-level API wiring", () => {
	beforeEach(() => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		vi.clearAllMocks();
		mockQualityGateService.isReleaseReady.mockResolvedValue({ ready: true });
		mockQualityGateService.evaluateGate.mockResolvedValue({ id: "eval-1" });
		mockQualityGateService.getLatestEvaluations.mockResolvedValue([]);
		mockQualityGateService.getBlockingGates.mockResolvedValue([]);
		mockApprovalService.rejectRequest.mockResolvedValue({ state: "rejected", request: { goalId: "goal-1" } });
		mockReleaseDecisionService.evaluateReleaseDecision.mockResolvedValue({ blocked: true });
		mockReleaseDecisionService.triggerRollback.mockResolvedValue({ id: "rt-1" });
		mockReleaseDecisionService.applyManualOverride.mockRejectedValue(
			new Error("gate security_scan cannot be overridden"),
		);
		mockArtifactReferenceService.rejectArtifact.mockResolvedValue({ id: "art-2", status: "rejected" });
		mockArtifactReferenceService.isArtifactCompletenessSatisfied.mockResolvedValue({
			satisfied: false,
			missingArtifacts: ["approval_evidence"],
		});
	});

	it("permission denied without RBAC", async () => {
		const app = await buildApp();
		const res = await app.request("/release/goal-1/override", {
			method: "POST",
			headers: authHeader("viewer"),
			body: JSON.stringify({
				releaseCandidateId: "rc-1",
				gateEvaluationId: "qe-1",
				reason: "force",
				expiresAt: new Date(Date.now() + 60000).toISOString(),
			}),
		});
		expect(res.status).toBe(403);
	});

	it("production tenant missing denied", async () => {
		const app = await buildApp();
		const res = await app.request("/quality-gates/evaluate", {
			method: "POST",
			headers: authHeader("admin", ""),
			body: JSON.stringify({
				goalId: "goal-1",
				gateType: "security_scan",
				result: "passed",
				environment: "production",
			}),
		});
		expect(res.status).toBe(403);
	});

	it("quality gate evaluation route works", async () => {
		const app = await buildApp();
		const res = await app.request("/quality-gates/evaluate", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({
				goalId: "goal-1",
				gateType: "security_scan",
				result: "passed",
				environment: "production",
			}),
		});
		expect(res.status).toBe(200);
		expect(mockQualityGateService.evaluateGate).toHaveBeenCalledTimes(1);
	});

	it("approval reject route is wired", async () => {
		const app = await buildApp();
		const res = await app.request("/approvals/apr-1/reject", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({ reason: "failed review" }),
		});
		expect(res.status).toBe(200);
		expect(mockApprovalService.rejectRequest).toHaveBeenCalledTimes(1);
	});

	// Console ApprovalQueuePage sends { reason, metadata, artifactIds }; ControlPlanePage sends no body.
	it("approval reject forwards the console payload to the service", async () => {
		const app = await buildApp();
		const res = await app.request("/approvals/apr-1/reject", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({ reason: "failed review", metadata: { source: "queue" }, artifactIds: ["art-1"] }),
		});
		expect(res.status).toBe(200);
		expect(mockApprovalService.rejectRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalRequestId: "apr-1",
				reason: "failed review",
				metadata: { source: "queue" },
				artifactIds: ["art-1"],
			}),
		);
	});

	it("approval approve accepts an empty body", async () => {
		mockApprovalService.approveRequest.mockResolvedValue({ state: "approved", request: { goalId: "goal-1" } });
		const app = await buildApp();
		const res = await app.request("/approvals/apr-1/approve", { method: "POST", headers: authHeader("admin") });
		expect(res.status).toBe(200);
		expect(mockApprovalService.approveRequest).toHaveBeenCalledWith(
			expect.objectContaining({ approvalRequestId: "apr-1", reason: "", metadata: {}, artifactIds: [] }),
		);
	});

	it("approval decision falls back to comment when reason is absent", async () => {
		const app = await buildApp();
		const res = await app.request("/approvals/apr-1/reject", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({ comment: "needs rework" }),
		});
		expect(res.status).toBe(200);
		expect(mockApprovalService.rejectRequest).toHaveBeenCalledWith(expect.objectContaining({ reason: "needs rework" }));
	});

	it("approval decision enforces metadata and artifactIds limits", async () => {
		const app = await buildApp();
		const oversized = await app.request("/approvals/apr-1/reject", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({ reason: "x", metadata: { blob: "a".repeat(10_001) } }),
		});
		expect(oversized.status).toBe(422);
		const tooMany = await app.request("/approvals/apr-1/reject", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({ reason: "x", artifactIds: Array.from({ length: 101 }, (_, i) => `a-${i}`) }),
		});
		expect(tooMany.status).toBe(422);
		expect(mockApprovalService.rejectRequest).not.toHaveBeenCalled();
	});

	it("approval decision rejects unknown fields", async () => {
		const app = await buildApp();
		const res = await app.request("/approvals/apr-1/approve", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({ reason: "ok", isAdmin: true }),
		});
		expect(res.status).toBe(422);
		expect(mockApprovalService.approveRequest).not.toHaveBeenCalled();
	});

	it("manual override hard-fail denied", async () => {
		const app = await buildApp();
		const res = await app.request("/release/goal-1/override", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({
				releaseCandidateId: "rc-1",
				gateEvaluationId: "qe-1",
				reason: "force",
				expiresAt: new Date(Date.now() + 60000).toISOString(),
			}),
		});
		expect(res.status).toBe(409);
	});

	it("rollback trigger route persists correctly", async () => {
		const app = await buildApp();
		const res = await app.request("/release/goal-1/rollback", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({
				releaseCandidateId: "rc-1",
				triggerType: "incident",
				severity: "critical",
				source: "ops",
				reason: "service outage",
			}),
		});
		expect(res.status).toBe(200);
		expect(mockReleaseDecisionService.triggerRollback).toHaveBeenCalledTimes(1);
	});

	it("artifact rejection blocks release signal path", async () => {
		const app = await buildApp();
		const rejectRes = await app.request("/artifacts/art-1/reject", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({ reason: "hash mismatch" }),
		});
		expect(rejectRes.status).toBe(200);
		const completenessRes = await app.request("/artifacts/goal-1/completeness", {
			method: "GET",
			headers: authHeader("admin"),
		});
		expect(completenessRes.status).toBe(200);
		expect(mockArtifactReferenceService.isArtifactCompletenessSatisfied).toHaveBeenCalledWith("goal-1");
	});

	it("route payload validation works", async () => {
		const app = await buildApp();
		const res = await app.request("/release/goal-1/rollback", {
			method: "POST",
			headers: authHeader("admin"),
			body: JSON.stringify({
				releaseCandidateId: "rc-1",
				triggerType: "incident",
				severity: "severe",
				source: "ops",
				reason: "service outage",
			}),
		});
		expect(res.status).toBe(422);
	});
});
