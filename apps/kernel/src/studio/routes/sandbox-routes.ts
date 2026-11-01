// ---------------------------------------------------------------------------
// Oscorpex — Sandbox Routes: Capability isolation policies and sessions
// Phase 3 API endpoints for sandbox management.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { z } from "zod";
import { assertProjectInTenant } from "../auth/project-access.js";
import { getTask } from "../db.js";
import { createLogger } from "../logger.js";
import { createSandboxPolicy, getSandboxPolicy, getSessionViolations, resolveTaskPolicy } from "../sandbox-manager.js";
const log = createLogger("sandbox-routes");

const SUPPORTED_ISOLATION = z.enum(["none", "workspace"]);

export const sandboxRoutes = new Hono();

// ---------------------------------------------------------------------------
// Sandbox Policies
// ---------------------------------------------------------------------------

sandboxRoutes.get("/projects/:projectId/sandbox-policy", async (c) => {
	try {
		const policy = await getSandboxPolicy(c.req.param("projectId"));
		if (!policy) return c.json({ message: "No custom policy — using defaults" }, 200);
		return c.json(policy);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

sandboxRoutes.post("/projects/:projectId/sandbox-policy", async (c) => {
	try {
		const body = await c.req.json();
		// container/vm cannot be provided (they fail the task at run time); only the supported levels are stored
		if (body.isolationLevel !== undefined && !SUPPORTED_ISOLATION.safeParse(body.isolationLevel).success) {
			return c.json({ error: 'isolationLevel must be "none" or "workspace"' }, 400);
		}
		const policy = await createSandboxPolicy({
			projectId: c.req.param("projectId"),
			isolationLevel: body.isolationLevel ?? "workspace",
			allowedTools: body.allowedTools ?? [],
			deniedTools: body.deniedTools ?? [],
			filesystemScope: body.filesystemScope ?? [],
			networkPolicy: body.networkPolicy ?? "project_only",
			maxExecutionTimeMs: body.maxExecutionTimeMs ?? 300_000,
			maxOutputSizeBytes: body.maxOutputSizeBytes ?? 10_485_760,
			elevatedCapabilities: body.elevatedCapabilities ?? [],
			enforcementMode: body.enforcementMode ?? "hard",
		});
		return c.json(policy, 201);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Task-specific policy resolution
// ---------------------------------------------------------------------------

sandboxRoutes.get("/tasks/:taskId/sandbox-policy", async (c) => {
	try {
		const projectId = c.req.query("projectId");
		if (!projectId) return c.json({ error: "projectId query param required" }, 400);
		const denied = await assertProjectInTenant(c, projectId);
		if (denied) return denied;
		const task = await getTask(c.req.param("taskId"));
		if (!task || task.projectId !== projectId) return c.json({ error: "Task not found" }, 404);
		const agentRole = c.req.query("agentRole") ?? task.assignedAgent;
		const policy = await resolveTaskPolicy(projectId, task, agentRole);
		return c.json(policy);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Session violations
// ---------------------------------------------------------------------------

sandboxRoutes.get("/sandbox-sessions/:sessionId/violations", async (c) => {
	try {
		const violations = await getSessionViolations(c.req.param("sessionId"));
		return c.json(violations);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});
