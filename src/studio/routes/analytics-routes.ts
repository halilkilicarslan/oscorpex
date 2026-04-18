// ---------------------------------------------------------------------------
// Analytics Routes — Analytics, Costs, Token Usage, Budgets, Sonar
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	getActivityTimeline,
	getAgentAnalytics,
	getAllAgentCostSummaries,
	getAgentComparison,
	getAgentHeatMap,
	getAgentPerformanceTimeline,
	getProject,
	getProjectAnalytics,
	getProjectCostBreakdown,
	getProjectCostSummary,
	getProjectSettingsMap,
	getSearchObservability,
	listProjectAgents,
	listTokenUsage,
} from "../db.js";
import { getAgentConfig, getProjectAgent, listProjectTasks } from "../db.js";
import { checkDocsFreshness, generateReadme, regenerateAllDocs } from "../docs-generator.js";
import {
	fetchQualityGate,
	getLatestSonarScan,
	initSonarConfig,
	isSonarEnabled,
	recordSonarScan,
	runSonarScan,
} from "../sonar-runner.js";

export const analyticsRoutes = new Hono();

// ---- Analytics Routes -------------------------------------------------------

analyticsRoutes.get("/projects/:id/analytics/overview", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	try {
		return c.json(await getProjectAnalytics(projectId));
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : "Analytics hesaplanamadı" }, 500);
	}
});

analyticsRoutes.get("/projects/:id/analytics/agents", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	try {
		return c.json(await getAgentAnalytics(projectId));
	} catch (err) {
		return c.json(
			{
				error: err instanceof Error ? err.message : "Ajan metrikleri hesaplanamadı",
			},
			500,
		);
	}
});

analyticsRoutes.get("/projects/:id/analytics/timeline", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	const days = Math.min(Math.max(Number.parseInt(c.req.query("days") ?? "7", 10) || 7, 1), 30);
	try {
		return c.json(await getActivityTimeline(projectId, days));
	} catch (err) {
		return c.json(
			{
				error: err instanceof Error ? err.message : "Zaman çizelgesi hesaplanamadı",
			},
			500,
		);
	}
});

// ---------------------------------------------------------------------------
// Token Usage & Cost Tracking
// ---------------------------------------------------------------------------

analyticsRoutes.get("/projects/:id/costs", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(await getProjectCostSummary(projectId));
});

analyticsRoutes.get("/projects/:id/costs/breakdown", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(await getProjectCostBreakdown(projectId));
});

analyticsRoutes.get("/projects/:id/costs/history", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(await listTokenUsage(projectId));
});

analyticsRoutes.get("/projects/:id/token-analytics", async (c) => {
	const { id } = c.req.param();
	const project = await getProject(id);
	if (!project) return c.json({ error: "Not found" }, 404);

	const summary = await getProjectCostSummary(id);
	const totalInput = summary.totalInputTokens;
	const cacheRead = summary.totalCacheReadTokens;
	const cacheHitRatio = totalInput > 0 ? cacheRead / totalInput : 0;

	const estimatedSavingsUsd = cacheRead * 0.000003 * 0.9;

	return c.json({
		...summary,
		cacheHitRatio: Math.round(cacheHitRatio * 100) / 100,
		estimatedCacheSavingsUsd: Math.round(estimatedSavingsUsd * 10000) / 10000,
	});
});

analyticsRoutes.get("/projects/:id/budget/status", async (c) => {
	const { id } = c.req.param();
	const project = await getProject(id);
	if (!project) return c.json({ error: "Not found" }, 404);

	const settings = await getProjectSettingsMap(id);
	const budgetSettings = settings.budget || {};
	const maxCost = budgetSettings.maxCostUsd ? Number.parseFloat(budgetSettings.maxCostUsd) : null;
	const agentMaxCost = budgetSettings.agent_max_cost_usd ? Number.parseFloat(budgetSettings.agent_max_cost_usd) : null;

	const [projectCost, agents, agentCostMap] = await Promise.all([
		getProjectCostSummary(id),
		listProjectAgents(id),
		getAllAgentCostSummaries(id),
	]);

	const agentBudgets = agents.map((agent) => {
		const cost = agentCostMap.get(agent.id);
		const totalCostUsd = cost?.totalCostUsd ?? 0;
		const taskCount = cost?.taskCount ?? 0;
		return {
			agentId: agent.id,
			agentName: agent.name,
			role: agent.role,
			totalCostUsd,
			taskCount,
			budgetExceeded: agentMaxCost ? totalCostUsd >= agentMaxCost : false,
		};
	});

	return c.json({
		projectBudget: {
			maxCostUsd: maxCost,
			currentCostUsd: projectCost.totalCostUsd,
			exceeded: maxCost ? projectCost.totalCostUsd >= maxCost : false,
		},
		agentBudget: {
			maxCostPerAgentUsd: agentMaxCost,
			agents: agentBudgets,
		},
	});
});

// ---------------------------------------------------------------------------
// SonarQube — scan / status / quality gate
// ---------------------------------------------------------------------------

analyticsRoutes.get("/projects/:id/sonar/status", async (c) => {
	const projectId = c.req.param("id");
	return c.json({ enabled: await isSonarEnabled(projectId) });
});

analyticsRoutes.post("/projects/:id/sonar/scan", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	if (!(await isSonarEnabled(projectId))) {
		return c.json(
			{
				error: "SonarQube is not enabled. Set SONAR_ENABLED=true or enable in project settings.",
			},
			400,
		);
	}

	await initSonarConfig(project.repoPath, `studio-${projectId}`, project.name);

	const scanResult = await runSonarScan(project.repoPath, undefined, projectId);
	if (!scanResult.success) {
		return c.json({ error: scanResult.error || "Scan failed", output: scanResult.output }, 500);
	}

	const gate = await fetchQualityGate(`studio-${projectId}`, projectId);
	const scanId = await recordSonarScan(projectId, gate, scanResult.output);

	return c.json({ scanId, qualityGate: gate });
});

analyticsRoutes.get("/projects/:id/sonar/latest", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const scan = await getLatestSonarScan(projectId);
	return c.json(scan ?? { status: "NONE", conditions: [] });
});

// ---------------------------------------------------------------------------
// Docs Freshness Check
// ---------------------------------------------------------------------------

analyticsRoutes.get("/projects/:id/docs/freshness", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);
	const results = await checkDocsFreshness(project.repoPath);
	return c.json(results);
});

analyticsRoutes.post("/projects/:id/docs/regenerate", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	if (!project.repoPath) return c.json({ error: "No repo path configured" }, 400);

	const tasks = await listProjectTasks(projectId);
	const doneTasks = tasks.filter((t) => t.status === "done");

	const agents = new Map<string, any>();
	for (const task of doneTasks) {
		if (!task.assignedAgent || agents.has(task.assignedAgent)) continue;
		const agent = (await getAgentConfig(task.assignedAgent)) ?? (await getProjectAgent(task.assignedAgent));
		if (agent) agents.set(task.assignedAgent, agent);
	}

	const updated = await regenerateAllDocs(project, doneTasks, agents);
	return c.json({ regenerated: updated, total: doneTasks.length });
});

// ---------------------------------------------------------------------------
// README Auto-Generation
// ---------------------------------------------------------------------------

analyticsRoutes.post("/projects/:id/generate-readme", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	if (!project.repoPath) {
		return c.json({ error: "Project has no repository path" }, 400);
	}

	const logs: string[] = [];
	try {
		await generateReadme(projectId, (msg) => logs.push(msg));
		return c.json({ success: true, logs });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg, logs }, 500);
	}
});

// ---------------------------------------------------------------------------
// Project Settings — CRUD
// ---------------------------------------------------------------------------

analyticsRoutes.get("/projects/:id/settings", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(await getProjectSettingsMap(projectId));
});

analyticsRoutes.put("/projects/:id/settings/:category", async (c) => {
	const { setProjectSettings } = await import("../db.js");
	const projectId = c.req.param("id");
	const category = c.req.param("category");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = await c.req.json<Record<string, string>>();
	await setProjectSettings(projectId, category, body);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// v4.0: Context Analytics
// ---------------------------------------------------------------------------

analyticsRoutes.get("/projects/:id/analytics/context", async (c) => {
	try {
		const { getContextMetrics, getPerTaskContextMetrics } = await import("../context-analytics.js");
		const projectId = c.req.param("id");
		const project = await getProject(projectId);
		if (!project) return c.json({ error: "Project not found" }, 404);

		const [metrics, perTask] = await Promise.all([
			getContextMetrics(projectId),
			getPerTaskContextMetrics(projectId),
		]);

		return c.json({ metrics, perTask });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg }, 500);
	}
});

// ---------------------------------------------------------------------------
// v4.1: Agent Dashboard v2 — Heat Map, Timeline, Comparison
// ---------------------------------------------------------------------------

// GET /projects/:id/analytics/agents/heatmap
analyticsRoutes.get("/projects/:id/analytics/agents/heatmap", async (c) => {
	try {
		const projectId = c.req.param("id");
		const days = Number(c.req.query("days") ?? "14");
		const data = await getAgentHeatMap(projectId, days);
		return c.json({ data });
	} catch (err) {
		console.error("[analytics] agent heatmap failed:", err);
		return c.json({ error: "Failed to get agent heatmap" }, 500);
	}
});

// GET /projects/:id/analytics/agents/:agentId/timeline
analyticsRoutes.get("/projects/:id/analytics/agents/:agentId/timeline", async (c) => {
	try {
		const projectId = c.req.param("id");
		const agentId = c.req.param("agentId");
		const days = Number(c.req.query("days") ?? "14");
		const data = await getAgentPerformanceTimeline(projectId, agentId, days);
		return c.json({ data });
	} catch (err) {
		console.error("[analytics] agent timeline failed:", err);
		return c.json({ error: "Failed to get agent timeline" }, 500);
	}
});

// GET /projects/:id/analytics/agents/comparison
analyticsRoutes.get("/projects/:id/analytics/agents/comparison", async (c) => {
	try {
		const projectId = c.req.param("id");
		const data = await getAgentComparison(projectId);
		return c.json({ data });
	} catch (err) {
		console.error("[analytics] agent comparison failed:", err);
		return c.json({ error: "Failed to get agent comparison" }, 500);
	}
});

// ---------------------------------------------------------------------------
// v4.1: RAG Observability — Search quality dashboard
// ---------------------------------------------------------------------------

// GET /projects/:id/analytics/context/observability
analyticsRoutes.get("/projects/:id/analytics/context/observability", async (c) => {
	try {
		const projectId = c.req.param("id");
		const days = Number(c.req.query("days") ?? "7");
		const data = await getSearchObservability(projectId, days);
		return c.json(data);
	} catch (err) {
		console.error("[analytics] search observability failed:", err);
		return c.json({ error: "Failed to get search observability" }, 500);
	}
});
