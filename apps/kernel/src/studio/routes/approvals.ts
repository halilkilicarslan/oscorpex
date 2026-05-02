import { Hono } from "hono";
import {
	InvalidApprovalTransitionError,
	TenantRequiredForProductionApprovalError,
	approvalService,
} from "../approval-service.js";
import { getTenantContext, logTenantActivity } from "../auth/tenant-context.js";

const approvalRoutes = new Hono();

function badRequest(c: any, message: string) {
	return c.json({ error: message }, 422);
}

function mapApprovalError(c: any, err: unknown) {
	if (err instanceof TenantRequiredForProductionApprovalError) return c.json({ error: err.message }, 422);
	if (err instanceof InvalidApprovalTransitionError) return c.json({ error: err.message }, 409);
	if (err instanceof Error && err.message.includes("not found")) return c.json({ error: err.message }, 404);
	if (err instanceof Error) return c.json({ error: err.message }, 422);
	return c.json({ error: "unexpected error" }, 500);
}

approvalRoutes.post("/approvals/request", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object") return badRequest(c, "invalid request body");
	if (typeof body.goalId !== "string" || typeof body.approvalType !== "string") {
		return badRequest(c, "goalId and approvalType are required");
	}
	if (typeof body.requiredRole !== "string" || typeof body.requiredQuorum !== "number") {
		return badRequest(c, "requiredRole and requiredQuorum are required");
	}
	const environment = typeof body.environment === "string" ? body.environment : "production";
	if (!["dev", "staging", "production"].includes(environment)) return badRequest(c, "invalid environment");

	const tenant = getTenantContext(c);
	const correlationId = c.req.header("x-correlation-id") ?? null;
	const requestSource = c.req.header("x-request-source") ?? "http";
	try {
		const request = await approvalService.createApprovalRequest({
			goalId: body.goalId,
			approvalType: body.approvalType,
			requiredRole: body.requiredRole,
			requiredRoles: Array.isArray(body.requiredRoles) ? body.requiredRoles : undefined,
			requiredQuorum: body.requiredQuorum,
			tenantId: tenant.tenantId,
			environment,
			expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
			requestedBy: tenant.userId ?? "system",
			reason: typeof body.reason === "string" ? body.reason : "",
			releaseCandidateId: typeof body.releaseCandidateId === "string" ? body.releaseCandidateId : null,
			artifactIds: Array.isArray(body.artifactIds) ? body.artifactIds : [],
			metadata: {
				...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
				route: "approvals.request",
				actor: tenant.userId,
				tenant: tenant.tenantId,
				correlationId,
				requestSource,
			},
		});
		if (tenant.tenantId && tenant.userId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "approvals:request", {
				goalId: body.goalId,
				correlationId,
				requestSource,
				decisionReason: typeof body.reason === "string" ? body.reason : "",
			});
		}
		return c.json({ ok: true, data: request });
	} catch (err) {
		return mapApprovalError(c, err);
	}
});

approvalRoutes.post("/approvals/:id/approve", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => ({}));
	const tenant = getTenantContext(c);
	if (!id) return badRequest(c, "approval id is required");
	if (!tenant.userId || !tenant.userRole) return c.json({ error: "missing actor context" }, 403);

	try {
		const state = await approvalService.approveRequest({
			approvalRequestId: id,
			tenantId: tenant.tenantId,
			actorId: tenant.userId,
			actorRoles: [tenant.userRole],
			reason: typeof body.reason === "string" ? body.reason : "",
			artifactIds: Array.isArray(body.artifactIds) ? body.artifactIds : [],
			metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
		});
		if (tenant.tenantId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "approvals:approve", {
				approvalRequestId: id,
				goalId: state.request.goalId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
				decisionReason: typeof body.reason === "string" ? body.reason : "",
			});
		}
		return c.json({ ok: true, data: state });
	} catch (err) {
		return mapApprovalError(c, err);
	}
});

approvalRoutes.post("/approvals/:id/reject", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => ({}));
	const tenant = getTenantContext(c);
	if (!id) return badRequest(c, "approval id is required");
	if (!tenant.userId || !tenant.userRole) return c.json({ error: "missing actor context" }, 403);

	try {
		const state = await approvalService.rejectRequest({
			approvalRequestId: id,
			tenantId: tenant.tenantId,
			actorId: tenant.userId,
			actorRoles: [tenant.userRole],
			reason: typeof body.reason === "string" ? body.reason : "",
			artifactIds: Array.isArray(body.artifactIds) ? body.artifactIds : [],
			metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
		});
		if (tenant.tenantId) {
			await logTenantActivity(tenant.tenantId, tenant.userId, "approvals:reject", {
				approvalRequestId: id,
				goalId: state.request.goalId,
				correlationId: c.req.header("x-correlation-id") ?? null,
				requestSource: c.req.header("x-request-source") ?? "http",
				decisionReason: typeof body.reason === "string" ? body.reason : "",
			});
		}
		return c.json({ ok: true, data: state });
	} catch (err) {
		return mapApprovalError(c, err);
	}
});

approvalRoutes.get("/approvals/pending", async (c) => {
	const goalId = c.req.query("goalId");
	if (!goalId) return badRequest(c, "goalId query param is required");
	try {
		const pending = await approvalService.getPendingApprovals(goalId);
		return c.json({ ok: true, data: pending });
	} catch (err) {
		return mapApprovalError(c, err);
	}
});

approvalRoutes.get("/approvals/:goalId/state", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const state = await approvalService.getApprovalState(goalId);
		return c.json({ ok: true, data: state });
	} catch (err) {
		return mapApprovalError(c, err);
	}
});

approvalRoutes.get("/approvals/:goalId/satisfied", async (c) => {
	const goalId = c.req.param("goalId");
	if (!goalId) return badRequest(c, "goalId is required");
	try {
		const satisfied = await approvalService.isApprovalSatisfied(goalId);
		return c.json({ ok: true, data: { goalId, satisfied } });
	} catch (err) {
		return mapApprovalError(c, err);
	}
});

export { approvalRoutes };
