// ---------------------------------------------------------------------------
// Oscorpex — Test Routes (V6 M2)
// Endpoints for triggering automated test runs and reading results.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getTestResults, getTestSummary, saveTestResult } from "../db.js";
import { testRunner } from "../test-runner.js";

const router = new Hono();

// ---------------------------------------------------------------------------
// POST /tests/run/:projectId — trigger a test run
// Body: { repoPath: string; taskId?: string }
// ---------------------------------------------------------------------------

router.post("/run/:projectId", async (c) => {
	try {
		const projectId = c.req.param("projectId");
		const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
		const repoPath = body.repoPath as string | undefined;
		const taskId = (body.taskId as string | undefined) ?? undefined;

		if (!repoPath) {
			return c.json({ error: "repoPath is required" }, 400);
		}

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
		console.error("[test-routes] POST /run/:projectId:", err);
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
		const taskId = c.req.query("taskId") ?? undefined;
		const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
		const offset = Number(c.req.query("offset") ?? "0");

		const results = await getTestResults(projectId, { taskId, limit, offset });
		return c.json(results);
	} catch (err) {
		console.error("[test-routes] GET /results/:projectId:", err);
		return c.json({ error: "Failed to fetch test results" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /tests/summary/:projectId — aggregated summary
// ---------------------------------------------------------------------------

router.get("/summary/:projectId", async (c) => {
	try {
		const projectId = c.req.param("projectId");
		const summary = await getTestSummary(projectId);
		return c.json(summary);
	} catch (err) {
		console.error("[test-routes] GET /summary/:projectId:", err);
		return c.json({ error: "Failed to fetch test summary" }, 500);
	}
});

export { router as testRoutes };
