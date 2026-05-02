// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Completion Service
// Owns terminal pipeline side effects and failure marking.
// ---------------------------------------------------------------------------

import { mutatePipelineState } from "../db.js";
import { generateReadme } from "../docs-generator.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { transitionProject } from "../lifecycle-manager.js";
import type { PipelineStage, PipelineStatus } from "../types.js";
import { PipelineStateManager } from "./pipeline-state-service.js";
import { PipelineBranchManager } from "./vcs-phase-hooks.js";

const log = createLogger("pipeline-completion-service");

function now(): string {
	return new Date().toISOString();
}

export class PipelineCompletionService {
	constructor(
		private readonly stateManager: PipelineStateManager,
		private readonly branchManager: PipelineBranchManager,
	) {}

	async markCompleted(projectId: string): Promise<void> {
		const completedAt = now();
		await mutatePipelineState(projectId, async () => ({
			status: "completed" as PipelineStatus,
			completedAt,
		}));
		this.stateManager.invalidateCache(projectId);
		const state = await this.stateManager.loadState(projectId);
		if (!state) return;

		eventBus.emit({
			projectId,
			type: "pipeline:completed",
			payload: { completedAt: state.completedAt },
		});

		generateReadme(projectId, (msg) => {
			log.info(`[pipeline-engine] ${msg}`);
		}).catch((err) => {
			log.error("[pipeline-engine] README oluşturma hatası:" + " " + String(err));
		});

		this.branchManager.tryCreatePR(projectId).catch((err) => {
			log.warn("[pipeline-engine] Auto PR oluşturulamadı:" + " " + String(err));
		});

		transitionProject(projectId, "completed").catch((err) => {
			log.warn("[pipeline-engine] lifecycle transition → completed failed:" + " " + String(err));
			eventBus.emit({
				projectId,
				type: "lifecycle:transition",
				payload: { to: "completed", trigger: "pipeline_completed", skipped: true, error: String(err) },
			});
		});
	}

	async markFailed(projectId: string, reason: string): Promise<void> {
		const completedAt = now();
		await mutatePipelineState(projectId, async (dbRun) => {
			const stages = JSON.parse(dbRun.stagesJson) as PipelineStage[];
			const currentStage = stages[dbRun.currentStage];
			if (currentStage) currentStage.status = "failed";
			return {
				status: "failed" as PipelineStatus,
				stagesJson: JSON.stringify(stages),
				completedAt,
			};
		});
		this.stateManager.invalidateCache(projectId);
		const state = await this.stateManager.loadState(projectId);
		if (!state) return;

		eventBus.emit({
			projectId,
			type: "pipeline:failed",
			payload: { reason, failedAt: state.completedAt },
		});
	}
}
