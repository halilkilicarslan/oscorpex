// ---------------------------------------------------------------------------
// Oscorpex — Special Task Runner
// Runs non-AI task types handled by the execution engine.
// ---------------------------------------------------------------------------

import { startApp } from "../app-runner.js";
import { getLatestPlan, listPhases, updateProject } from "../db.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { taskEngine } from "../task-engine.js";
import { runIntegrationTest } from "../task-runners.js";
import type { Project, Task, TaskOutput } from "../types.js";

const log = createLogger("special-task-runner");

export async function executeSpecialTask(
	projectId: string,
	project: Project,
	task: Task,
	dispatchReadyTasks: (projectId: string, phaseId: string) => Promise<void>,
): Promise<void> {
	await taskEngine().assignTask(task.id, task.taskType ?? "system");
	await taskEngine().startTask(task.id);

	const termLog = (msg: string) => {
		eventBus.emitTransient({
			projectId,
			type: "agent:output",
			taskId: task.id,
			payload: { output: msg },
		});
	};

	try {
		let output: TaskOutput;

		if (task.taskType === "integration-test") {
			termLog("[task-executor] Running integration tests...");
			output = await runIntegrationTest(projectId, project.repoPath, termLog);
		} else {
			termLog("[task-executor] Starting application...");
			const result = await startApp(projectId, project.repoPath, termLog);
			output = {
				filesCreated: [],
				filesModified: [],
				logs: [`Started ${result.services.length} service(s). Preview: ${result.previewUrl}`],
			};
		}

		await taskEngine().completeTask(task.id, output, { executionRepoPath: project.repoPath });
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		log.error(`[task-executor] Special task failed: "${task.title}" — ${errorMsg}`);
		eventBus.emit({
			projectId,
			type: "agent:error",
			taskId: task.id,
			payload: { error: errorMsg },
		});
		await taskEngine().failTask(task.id, errorMsg);
		await updateProject(projectId, { status: "failed" });
	}

	await dispatchReadyTasks(projectId, task.phaseId);
	const plan = await getLatestPlan(projectId);
	if (plan) {
		const phases = await listPhases(plan.id);
		for (const phase of phases) {
			if (phase.status === "running" && phase.id !== task.phaseId) {
				await dispatchReadyTasks(projectId, phase.id);
			}
		}
	}
}
