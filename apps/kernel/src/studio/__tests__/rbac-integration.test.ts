import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { signJwt } from "../auth/jwt.js";
import { accessGuard } from "../auth/access-guard.js";
import { qualityGateRoutes } from "../routes/quality-gates.js";
import { approvalRoutes } from "../routes/approvals.js";
import { releaseRoutes } from "../routes/releases.js";
import { artifactRoutes } from "../routes/artifacts.js";
import { releaseDecisionService } from "../release-decision-service.js";
import { query } from "../pg.js";

let dbReady = false;
try {
	await query("SELECT 1");
	dbReady = true;
} catch {
	/* db yoksa skip */
}

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
	};
}

describe.skipIf(!dbReady)("H2-I RBAC Integration", () => {
	beforeEach(() => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
	});

	it("10) Route permission enforcement denies unauthorized users and prevents service execution", async () => {
		const app = buildApp();
		const spy = vi.spyOn(releaseDecisionService, "applyManualOverride");
		const res = await app.request("/release/goal-rbac/override", {
			method: "POST",
			headers: authHeaders("viewer", "tenant-rbac"),
			body: JSON.stringify({
				releaseCandidateId: "rc-rbac",
				gateEvaluationId: "qe-rbac",
				reason: "bypass attempt",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}),
		});
		expect(res.status).toBe(403);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("11) Unknown routes are denied by default", async () => {
		const app = buildApp();
		const res = await app.request("/quality-gates/internal/debug-secret", {
			method: "GET",
			headers: authHeaders("admin", "tenant-rbac"),
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error?: string };
		expect((body.error ?? "").toLowerCase()).toContain("unknown route");
	});
});
