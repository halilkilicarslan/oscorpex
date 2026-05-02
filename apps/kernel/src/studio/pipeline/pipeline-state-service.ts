// ---------------------------------------------------------------------------
// Pipeline State Service
// Read-through cache + state query helpers for PipelineEngine:
//   - _cache             — in-memory read-through cache (projectId → PipelineState)
//   - invalidateCache    — evicts a project entry from the cache
//   - loadState          — loads from DB and refreshes cache
//   - getState           — cache-first read, falls back to loadState
//   - persistState       — writes to DB and updates cache (non-locked path)
//   - getPipelineState   — public accessor (cache-first)
//   - getEnrichedPipelineStatus — comprehensive status with task progress
//   - resolveStageTaskIds — resolves task IDs for a given stage index
//   - getTaskStatus       — returns status of a single task
//   - refreshPipeline     — rebuilds DAG waves without resetting completed stages
// ---------------------------------------------------------------------------

import { buildDAGWaves } from "@oscorpex/task-graph";
import {
	getLatestPlan,
	getPipelineRun,
	getTask,
	listAgentDependencies,
	listPhases,
	listProjectAgents,
	listTasks,
	mutatePipelineState,
	queryOne,
	updatePipelineRun,
} from "../db.js";
import { createLogger } from "../logger.js";
import { taskEngine } from "../task-engine.js";
import type { PipelineStage, PipelineState, PipelineStatus } from "../types.js";

const log = createLogger("pipeline-state-service");

// ---------------------------------------------------------------------------
// Read-through cache (projectId → PipelineState)
// This is a PERFORMANCE CACHE ONLY. DB is the single source of truth.
// Cache is invalidated after every mutation via mutatePipelineState().
// ---------------------------------------------------------------------------
const _cache = new Map<string, PipelineState>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert PipelineRun (DB row) to PipelineState (runtime model) */
export function runToState(run: {
	projectId: string;
	stagesJson: string;
	currentStage: number;
	status: PipelineStatus;
	startedAt?: string;
	completedAt?: string;
}): PipelineState {
	return {
		projectId: run.projectId,
		stages: JSON.parse(run.stagesJson) as PipelineStage[],
		currentStage: run.currentStage,
		status: run.status,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
	};
}

export class PipelineStateManager {
	/** Invalidate cache for a project — forces next read from DB */
	invalidateCache(projectId: string): void {
		_cache.delete(projectId);
	}

	/** Set cache entry directly (used after locked mutations in PipelineEngine) */
	setCacheEntry(projectId: string, state: PipelineState): void {
		_cache.set(projectId, state);
	}

	/** Load state from DB (single source of truth). Updates cache. */
	async loadState(projectId: string): Promise<PipelineState | null> {
		const run = await getPipelineRun(projectId);
		if (!run) return null;
		const state = runToState(run);
		_cache.set(projectId, state);
		return state;
	}

	/** Get state: cache first, then DB. Never trust cache for mutations. */
	async getState(projectId: string): Promise<PipelineState | null> {
		const cached = _cache.get(projectId);
		if (cached) return cached;
		return this.loadState(projectId);
	}

	/** Persist state to DB and update cache. Used for simple non-locked writes. */
	async persistState(state: PipelineState): Promise<void> {
		await updatePipelineRun(state.projectId, {
			currentStage: state.currentStage,
			status: state.status,
			stagesJson: JSON.stringify(state.stages),
			startedAt: state.startedAt,
			completedAt: state.completedAt,
		});
		_cache.set(state.projectId, state);
	}

	/** Public accessor: returns cached or DB-loaded state */
	async getPipelineState(projectId: string): Promise<PipelineState | null> {
		return this.getState(projectId);
	}

	async getEnrichedPipelineStatus(
		projectId: string,
		advanceStageFn: (projectId: string) => Promise<PipelineState>,
	): Promise<{
		pipelineState: PipelineState | null;
		taskProgress: Awaited<ReturnType<typeof taskEngine.getProgress>>;
		derivedStatus: PipelineStatus;
		warning?: string;
	}> {
		let pipelineState = await this.getPipelineState(projectId);

		if (pipelineState?.status === "running") {
			try {
				await advanceStageFn(projectId);
				pipelineState = await this.getPipelineState(projectId);
			} catch {
				// status sorgusu sırasında hata olursa sessizce devam et
			}
		}

		const taskProgress = await taskEngine.getProgress(projectId);
		const overall = taskProgress.overall;

		let derivedStatus: PipelineStatus = pipelineState?.status ?? "idle";

		if (derivedStatus === "idle" || derivedStatus === "failed") {
			if (overall.running > 0) {
				derivedStatus = "running";
			} else if (overall.done > 0 && overall.running === 0 && overall.queued === 0 && overall.failed === 0) {
				derivedStatus = "completed";
			} else if (overall.failed > 0 && overall.running === 0 && overall.queued === 0) {
				derivedStatus = "failed";
			}
		}

		let warning: string | undefined;
		if (pipelineState?.status === "failed" && overall.running > 0) {
			warning = 'Pipeline kaydı "failed" gösterse de task\'lar hâlâ çalışıyor. Durum task verilerinden türetildi.';
		}

		return { pipelineState, taskProgress, derivedStatus, warning };
	}

	async resolveStageTaskIds(projectId: string, stageIndex: number, state: PipelineState): Promise<string[]> {
		const stage = state.stages[stageIndex];
		if (!stage) return [];

		// IMPORTANT:
		// In DAG mode, a stage can include tasks spanning multiple phaseIds.
		// If we prioritize stage.phaseId here, we may only inspect a subset and
		// complete the stage prematurely while queued tasks still exist.
		// Therefore, prefer explicit stage task IDs whenever available.
		if (stage.tasks.length > 0) {
			return stage.tasks.map((t) => t.id);
		}

		if (stage.phaseId) {
			const latestTasks = await listTasks(stage.phaseId);
			stage.tasks = latestTasks;
			return latestTasks.map((t) => t.id);
		}

		const plan = await getLatestPlan(projectId);
		if (!plan) return [];

		const phases = (await listPhases(plan.id)).sort((a, b) => a.order - b.order);
		const matchedPhase = phases[stageIndex];
		if (!matchedPhase) return [];

		stage.tasks = matchedPhase.tasks ?? [];
		return stage.tasks.map((t) => t.id);
	}

	async getTaskStatus(taskId: string): Promise<string> {
		const task = await getTask(taskId);
		return task?.status ?? "queued";
	}

	// v3.3: Refresh pipeline — rebuild DAG waves without resetting completed stages
	async refreshPipeline(projectId: string): Promise<void> {
		const agents = await listProjectAgents(projectId);
		const deps = await listAgentDependencies(projectId);
		const newWaves = buildDAGWaves(agents, deps);

		// DB-first: lock + validate + mutate atomically
		await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "running") {
				throw new Error(`Pipeline refresh edilemiyor — mevcut durum: ${dbRun.status}`);
			}

			const stages = JSON.parse(dbRun.stagesJson) as PipelineStage[];
			const completedStageCount = stages.filter((s) => s.status === "completed").length;

			for (let i = completedStageCount; i < newWaves.length; i++) {
				const waveAgentIds = newWaves[i];
				const waveAgents = agents.filter((a) => waveAgentIds.includes(a.id));

				if (i < stages.length) {
					stages[i].agents = waveAgents;
				} else {
					stages.push({
						order: i,
						agents: waveAgents,
						tasks: [],
						status: "pending",
					});
				}
			}

			log.info(
				`[pipeline-state-service] Pipeline refresh — ${newWaves.length} stage (${completedStageCount} completed korundu)`,
			);
			return { stagesJson: JSON.stringify(stages) };
		});
		this.invalidateCache(projectId);
	}

	/**
	 * Acquires the advisory SELECT FOR UPDATE SKIP LOCKED row lock used by
	 * advanceStage to prevent concurrent double-advances.
	 * Returns null if the lock could not be acquired (caller should bail out).
	 */
	async acquireAdvanceLock(projectId: string): Promise<{ id: string } | null> {
		return (
			(await queryOne<{ id: string }>(
				`SELECT id FROM pipeline_runs WHERE project_id = $1 AND status = 'running' FOR UPDATE SKIP LOCKED`,
				[projectId],
			)) ?? null
		);
	}

	/**
	 * Checks for a pending replan event that blocks stage advancement.
	 * Returns the replan row if one exists, otherwise null.
	 */
	async getPendingReplan(projectId: string): Promise<{ id: string } | null> {
		return (
			(await queryOne<{ id: string }>(
				`SELECT id FROM replan_events WHERE project_id = $1 AND status = 'pending' LIMIT 1`,
				[projectId],
			)) ?? null
		);
	}
}
