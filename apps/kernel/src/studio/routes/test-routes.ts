// ---------------------------------------------------------------------------
// Oscorpex — Test Routes (V6 M2)
// Endpoints for triggering automated test runs and reading results.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { z } from "zod";
import { assertProjectInTenant, resolveProjectRepoPath } from "../auth/project-access.js";
import { getTestResults, getTestSummary, saveTestResult } from "../db.js";
import { createLogger } from "../logger.js";
import { testRunner } from "../test-runner.js";
const log = createLogger("test-routes");

const router = new Hono();

const RunTestsBodySchema = z.object({ taskId: z.string().min(1).max(200).optional() }).strict();

// ---------------------------------------------------------------------------
// POST /tests/run/:projectId — trigger a test run
// Body: { taskId?: string }. The repository path is resolved server-side from the project; a body path is a 400.
// ---------------------------------------------------------------------------

router.post("/run/:projectId", async (c) => {
	try {
		const projectId = c.req.param("projectId");
		const parsed = RunTestsBodySchema.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "Invalid body: only taskId is accepted" }, 400);
		const taskId = parsed.data.taskId;

		const denied = await assertProjectInTenant(c, projectId);
		if (denied) return denied;
		const repoPath = await resolveProjectRepoPath(c, projectId);
		if (!repoPath) return c.json({ error: "Project has no repository" }, 404);

		const result = await testRunner.runTests(projectId, repoPath, taskId);

		const saved = await saveTestResult({
			projectId,
			taskId: taskId ?? null,
			framework: result.framework,
			passed: result.passed,
			failed: result.failed,
			skipped: result.skipped,
			total: result.total,
			coverage: result.coverage,
			durationMs: result.durationMs,
			rawOutput: result.rawOutput,
		});

		return c.json(saved, 201);
	} catch (err) {
		log.error(`[test-routes] POST /run/:projectId: ${String(err)}`);
		return c.json({ error: "Failed to run tests" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /tests/results/:projectId — list test results
// Query params: taskId, limit, offset
// ---------------------------------------------------------------------------

router.get("/results/:projectId", async (c) => {
	try {
		const projectId = c.req.param("projectId");
		const denied = await assertProjectInTenant(c, projectId);
		if (denied) return denied;
		const taskId = c.req.query("taskId") ?? undefined;
		const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
		const offset = Number(c.req.query("offset") ?? "0");

		const results = await getTestResults(projectId, { taskId, limit, offset });
		return c.json(results);
	} catch (err) {
		log.error(`[test-routes] GET /results/:projectId: ${String(err)}`);
		return c.json({ error: "Failed to fetch test results" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /tests/summary/:projectId — aggregated summary
// ---------------------------------------------------------------------------

router.get("/summary/:projectId", async (c) => {
	try {
		const projectId = c.req.param("projectId");
		const denied = await assertProjectInTenant(c, projectId);
		if (denied) return denied;
		const summary = await getTestSummary(projectId);
		return c.json(summary);
	} catch (err) {
		log.error(`[test-routes] GET /summary/:projectId: ${String(err)}`);
		return c.json({ error: "Failed to fetch test summary" }, 500);
	}
});

export { router as testRoutes };
