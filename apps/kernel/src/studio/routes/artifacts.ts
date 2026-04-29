import { Hono } from "hono";
import { artifactReferenceService } from "../artifact-reference-service.js";
import { getTenantContext, logTenantActivity } from "../auth/tenant-context.js";

const artifactRoutes = new Hono();

function badRequest(c: any, message: string) {
	return c.json({ error: message }, 422);
}

function mapArtifactError(c: any, err: unknown) {
	if (err instanceof Error && err.message.includes("tenant_id is required")) return c.json({ error: err.message }, 422);
	if (err instanceof Error && err.message.includes("not found")) return c.json({ error: err.message }, 404);
	if (err instanceof Error) return c.json({ error: err.message }, 409);
	return c.json({ error: "unexpected error" }, 500);
}

artifactRoutes.post("/artifacts/register", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") return badRequest(c, "invalid request body");
	if (typeof body.goalId !== "string" || typeof body.artifactType !== "string" || typeof body.title !== "string") {
		return badRequest(c, "goalId, artifactType and title are required");
	}
	const environment = typeof body.environment === "string" ? body.environment : "production";
	if (!["dev", "staging", "production"].includes(environment)) return badRequest(c, "invalid environment");

	const tenant = getTenantContext(c);
	const correlationId = c.req.header("x-correlation-id") ?? null;
	const requestSource = c.req.header("x-request-source") ?? "http";
	try {
		const artifact = await artifactReferenceService.registerArtifact({
			goalId: body.goalId,
			tenantId: tenant.tenantId,
			artifactType: body.artifactType,
			title: body.title,
			uri: typeof body.uri === "string" ? body.uri : "",
			checksum: typeof body.checksum === "string" ? body.checksum : "",
			createdBy: tenant.userId ?? "system",
			environment,
			releaseCandidateId: typeof body.releaseCandidateId === "string" ? body.releaseCandidateId : null,
			approvalRequestId: typeof body.approvalRequestId === "string" ? body.approvalRequestId : null,
			releaseDecisionId: typeof body.releaseDecisionId === "string" ? body.releaseDecisionId : null,
			rollbackTriggerId: typeof body.rollbackTriggerId === "string" ? body.rollbackTriggerId : null,
			contentType: typeof body.contentType === "string" ? body.contentType : undefined,
			sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : undefined,
			metadata: {
				...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
				route: "artifacts.register",
				actor: tenant.userId,
				tenant: tenant.tenantId,
				requestSource,
				correlationId,
			},
		});
		if (tenant.tenantId && tenant.userId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "artifacts:register", {
				goalId: body.goalId,
				correlationId,
				requestSource,
				decisionReason: `artifact:${body.artifactType}`,
			});
		}
		return c.json({ ok: true, data: artifact });
	} catch (err) {
		return mapArtifactError(c, err);
	}
});

artifactRoutes.post("/artifacts/:id/verify", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => ({}));
	const tenant = getTenantContext(c);
	if (!id) return badRequest(c, "artifact id is required");
	if (!tenant.userId) return c.json({ error: "missing actor context" }, 403);
	try {
		const artifact = await artifactReferenceService.verifyArtifact({
			artifactId: id,
			verifiedBy: tenant.userId,
			reason: typeof body.reason === "string" ? body.reason : "",
			metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
		});
		if (tenant.tenantId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "artifacts:verify", {
				artifactId: id,
				goalId: artifact.goalId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
				decisionReason: typeof body.reason === "string" ? body.reason : "",
			});
		}
		return c.json({ ok: true, data: artifact });
	} catch (err) {
		return mapArtifactError(c, err);
	}
});

artifactRoutes.post("/artifacts/:id/reject", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	const tenant = getTenantContext(c);
	if (!id) return badRequest(c, "artifact id is required");
	if (!body || typeof body !== "object" || typeof body.reason !== "string" || !body.reason.trim()) {
		return badRequest(c, "rejection reason is required");
	}
	if (!tenant.userId) return c.json({ error: "missing actor context" }, 403);
	try {
		const artifact = await artifactReferenceService.rejectArtifact({
			artifactId: id,
			rejectedBy: tenant.userId,
			reason: body.reason,
			metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
		});
		if (tenant.tenantId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "artifacts:reject", {
				artifactId: id,
				goalId: artifact.goalId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
				decisionReason: body.reason,
			});
		}
		return c.json({ ok: true, data: artifact });
	} catch (err) {
		return mapArtifactError(c, err);
	}
});

artifactRoutes.post("/artifacts/:id/supersede", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => ({}));
	const tenant = getTenantContext(c);
	if (!id) return badRequest(c, "artifact id is required");
	if (!tenant.userId) return c.json({ error: "missing actor context" }, 403);
	try {
		await artifactReferenceService.supersedeArtifact({
			artifactId: id,
			supersededBy: tenant.userId,
			reason: typeof body.reason === "string" ? body.reason : "",
			metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
		});
		if (tenant.tenantId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "artifacts:supersede", {
				artifactId: id,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
				decisionReason: typeof body.reason === "string" ? body.reason : "",
			});
		}
		return c.json({ ok: true, data: { artifactId: id, superseded: true } });
	} catch (err) {
		return mapArtifactError(c, err);
	}
});

artifactRoutes.get("/artifacts/:goalId", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const artifacts = await artifactReferenceService.getArtifacts(goalId);
		return c.json({ ok: true, data: artifacts });
	} catch (err) {
		return mapArtifactError(c, err);
	}
});

artifactRoutes.get("/artifacts/:goalId/completeness", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const completeness = await artifactReferenceService.isArtifactCompletenessSatisfied(goalId);
		return c.json({ ok: true, data: completeness });
	} catch (err) {
		return mapArtifactError(c, err);
	}
});

export { artifactRoutes };
