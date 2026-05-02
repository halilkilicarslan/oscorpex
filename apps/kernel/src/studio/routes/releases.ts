import { Hono } from "hono";
import { getTenantContext, logTenantActivity } from "../auth/tenant-context.js";
import {
	InvalidOverrideInputError,
	NonOverridableGateError,
	ReleaseCandidateNotFoundError,
	TenantRequiredForProductionReleaseError,
	releaseDecisionService,
} from "../release-decision-service.js";

const releaseRoutes = new Hono();

function badRequest(c: any, message: string) {
	return c.json({ error: message }, 422);
}

function mapReleaseError(c: any, err: unknown) {
	if (err instanceof TenantRequiredForProductionReleaseError) return c.json({ error: err.message }, 422);
	if (err instanceof ReleaseCandidateNotFoundError) return c.json({ error: err.message }, 404);
	if (err instanceof InvalidOverrideInputError || err instanceof NonOverridableGateError)
		return c.json({ error: err.message }, 422);
	if (err instanceof Error && err.message.includes("not found")) return c.json({ error: err.message }, 404);
	if (err instanceof Error) return c.json({ error: err.message }, 409);
	return c.json({ error: "unexpected error" }, 500);
}

releaseRoutes.post("/release-candidates/create", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") return badRequest(c, "invalid request body");
	if (typeof body.goalId !== "string") return badRequest(c, "goalId is required");
	const targetEnvironment = typeof body.targetEnvironment === "string" ? body.targetEnvironment : "production";
	if (!["dev", "staging", "production"].includes(targetEnvironment)) return badRequest(c, "invalid environment");
	const tenant = getTenantContext(c);
	const correlationId = c.req.header("x-correlation-id") ?? null;
	const requestSource = c.req.header("x-request-source") ?? "http";
	try {
		const candidate = await releaseDecisionService.createReleaseCandidate({
			goalId: body.goalId,
			targetEnvironment: targetEnvironment as "dev" | "staging" | "production",
			tenantId: tenant.tenantId,
			requestedBy: tenant.userId ?? "system",
			artifactIds: Array.isArray(body.artifactIds) ? body.artifactIds : [],
			policyVersion: typeof body.policyVersion === "string" ? body.policyVersion : "1",
			correlationId: correlationId ?? undefined,
			metadata: {
				...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
				route: "release-candidates.create",
				actor: tenant.userId,
				tenant: tenant.tenantId,
				requestSource,
				correlationId,
			},
		});
		if (tenant.tenantId && tenant.userId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "release-candidates:create", {
				goalId: body.goalId,
				correlationId,
				requestSource,
				decisionReason: "release candidate create",
			});
		}
		return c.json({ ok: true, data: candidate });
	} catch (err) {
		return mapReleaseError(c, err);
	}
});

releaseRoutes.get("/release-candidates/:id", async (c) => {
	const id = c.req.param("id");
	if (!id) return badRequest(c, "candidate id is required");
	try {
		const candidate = await releaseDecisionService.getReleaseCandidate(id);
		return c.json({ ok: true, data: candidate });
	} catch (err) {
		return mapReleaseError(c, err);
	}
});

releaseRoutes.post("/release/:goalId/evaluate", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const decision = await releaseDecisionService.evaluateReleaseDecision(goalId);
		return c.json({ ok: true, data: decision });
	} catch (err) {
		return mapReleaseError(c, err);
	}
});

releaseRoutes.get("/release/:goalId/state", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const state = await releaseDecisionService.resolveReleaseState(goalId);
		return c.json({ ok: true, data: state });
	} catch (err) {
		return mapReleaseError(c, err);
	}
});

releaseRoutes.post("/release/:goalId/override", async (c) => {
	const goalId = c.req.param("goalId");
	const body = await c.req.json().catch(() => null);
	if (!goalId) return badRequest(c, "goalId is required");
	if (!body || typeof body !== "object") return badRequest(c, "invalid request body");
	if (typeof body.releaseCandidateId !== "string" || typeof body.gateEvaluationId !== "string") {
		return badRequest(c, "releaseCandidateId and gateEvaluationId are required");
	}
	if (typeof body.reason !== "string" || !body.reason.trim()) return badRequest(c, "override reason is required");
	if (typeof body.expiresAt !== "string" || !body.expiresAt.trim()) return badRequest(c, "expiresAt is required");
	const tenant = getTenantContext(c);
	if (!tenant.userId || !tenant.userRole) return c.json({ error: "missing actor context" }, 403);
	try {
		const result = await releaseDecisionService.applyManualOverride({
			releaseCandidateId: body.releaseCandidateId,
			gateEvaluationId: body.gateEvaluationId,
			actorId: tenant.userId,
			actorRoles: [tenant.userRole],
			reason: body.reason,
			expiresAt: body.expiresAt,
			metadata: {
				goalId,
				...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
				route: "release.override",
				actor: tenant.userId,
				tenant: tenant.tenantId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
			},
		});
		if (tenant.tenantId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "release:override", {
				goalId,
				releaseCandidateId: body.releaseCandidateId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
				decisionReason: body.reason,
			});
		}
		return c.json({ ok: true, data: result });
	} catch (err) {
		return mapReleaseError(c, err);
	}
});

releaseRoutes.post("/release/:goalId/rollback", async (c) => {
	const goalId = c.req.param("goalId");
	const body = await c.req.json().catch(() => null);
	if (!goalId) return badRequest(c, "goalId is required");
	if (!body || typeof body !== "object") return badRequest(c, "invalid request body");
	if (
		typeof body.releaseCandidateId !== "string" ||
		typeof body.reason !== "string" ||
		typeof body.source !== "string"
	) {
		return badRequest(c, "releaseCandidateId, reason and source are required");
	}
	if (!["info", "warning", "high", "critical"].includes(body.severity)) {
		return badRequest(c, "invalid rollback severity");
	}
	if (typeof body.triggerType !== "string") return badRequest(c, "triggerType is required");
	const tenant = getTenantContext(c);
	if (!tenant.userId) return c.json({ error: "missing actor context" }, 403);
	try {
		const trigger = await releaseDecisionService.triggerRollback({
			releaseCandidateId: body.releaseCandidateId,
			triggerType: body.triggerType,
			severity: body.severity,
			automatic: Boolean(body.automatic),
			source: body.source,
			reason: body.reason,
			qualitySignalIds: Array.isArray(body.qualitySignalIds) ? body.qualitySignalIds : [],
			artifactIds: Array.isArray(body.artifactIds) ? body.artifactIds : [],
			incidentId: typeof body.incidentId === "string" ? body.incidentId : null,
			metadata: {
				goalId,
				...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
				route: "release.rollback",
				actor: tenant.userId,
				tenant: tenant.tenantId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
			},
		});
		if (tenant.tenantId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "release:rollback", {
				goalId,
				releaseCandidateId: body.releaseCandidateId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
				decisionReason: body.reason,
			});
		}
		return c.json({ ok: true, data: trigger });
	} catch (err) {
		return mapReleaseError(c, err);
	}
});

export { releaseRoutes };
