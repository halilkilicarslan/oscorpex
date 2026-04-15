// ---------------------------------------------------------------------------
// Oscorpex — Lifecycle + Report Routes (v3.5)
// Project state transitions, hotfix dispatch, completion report
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getProject } from "../db.js";
import { getValidTransitions, transitionProject, triggerHotfix } from "../lifecycle-manager.js";
import { generateProjectReport, generateStakeholderReport } from "../report-generator.js";
import type { ProjectStatus } from "../types.js";

const VALID_STATUSES: ProjectStatus[] = [
	"planning",
	"approved",
	"running",
	"paused",
	"completed",
	"failed",
	"maintenance",
	"archived",
];

export const lifecycleRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /projects/:id/report — completion + cost + quality summary
// ---------------------------------------------------------------------------
lifecycleRoutes.get("/projects/:id/report", async (c) => {
	const projectId = c.req.param("id");
	try {
		const report = await generateProjectReport(projectId);
		return c.json({
			projectName: report.projectName,
			status: report.status,
			summary: {
				totalTasks: report.totalTasks,
				completedTasks: report.completedTasks,
				failedTasks: report.failedTasks,
				totalCostUsd: report.totalCostUsd,
				durationMs: report.durationMs,
			},
			quality: report.qualityMetrics,
			topChangedFiles: report.topFileChanges.map((path) => ({ path, changeCount: 1 })),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		console.error("[lifecycle-routes] report generation failed:", err);
		return c.json({ error: msg }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /projects/:id/report/stakeholder — plain-text non-technical summary (v3.8)
// ---------------------------------------------------------------------------
lifecycleRoutes.get("/projects/:id/report/stakeholder", async (c) => {
	const projectId = c.req.param("id");
	try {
		const summary = await generateStakeholderReport(projectId);
		return c.json({ summary });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		console.error("[lifecycle-routes] stakeholder report failed:", err);
		return c.json({ error: msg }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /projects/:id/lifecycle — current status + allowed transitions
// ---------------------------------------------------------------------------
lifecycleRoutes.get("/projects/:id/lifecycle", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: `Project ${projectId} not found` }, 404);

	return c.json({
		projectId,
		currentStatus: project.status,
		allowedTransitions: getValidTransitions(project.status),
	});
});

// ---------------------------------------------------------------------------
// POST /projects/:id/lifecycle/transition — manual state transition
// ---------------------------------------------------------------------------
lifecycleRoutes.post("/projects/:id/lifecycle/transition", async (c) => {
	const projectId = c.req.param("id");
	const body = await c.req.json().catch(() => ({}));
	const to = body?.to as ProjectStatus | undefined;

	if (!to || !VALID_STATUSES.includes(to)) {
		return c.json({ error: `Invalid target status: ${to}` }, 400);
	}

	try {
		await transitionProject(projectId, to);
		const updated = await getProject(projectId);
		return c.json({ projectId, status: updated?.status });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		if (msg.includes("Invalid transition")) return c.json({ error: msg }, 409);
		console.error("[lifecycle-routes] transition failed:", err);
		return c.json({ error: msg }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /projects/:id/hotfix — create an urgent hotfix task
// ---------------------------------------------------------------------------
lifecycleRoutes.post("/projects/:id/hotfix", async (c) => {
	const projectId = c.req.param("id");
	const body = await c.req.json().catch(() => ({}));
	const description = typeof body?.description === "string" ? body.description.trim() : "";

	if (!description) {
		return c.json({ error: "description is required" }, 400);
	}

	try {
		const taskId = await triggerHotfix(projectId, description);
		return c.json({ projectId, taskId });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		if (msg.includes("requires project in")) return c.json({ error: msg }, 409);
		if (msg.includes("has no plan") || msg.includes("no phases")) {
			return c.json({ error: msg }, 409);
		}
		console.error("[lifecycle-routes] hotfix failed:", err);
		return c.json({ error: msg }, 500);
	}
});
