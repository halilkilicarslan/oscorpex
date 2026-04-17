// ---------------------------------------------------------------------------
// Task Routes — Tasks, Approvals, Streams
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { containerManager } from "../container-manager.js";
import { appendTaskLogs, getProject, getTask, getTaskDiffs, getTaskDiffSummary, listPendingApprovals, listProjectTasks, updateTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import { executionEngine } from "../execution-engine.js";
import { taskEngine } from "../task-engine.js";

export const taskRoutes = new Hono();

// ---- Tasks ----------------------------------------------------------------

taskRoutes.get("/projects/:id/tasks", async (c) => {
	try {
		const tasks = await listProjectTasks(c.req.param("id"));

		const tasksWithSummary = tasks.map((task) => ({
			...task,
			outputSummary: task.output
				? {
						filesCreatedCount: task.output.filesCreated.length,
						filesModifiedCount: task.output.filesModified.length,
						logLineCount: task.output.logs.length,
						hasTestResults: task.output.testResults !== undefined,
					}
				: null,
		}));

		return c.json(tasksWithSummary);
	} catch (err) {
		console.error("[task-routes] list tasks failed:", err);
		return c.json({ error: "Failed to list tasks" }, 500);
	}
});

taskRoutes.get("/projects/:id/tasks/:taskId", async (c) => {
	try {
		const task = await getTask(c.req.param("taskId"));
		if (!task) return c.json({ error: "Task not found" }, 404);
		return c.json(task);
	} catch (err) {
		console.error("[task-routes] get task failed:", err);
		return c.json({ error: "Failed to get task" }, 500);
	}
});

taskRoutes.patch("/projects/:id/tasks/:taskId", async (c) => {
	try {
		const body = await c.req.json();
		if (body.status === "running" && !body.startedAt) {
			body.startedAt = new Date().toISOString();
		}
		if (body.status === "done" && !body.completedAt) {
			body.completedAt = new Date().toISOString();
		}
		const task = await updateTask(c.req.param("taskId"), body);
		if (!task) return c.json({ error: "Task not found" }, 404);
		return c.json(task);
	} catch (err) {
		console.error("[task-routes] update task failed:", err);
		return c.json({ error: "Failed to update task" }, 500);
	}
});

taskRoutes.post("/projects/:id/tasks/:taskId/retry", async (c) => {
	try {
		const updated = await taskEngine.retryTask(c.req.param("taskId"));
		executionEngine.executeTask(c.req.param("id"), updated).catch(() => {});
		return c.json({ success: true, task: updated });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Retry failed";
		return c.json({ error: msg }, 400);
	}
});

// POST /projects/:id/tasks/:taskId/review — Reviewer onay veya ret verir
taskRoutes.post("/projects/:id/tasks/:taskId/review", async (c) => {
	try {
		const body = await c.req.json<{ approved: boolean; feedback?: string }>();
		const updated = await taskEngine.submitReview(c.req.param("taskId"), body.approved, body.feedback);
		return c.json({ success: true, task: updated });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Review failed";
		return c.json({ error: msg }, 400);
	}
});

// POST /projects/:id/tasks/:taskId/restart-revision
taskRoutes.post("/projects/:id/tasks/:taskId/restart-revision", async (c) => {
	try {
		const updated = await taskEngine.restartRevision(c.req.param("taskId"));
		return c.json({ success: true, task: updated });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Restart revision failed";
		return c.json({ error: msg }, 400);
	}
});

// POST /projects/:id/tasks/:taskId/approve — Human-in-the-Loop onay ver
taskRoutes.post("/projects/:id/tasks/:taskId/approve", async (c) => {
	try {
		const projectId = c.req.param("id");
		const taskId = c.req.param("taskId");
		const updated = await taskEngine.approveTask(taskId);
		executionEngine.executeTask(projectId, updated).catch(() => {});
		return c.json({ success: true, task: updated });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Onay işlemi başarısız";
		return c.json({ error: msg }, 400);
	}
});

// POST /projects/:id/tasks/:taskId/reject — Human-in-the-Loop reddet
taskRoutes.post("/projects/:id/tasks/:taskId/reject", async (c) => {
	try {
		const taskId = c.req.param("taskId");
		const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
		const updated = await taskEngine.rejectTask(taskId, body.reason);
		return c.json({ success: true, task: updated });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Red işlemi başarısız";
		return c.json({ error: msg }, 400);
	}
});

// GET /projects/:id/approvals — Bekleyen onayları listele
taskRoutes.get("/projects/:id/approvals", async (c) => {
	try {
		const pendingTasks = await listPendingApprovals(c.req.param("id"));
		return c.json(pendingTasks);
	} catch (err) {
		console.error("[task-routes] list approvals failed:", err);
		return c.json({ error: "Failed to list approvals" }, 500);
	}
});

// GET /projects/:id/tasks/:taskId/logs
taskRoutes.get("/projects/:id/tasks/:taskId/logs", async (c) => {
	const task = await getTask(c.req.param("taskId"));
	if (!task) return c.json({ error: "Task not found" }, 404);

	const storedLogs: string[] = task.output?.logs ?? [];

	const isRunning = task.status !== "done" && task.status !== "failed";
	let liveLogs: string[] = [];

	if (isRunning && task.assignedAgent) {
		const runtime = containerManager.getRuntime(c.req.param("id"), task.assignedAgent);
		if (runtime) {
			liveLogs = runtime.terminalBuffer.slice(storedLogs.length);
		}
	}

	return c.json({
		taskId: task.id,
		status: task.status,
		logs: storedLogs,
		liveLogs,
		total: storedLogs.length + liveLogs.length,
	});
});

// GET /projects/:id/tasks/:taskId/output
taskRoutes.get("/projects/:id/tasks/:taskId/output", async (c) => {
	try {
		const task = await getTask(c.req.param("taskId"));
		if (!task) return c.json({ error: "Task not found" }, 404);

		if (!task.output) {
			return c.json({
				taskId: task.id,
				status: task.status,
				output: null,
			});
		}

		return c.json({
			taskId: task.id,
			status: task.status,
			output: task.output,
		});
	} catch (err) {
		console.error("[task-routes] get task output failed:", err);
		return c.json({ error: "Failed to get task output" }, 500);
	}
});

// GET /projects/:id/tasks/:taskId/diffs — File diffs for DiffViewer
taskRoutes.get("/projects/:id/tasks/:taskId/diffs", async (c) => {
	try {
		const taskId = c.req.param("taskId");
		const task = await getTask(taskId);
		if (!task) return c.json({ error: "Task not found" }, 404);

		const diffs = await getTaskDiffs(taskId);
		const summary = await getTaskDiffSummary(taskId);

		return c.json({ taskId, summary, diffs });
	} catch (err) {
		console.error("[task-routes] get task diffs failed:", err);
		return c.json({ error: "Failed to get task diffs" }, 500);
	}
});

// GET /projects/:id/tasks/:taskId/stream — SSE log stream
taskRoutes.get("/projects/:id/tasks/:taskId/stream", async (c) => {
	const projectId = c.req.param("id");
	const taskId = c.req.param("taskId");

	const task = await getTask(taskId);
	if (!task) return c.json({ error: "Task not found" }, 404);

	return streamSSE(c, async (stream) => {
		if (task.status === "done" || task.status === "failed") {
			for (const line of task.output?.logs ?? []) {
				await stream.writeSSE({
					event: "log",
					data: JSON.stringify({ text: line }),
				});
			}
			await stream.writeSSE({
				event: "done",
				data: JSON.stringify({ status: task.status }),
			});
			return;
		}

		for (const line of task.output?.logs ?? []) {
			await stream.writeSSE({
				event: "log",
				data: JSON.stringify({ text: line }),
			});
		}

		let closed = false;

		const unsubscribe = eventBus.onProject(projectId, async (event) => {
			if (closed) return;

			try {
				if (event.type === "agent:output" && event.agentId === task.assignedAgent) {
					const text = typeof event.payload.output === "string" ? event.payload.output : "";
					await stream.writeSSE({
						event: "log",
						data: JSON.stringify({ text }),
					});
					if (text) await appendTaskLogs(taskId, [text]);
				}

				if ((event.type === "task:completed" || event.type === "task:failed") && event.taskId === taskId) {
					await stream.writeSSE({
						event: "done",
						data: JSON.stringify({
							status: event.type === "task:completed" ? "done" : "failed",
						}),
					});
					closed = true;
					unsubscribe();
				}
			} catch {
				closed = true;
				unsubscribe();
			}
		});

		stream.onAbort(() => {
			closed = true;
			unsubscribe();
		});
	});
});
