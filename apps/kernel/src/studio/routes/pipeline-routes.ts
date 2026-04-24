// ---------------------------------------------------------------------------
// Pipeline Routes — Pipeline Engine control
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { requirePermission } from "../auth/rbac.js";
import { getLatestPlan, getProject, getTask, listPhases, listProjectAgents, listTasks } from "../db.js";
import { kernel } from "../kernel/index.js";
import { pipelineEngine } from "../pipeline-engine.js";
import type { Task } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("pipeline-routes");

export const pipelineRoutes = new Hono();

// POST /projects/:id/pipeline/start
pipelineRoutes.post("/projects/:id/pipeline/start", requirePermission("pipeline:start"), async (c) => {
	const projectId = c.req.param("id") ?? "";
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	try {
		const state = await kernel.startPipeline(projectId);
		return c.json({ success: true, pipeline: state }, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Pipeline başlatılamadı";
		return c.json({ error: msg }, 500);
	}
});

// GET /projects/:id/pipeline/status
pipelineRoutes.get("/projects/:id/pipeline/status", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const enriched = await kernel.getPipelineStatus(projectId);

	if (!enriched.pipelineState && enriched.taskProgress.overall.total === 0) {
		return c.json({ error: "Bu proje için pipeline kaydı bulunamadı" }, 404);
	}

	const pipelineState = enriched.pipelineState;
	if (pipelineState?.stages) {
		const plan = await getLatestPlan(projectId);
		const allTasks: Task[] = [];
		if (plan) {
			const phases = await listPhases(plan.id);
			for (const phase of phases) {
				const phaseTasks = await listTasks(phase.id);
				allTasks.push(...phaseTasks);
			}
		}

		const reviewTasksToRelocate: { task: any; fromStageIdx: number }[] = [];
		for (let si = 0; si < pipelineState.stages.length; si++) {
			const stage = pipelineState.stages[si];
			if (!stage.tasks) continue;
			for (let i = 0; i < stage.tasks.length; i++) {
				const fresh = await getTask(stage.tasks[i].id);
				if (fresh) {
					stage.tasks[i] = { ...stage.tasks[i], ...fresh };
					if (fresh.title.startsWith("Code Review: ") && fresh.dependsOn?.length > 0) {
						const depId = fresh.dependsOn[0];
						const depInThisStage = stage.tasks.some((t: any) => t.id === depId);
						if (!depInThisStage) {
							reviewTasksToRelocate.push({
								task: stage.tasks[i],
								fromStageIdx: si,
							});
						}
					}
				}
			}
		}

		const agents = await listProjectAgents(projectId);
		const agentById = new Map(agents.map((a) => [a.id, a]));

		for (const { task, fromStageIdx } of reviewTasksToRelocate) {
			const depId = task.dependsOn[0];
			const targetStageIdx = pipelineState.stages.findIndex((s: any) =>
				(s.tasks ?? []).some((t: any) => t.id === depId),
			);
			if (targetStageIdx >= 0 && targetStageIdx !== fromStageIdx) {
				pipelineState.stages[fromStageIdx].tasks = pipelineState.stages[fromStageIdx].tasks.filter(
					(t: any) => t.id !== task.id,
				);
				const targetStage = pipelineState.stages[targetStageIdx];
				targetStage.tasks.push(task);
				const reviewerAgent = agentById.get(task.assignedAgent ?? task.assignedAgentId);
				if (reviewerAgent && !targetStage.agents.some((a: any) => a.id === reviewerAgent.id)) {
					targetStage.agents.push(reviewerAgent as any);
				}
			}
		}

		const existingTaskIds = new Set(pipelineState.stages.flatMap((s) => (s.tasks ?? []).map((t: any) => t.id)));
		for (const task of allTasks) {
			if (existingTaskIds.has(task.id)) continue;

			const isReviewTask = task.title.startsWith("Code Review: ") && task.dependsOn.length > 0;
			if (isReviewTask) {
				const depId = task.dependsOn[0];
				const targetStage = pipelineState.stages.find((s: any) => (s.tasks ?? []).some((t: any) => t.id === depId));
				if (targetStage) {
					if (!targetStage.tasks) targetStage.tasks = [];
					targetStage.tasks.push(task as any);
					const reviewerAgent = agentById.get(task.assignedAgent ?? task.assignedAgentId);
					if (reviewerAgent && !targetStage.agents.some((a: any) => a.id === reviewerAgent.id)) {
						targetStage.agents.push(reviewerAgent as any);
					}
					continue;
				}
			}

			const assignedId = task.assignedAgent ?? task.assignedAgentId;
			if (!assignedId) continue;
			for (const stage of pipelineState.stages) {
				const match = stage.agents.some(
					(a: any) =>
						a.id === assignedId ||
						a.sourceAgentId === assignedId ||
						a.name.toLowerCase() === assignedId.toLowerCase() ||
						a.role.toLowerCase() === assignedId.toLowerCase(),
				);
				if (match) {
					if (!stage.tasks) stage.tasks = [];
					stage.tasks.push(task as any);
					break;
				}
			}
		}
	}

	return c.json({
		pipeline: pipelineState,
		taskProgress: enriched.taskProgress,
		status: enriched.derivedStatus,
		warning: enriched.warning,
	});
});

// POST /projects/:id/pipeline/pause
pipelineRoutes.post("/projects/:id/pipeline/pause", requirePermission("pipeline:pause"), async (c) => {
	const projectId = c.req.param("id") ?? "";
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	try {
		await kernel.pausePipeline(projectId);
		return c.json({ success: true, message: "Pipeline duraklatıldı" });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Pipeline duraklatılamadı";
		return c.json({ error: msg }, 400);
	}
});

// POST /projects/:id/pipeline/resume
pipelineRoutes.post("/projects/:id/pipeline/resume", requirePermission("pipeline:resume"), async (c) => {
	const projectId = c.req.param("id") ?? "";
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	try {
		await kernel.resumePipeline(projectId);
		return c.json({ success: true, message: "Pipeline devam ettirildi" });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Pipeline devam ettirilemedi";
		return c.json({ error: msg }, 400);
	}
});

// POST /projects/:id/pipeline/retry
pipelineRoutes.post("/projects/:id/pipeline/retry", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	try {
		await kernel.retryPipeline(projectId);
		return c.json({
			success: true,
			message: "Failed pipeline yeniden başlatıldı",
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Pipeline retry başarısız";
		return c.json({ error: msg }, 400);
	}
});

// POST /projects/:id/pipeline/advance
pipelineRoutes.post("/projects/:id/pipeline/advance", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	try {
		const state = await kernel.advancePipeline(projectId);
		return c.json({ success: true, pipeline: state });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Pipeline ilerletilemedi";
		return c.json({ error: msg }, 400);
	}
});
