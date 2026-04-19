// ---------------------------------------------------------------------------
// Oscorpex — Cost Optimization Routes (V6 M2 F8)
// Exposes cost insights, model recommendations, and efficiency metrics.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getProject } from "../db.js";
import { costOptimizer } from "../cost-optimizer.js";
import type { TaskComplexity } from "../types.js";

const router = new Hono();

// ---------------------------------------------------------------------------
// GET /cost/insights/:projectId
// Returns cost optimization insights: total spend, potential savings, model
// efficiency stats, and actionable recommendations.
// ---------------------------------------------------------------------------

router.get("/insights/:projectId", async (c) => {
	const projectId = c.req.param("projectId");
	try {
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);

		const insights = await costOptimizer.getCostInsights(projectId);
		return c.json(insights);
	} catch (err) {
		console.error("[cost-routes] getCostInsights failed:", err);
		return c.json({ error: err instanceof Error ? err.message : "Failed to compute cost insights" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /cost/recommendation/:projectId
// Returns the recommended model for the next task in this project.
// Query params:
//   complexity — S | M | L | XL (default: M)
//   taskType   — optional hint (e.g. "backend", "frontend", "test")
// ---------------------------------------------------------------------------

router.get("/recommendation/:projectId", async (c) => {
	const projectId = c.req.param("projectId");
	try {
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);

		const rawComplexity = (c.req.query("complexity") ?? "M").toUpperCase();
		const validComplexities: TaskComplexity[] = ["S", "M", "L", "XL"];
		const complexity: TaskComplexity = validComplexities.includes(rawComplexity as TaskComplexity)
			? (rawComplexity as TaskComplexity)
			: "M";

		const taskType = c.req.query("taskType") ?? undefined;

		const recommendation = await costOptimizer.getRecommendation(projectId, complexity, taskType);
		return c.json(recommendation);
	} catch (err) {
		console.error("[cost-routes] getRecommendation failed:", err);
		return c.json({ error: err instanceof Error ? err.message : "Failed to compute recommendation" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /cost/efficiency/:projectId
// Returns per-model efficiency breakdown: cost, tokens, success rate, score.
// ---------------------------------------------------------------------------

router.get("/efficiency/:projectId", async (c) => {
	const projectId = c.req.param("projectId");
	try {
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);

		const stats = await costOptimizer.getModelEfficiency(projectId);
		return c.json({ projectId, models: stats });
	} catch (err) {
		console.error("[cost-routes] getModelEfficiency failed:", err);
		return c.json({ error: err instanceof Error ? err.message : "Failed to compute model efficiency" }, 500);
	}
});

export { router as costRoutes };
