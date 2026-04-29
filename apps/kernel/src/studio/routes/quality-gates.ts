import { Hono } from "hono";
import { qualityGateService, TenantRequiredForProductionError } from "../quality-gate-service.js";
import { getTenantContext, logTenantActivity } from "../auth/tenant-context.js";

const qualityGateRoutes = new Hono();

function badRequest(c: any, message: string, details?: Record<string, unknown>) {
	return c.json({ error: message, details: details ?? null }, 422);
}

function mapServiceError(c: any, err: unknown) {
	if (err instanceof TenantRequiredForProductionError) {
		return c.json({ error: err.message }, 422);
	}
	if (err instanceof Error && err.message.includes("goal not found")) {
		return c.json({ error: err.message }, 404);
	}
	if (err instanceof Error) {
		return c.json({ error: err.message }, 409);
	}
	return c.json({ error: "unexpected error" }, 500);
}

qualityGateRoutes.get("/quality-gates/:goalId", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const readiness = await qualityGateService.isReleaseReady(goalId);
		return c.json({ ok: true, data: readiness });
	} catch (err) {
		return mapServiceError(c, err);
	}
});

qualityGateRoutes.post("/quality-gates/evaluate", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") return badRequest(c, "invalid request body");
	const goalId = typeof body.goalId === "string" ? body.goalId : "";
	const gateType = typeof body.gateType === "string" ? body.gateType : "";
	const result = typeof body.result === "string" ? body.result : "";
	const environment = typeof body.environment === "string" ? body.environment : "production";
	if (!goalId || !gateType || !result) {
		return badRequest(c, "goalId, gateType and result are required");
	}
	if (!["dev", "staging", "production"].includes(environment)) {
		return badRequest(c, "invalid environment");
	}
	if (!["passed", "failed", "warning", "blocked"].includes(result)) {
		return badRequest(c, "invalid quality gate result");
	}

	const tenant = getTenantContext(c);
	const correlationId = c.req.header("x-correlation-id") ?? null;
	const requestSource = c.req.header("x-request-source") ?? "http";

	try {
		const evaluation = await qualityGateService.evaluateGate({
			goalId,
			gateType,
			result: result as "passed" | "failed" | "warning" | "blocked",
			environment: environment as "dev" | "staging" | "production",
			tenantId: tenant.tenantId,
			actor: tenant.userId ?? "system",
			reason: typeof body.reason === "string" ? body.reason : "",
			details: typeof body.details === "object" && body.details ? body.details as Record<string, unknown> : {},
			metadata: {
				route: "quality-gates.evaluate",
				actor: tenant.userId,
				tenant: tenant.tenantId,
				requestSource,
				correlationId,
			},
			correlationId: correlationId ?? undefined,
		});
		if (tenant.tenantId && tenant.userId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "quality-gates:evaluate", {
				goalId,
				correlationId,
				requestSource,
				decisionReason: typeof body.reason === "string" ? body.reason : "",
			});
		}
		return c.json({ ok: true, data: evaluation });
	} catch (err) {
		return mapServiceError(c, err);
	}
});

qualityGateRoutes.get("/quality-gates/:goalId/evaluations", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const evaluations = await qualityGateService.getLatestEvaluations(goalId);
		return c.json({ ok: true, data: evaluations });
	} catch (err) {
		return mapServiceError(c, err);
	}
});

qualityGateRoutes.get("/quality-gates/:goalId/blockers", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const blockers = await qualityGateService.getBlockingGates(goalId);
		return c.json({ ok: true, data: blockers });
	} catch (err) {
		return mapServiceError(c, err);
	}
});

qualityGateRoutes.get("/quality-gates/:goalId/readiness", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const readiness = await qualityGateService.isReleaseReady(goalId);
		return c.json({ ok: true, data: readiness });
	} catch (err) {
		return mapServiceError(c, err);
	}
});

export { qualityGateRoutes };
