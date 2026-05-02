// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Control Service
// Owns pause/resume/retry control paths.
// ---------------------------------------------------------------------------

import { mutatePipelineState, updateTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import { executionEngine } from "../execution-engine.js";
import { createLogger } from "../logger.js";
import type { PipelineStage, PipelineStatus } from "../types.js";
import { PipelineStateManager, runToState } from "./pipeline-state-service.js";

const log = createLogger("pipeline-control-service");

function now(): string {
	return new Date().toISOString();
}

export class PipelineControlService {
	constructor(private readonly stateManager: PipelineStateManager) {}

	async pausePipeline(projectId: string): Promise<void> {
		const run = await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "running") {
				throw new Error(`Pipeline duraklatılamaz — mevcut durum: ${dbRun.status}`);
			}
			return { status: "paused" as PipelineStatus };
		});
		this.stateManager.invalidateCache(projectId);
		this.stateManager.setCacheEntry(projectId, runToState(run));

		const cancelledCount = await executionEngine.cancelRunningTasks(projectId);
		log.info(`[pipeline-engine] Pipeline paused: ${cancelledCount} task(s) cancelled for ${projectId}`);

		eventBus.emit({
			projectId,
			type: "pipeline:paused",
			payload: { pausedAt: now(), currentStage: run.currentStage, cancelledTasks: cancelledCount },
		});
	}

	async resumePipeline(projectId: string, advanceStage: (projectId: string) => Promise<unknown>): Promise<void> {
		const run = await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "paused") {
				throw new Error(`Pipeline devam ettirilemiyor — mevcut durum: ${dbRun.status}`);
			}
			return { status: "running" as PipelineStatus };
		});
		this.stateManager.invalidateCache(projectId);
		this.stateManager.setCacheEntry(projectId, runToState(run));

		eventBus.emit({
			projectId,
			type: "pipeline:resumed",
			payload: { resumedAt: now(), currentStage: run.currentStage },
		});

		executionEngine.startProjectExecution(projectId).catch((err) => {
			log.error(`[pipeline-engine] Resume dispatch failed:` + " " + String(err));
		});

		await advanceStage(projectId);
	}

	async retryFailedPipeline(projectId: string, advanceStage: (projectId: string) => Promise<unknown>): Promise<void> {
		const run = await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "failed") {
				throw new Error(`Pipeline retry edilemiyor — mevcut durum: ${dbRun.status}`);
			}
			const stages = JSON.parse(dbRun.stagesJson) as PipelineStage[];
			const currentStage = stages[dbRun.currentStage];
			if (currentStage) currentStage.status = "running";
			return {
				status: "running" as PipelineStatus,
				stagesJson: JSON.stringify(stages),
				completedAt: undefined,
			};
		});
		this.stateManager.invalidateCache(projectId);
		const state = runToState(run);
		this.stateManager.setCacheEntry(projectId, state);

		const taskIds = await this.stateManager.resolveStageTaskIds(projectId, state.currentStage, state);
		for (const taskId of taskIds) {
			const status = await this.stateManager.getTaskStatus(taskId);
			if (status === "failed") {
				await updateTask(taskId, { status: "queued", error: undefined, retryCount: 0 });
			}
		}

		eventBus.emit({
			projectId,
			type: "pipeline:resumed",
			payload: { resumedAt: now(), currentStage: state.currentStage, reason: "retry_failed" },
		});

		await advanceStage(projectId);
	}
}
