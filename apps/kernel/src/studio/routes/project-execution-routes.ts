// ---------------------------------------------------------------------------
// Project Execution Routes — Execute, Status, Progress, Pipeline, Events SSE
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { verifyJwt } from "../auth/jwt.js";
import { getTenantContext, verifyProjectAccess } from "../auth/tenant-context.js";
import { getLatestPlan, getProject } from "../db.js";
import { eventBus } from "../event-bus.js";
import { kernel } from "../kernel/index.js";
import { createLogger } from "../logger.js";
import { ensureProjectTeamInitialized } from "./team-init-guard.js";

const log = createLogger("project-execution-routes");

export const projectExecutionRoutes = new Hono();

// ---- Execution ------------------------------------------------------------

projectExecutionRoutes.post("/projects/:id/execute", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	const teamGuard = await ensureProjectTeamInitialized(c, projectId);
	if (teamGuard) return teamGuard;

	kernel.startProjectExecution(projectId).catch((err) => {
		log.error("[kernel] manual execute failed:" + " " + String(err));
	});

	return c.json({ success: true, message: "Execution started" });
});

projectExecutionRoutes.get("/projects/:id/execution/status", async (c) => {
	try {
		const projectId = c.req.param("id");
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);
		return c.json(await kernel.getExecutionStatus(projectId));
	} catch (err) {
		log.error("[project-execution-routes] execution status failed:" + " " + String(err));
		return c.json({ error: "Failed to get execution status" }, 500);
	}
});

projectExecutionRoutes.get("/projects/:id/progress", (c) => {
	return c.json(kernel.getProjectProgress(c.req.param("id")));
});

// ---- Pipeline auto-start status -------------------------------------------

projectExecutionRoutes.get("/projects/:id/pipeline/auto-start-status", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const plan = await getLatestPlan(projectId);
	const planApproved = plan?.status === "approved";

	const enriched = await kernel.getPipelineStatus(projectId);
	const pipelineState = enriched.pipelineState;

	return c.json({
		projectId,
		planApproved,
		autoStartEnabled: true,
		pipeline: pipelineState
			? {
					status: pipelineState.status,
					currentStage: pipelineState.currentStage,
					totalStages: pipelineState.stages.length,
					startedAt: pipelineState.startedAt,
				}
			: null,
		effectiveStatus: enriched.derivedStatus,
		taskProgress: enriched.taskProgress.overall,
		warning: enriched.warning,
	});
});

// ---- Event Stream (SSE) ---------------------------------------------------

projectExecutionRoutes.get("/projects/:id/events", async (c) => {
	const projectId = c.req.param("id");

	// SSE: browser EventSource cannot send Authorization headers.
	// Accept ?token=<jwt> query param as fallback when auth is enabled.
	const tokenParam = c.req.query("token");
	if (tokenParam) {
		const payload = verifyJwt(tokenParam);
		if (payload) {
			// biome-ignore lint/suspicious/noExplicitAny: Hono Context is untyped here — set auth variables for downstream helpers
			const cx = c as any;
			cx.set("tenantId", payload.tenantId);
			cx.set("userId", payload.sub);
			cx.set("userRole", payload.role);
			cx.set("authType", "jwt");
		}
	}

	// Ownership check (no-op when auth disabled)
	const { tenantId } = getTenantContext(c);
	const hasAccess = await verifyProjectAccess(projectId, tenantId);
	if (!hasAccess) return c.json({ error: "Project not found" }, 404);

	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const { listEvents } = await import("../db.js");

	return streamSSE(c, async (stream) => {
		const recent = await listEvents(projectId, 20);
		for (const event of recent.reverse()) {
			await stream.writeSSE({
				event: event.type,
				data: JSON.stringify(event),
				id: event.id,
			});
		}

		const unsubscribe = eventBus.onProject(projectId, async (event) => {
			try {
				await stream.writeSSE({
					event: event.type,
					data: JSON.stringify(event),
					id: event.id,
				});
			} catch {
				unsubscribe();
			}
		});

		stream.onAbort(() => {
			unsubscribe();
		});
	});
});

// ---- Recent events (REST) -------------------------------------------------

projectExecutionRoutes.get("/projects/:id/events/recent", async (c) => {
	const { listEvents, countEvents } = await import("../db.js");
	const projectId = c.req.param("id");
	const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
	const offset = Number(c.req.query("offset") ?? 0);
	const [events, total] = await Promise.all([listEvents(projectId, limit, offset), countEvents(projectId)]);
	c.header("X-Total-Count", String(total));
	return c.json(events);
});
