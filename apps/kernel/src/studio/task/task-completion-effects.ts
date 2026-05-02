// ---------------------------------------------------------------------------
// Oscorpex — Task Completion Effects
// Non-blocking side effects that run after a task transitions to 'done'.
// All operations are fire-and-forget (.catch() logged, never thrown).
// ---------------------------------------------------------------------------

import { getProject, listProjectAgents, listTokenUsageForTask, upsertAgentDailyStat } from "../db.js";
import { applyPostCompletionHooks } from "../edge-hooks.js";
import { createLogger } from "../logger.js";
import { recordAgentStep } from "../memory-bridge.js";
import { updateWorkingMemory } from "../memory-manager.js";
import { indexTaskOutput } from "../context-sandbox.js";
import { captureTaskDiffs } from "../diff-capture.js";
import type { Task, TaskOutput } from "../types.js";

const log = createLogger("task-completion-effects");

/**
 * Runs all non-blocking post-completion side effects for a task that just
 * transitioned to 'done'.  All work is fire-and-forget — errors are logged
 * but never propagated to the caller.
 *
 * Effects (in order):
 *   1. applyPostCompletionHooks — notification / mentoring / handoff doc check
 *   2. updateWorkingMemory     — refresh snapshot for downstream context packets
 *   3. indexTaskOutput         — FTS cross-agent context index
 *   4. captureTaskDiffs        — DiffViewer file diffs
 *   5. upsertAgentDailyStat    — heat map / timeline agent stats
 *   6. recordAgentStep         — memory tables for Memory page
 */
export function fireTaskCompletionEffects(
	projectId: string,
	taskId: string,
	task: Task,
	updatedTask: Task,
	output: TaskOutput,
): void {
	// v3.1: Execution-time edge hooks
	applyPostCompletionHooks(projectId, updatedTask, output).catch((err) => {
		log.warn("[task-completion-effects] applyPostCompletionHooks failed:" + " " + String(err));
	});

	// v3.4: Refresh working memory snapshot
	updateWorkingMemory(projectId).catch((err) => {
		log.warn("[task-completion-effects] updateWorkingMemory failed:" + " " + String(err));
	});

	// v4.0: Index task output for FTS cross-agent context
	indexTaskOutput(projectId, taskId, task.title, output).catch((err) => {
		log.warn("[task-completion-effects] indexTaskOutput failed:" + " " + String(err));
	});

	// v4.1: Capture file diffs for DiffViewer + agent daily stat
	getProject(projectId)
		.then((proj) => {
			if (proj?.repoPath) {
				captureTaskDiffs(taskId, proj.repoPath, output).catch((err) => {
					log.warn("[task-completion-effects] captureTaskDiffs failed:" + " " + String(err));
				});
			}

			// v4.1: Update agent daily stats (with token/cost from token_usage)
			const today = new Date().toISOString().slice(0, 10);
			const agentId = task.assignedAgentId || task.assignedAgent;
			if (!agentId) {
				log.warn("[task-completion-effects] No agentId for task " + taskId + " — skipping daily stat");
			} else {
				const taskTimeMs = task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : 0;
				listTokenUsageForTask(taskId)
					.then((usageRows) => {
						let tokensUsed = 0;
						let costUsd = 0;
						for (const r of usageRows) {
							tokensUsed += Number((r as any).total_tokens ?? 0);
							costUsd += Number((r as any).cost_usd ?? 0);
						}
						return upsertAgentDailyStat(projectId, agentId, today, {
							tasksCompleted: 1,
							avgTaskTimeMs: taskTimeMs,
							tokensUsed,
							costUsd,
						});
					})
					.catch((err) => {
						log.warn("[task-completion-effects] upsertAgentDailyStat failed:" + " " + String(err));
					});
			}

			// v4.2: Record to memory tables for Memory page
			if (proj) {
				listProjectAgents(projectId)
					.then((agents) => {
						const agent = agents.find((a) => a.id === task.assignedAgentId);
						recordAgentStep(
							projectId,
							proj.name,
							task.assignedAgentId || task.assignedAgent,
							agent?.name || task.assignedAgent,
							task.title,
							output.logs?.[0] || null,
						).catch((err) =>
							log.warn("[task-completion-effects] Non-blocking operation failed:", err?.message ?? err),
						);
					})
					.catch((err) => {
						log.warn("[task-completion-effects] listProjectAgents failed:" + " " + String(err));
					});
			}
		})
		.catch((err) => {
			log.warn("[task-completion-effects] getProject for completion effects failed:" + " " + String(err));
		});
}
