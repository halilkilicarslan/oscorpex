// ---------------------------------------------------------------------------
// Oscorpex — Stage Advance Service
// Pure decision helper + orchestrator for pipeline stage completion/failure checks.
// ---------------------------------------------------------------------------

import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import type { PipelineState } from "../types.js";
import { canAdvance } from "./replan-gate.js";
import type { PipelineStateManager } from "./pipeline-state-service.js";

const log = createLogger("stage-advance-service");

export type StageAdvanceDecision = "failed" | "completed" | "waiting";

export function decideStageAdvance(statuses: string[]): StageAdvanceDecision {
	if (statuses.some((status) => status === "failed")) return "failed";
	if (statuses.length > 0 && statuses.every((status) => status === "done")) return "completed";
	return "waiting";
}

// ---------------------------------------------------------------------------
// StageAdvanceOrchestrator
// Encapsulates all orchestration logic previously inlined in
// PipelineEngine.advanceStage(). Requires injected callbacks for the two
// side-effecting operations that remain the engine's responsibility:
//   - completeStage(projectId, stageIndex)
//   - markFailed(projectId, reason)
// ---------------------------------------------------------------------------

export type AdvanceCallbacks = {
	completeStage: (projectId: string, stageIndex: number) => Promise<void>;
	markFailed: (projectId: string, reason: string) => Promise<void>;
};

export class StageAdvanceOrchestrator {
	constructor(
		private readonly stateManager: PipelineStateManager,
		private readonly callbacks: AdvanceCallbacks,
	) {}

	async advance(projectId: string): Promise<PipelineState> {
		// Always read from DB for correctness (cache is just performance)
		const state = await this.stateManager.loadState(projectId);
		if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

		if (state.status === "paused" || state.status === "completed" || state.status === "failed") {
			return state;
		}

		// Acquire row-level lock to prevent concurrent advanceStage from double-advancing
		const lockedRun = await this.stateManager.acquireAdvanceLock(projectId);
		if (!lockedRun) {
			log.info(`[stage-advance-service] advanceStage skipped — could not acquire lock (project=${projectId})`);
			return state;
		}

		// Block advance if there's a pending replan awaiting approval
		const replanGate = await canAdvance(projectId);
		if (!replanGate.allowed) {
			log.info(
				`[stage-advance-service] advanceStage blocked — pending replan ${replanGate.replanEventId} awaiting approval`,
			);
			eventBus.emit({
				projectId,
				type: "plan:replanned",
				payload: { awaiting_approval: true, replanEventId: replanGate.replanEventId },
			});
			return state;
		}

		const currentIndex = state.currentStage;
		const currentStage = state.stages[currentIndex];
		if (!currentStage) return state;

		const freshTaskIds = await this.stateManager.resolveStageTaskIds(projectId, currentIndex, state);

		if (freshTaskIds.length === 0) {
			await this.callbacks.completeStage(projectId, currentIndex);
			return (await this.stateManager.getState(projectId))!;
		}

		const statuses = await Promise.all(freshTaskIds.map((id) => this.stateManager.getTaskStatus(id)));

		const decision = decideStageAdvance(statuses);
		if (decision === "failed") {
			await this.callbacks.markFailed(
				projectId,
				`Aşama ${currentIndex} (order=${currentStage.order}) görev hatası`,
			);
		} else if (decision === "completed") {
			await this.callbacks.completeStage(projectId, currentIndex);
		}

		return (await this.stateManager.getState(projectId))!;
	}
}
