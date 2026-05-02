// ---------------------------------------------------------------------------
// Oscorpex — Task Executor
// Handles the inner execution logic for individual tasks:
// prompt building, CLI dispatch, output gates, retry, provider fallback.
// ---------------------------------------------------------------------------

import { type ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import { agentRuntime } from "../agent-runtime.js";
import {
	acknowledgeMessages,
	completeSession,
	failSession,
	initSession,
	loadProtocolContext,
} from "../agent-runtime/index.js";
import { resolveAllowedTools } from "../capability-resolver.js";
import { buildPolicyPromptSection, getDefaultPolicy } from "../command-policy.js";
import { buildRAGContext, formatRAGContext } from "../context-builder.js";
import { compactCrossAgentContext } from "../context-sandbox.js";
import { buildResumeSnapshot, formatResumeSnapshot } from "../context-session.js";
import {
	claimTask,
	getAgentConfig,
	getProject,
	getTask,
	releaseTaskClaim,
	updateTask,
} from "../db.js";
import { eventBus } from "../event-bus.js";
import { formatGoalPrompt, getGoalForTask } from "../goal-engine.js";
import { createLogger } from "../logger.js";
import { resolveModel } from "../model-router.js";
import { persistAgentLog } from "../agent-log-store.js";
import { markExecutionStarted } from "../preflight-warmup.js";
import { buildTaskPrompt } from "../prompt-builder.js";
import { syncDeclaredDependencies } from "../repo-dependency-sync.js";
import { MAX_AUTO_RETRIES, evaluateRetry } from "../retry-policy.js";
import { resolveAgent } from "../review-dispatcher.js";
import { SandboxViolationError } from "../sandbox-manager.js";
import { taskEngine } from "../task-engine.js";
import { TIMEOUT_WARNING_THRESHOLD, resolveTaskTimeoutMs } from "../timeout-policy.js";
import type { AgentCliTool, Task } from "../types.js";
import { runOutputAndTestGates, runGoalGate } from "./execution-gates-runner.js";
import { runProviderTask } from "./provider-task-runner.js";
import { executeTaskReview } from "./review-task-runner.js";
import {
	closeSandboxExecution,
	enforceSandboxHardPreflight,
	enforceSandboxPostExecution,
	enforceSandboxPreExecution,
	setupSandboxExecution,
	type SandboxExecutionContext,
} from "./sandbox-execution-guard.js";
import { executeSpecialTask } from "./special-task-runner.js";
import { startTaskForExecution } from "./task-start-service.js";
import { TaskTimeoutError } from "./task-timeout.js";
import { computeQueueWaitMs } from "./queue-wait.js";
import {
	buildTaskOutput,
	recordOutputReceived,
	runTaskCompletionEffects,
} from "./task-output-handler.js";

export { TaskTimeoutError } from "./task-timeout.js";
export { computeQueueWaitMs } from "./queue-wait.js";

const log = createLogger("task-executor");

// ---------------------------------------------------------------------------
// Rate-limit detection
// ---------------------------------------------------------------------------

export const RATE_LIMIT_PATTERNS = [
	/you['']ve hit your limit/i,
	/rate limit/i,
	/resets?\s+\d{1,2}[:.]\d{2}\s*(am|pm)/i,
	/too many requests/i,
	/429/,
	/quota exceeded/i,
];

export function isRateLimitError(message: string): boolean {
	return RATE_LIMIT_PATTERNS.some((rx) => rx.test(message));
}

// ---------------------------------------------------------------------------
// TaskExecutor
// ---------------------------------------------------------------------------

export class TaskExecutor {
	constructor(
		private readonly _activeControllers: Map<string, AbortController>,
		readonly telemetry: ProviderTelemetryCollector,
	) {}

	/**
	 * Transition a task from "queued" or "assigned" to "running" and return the
	 * updated task record. This is the single point where queue-wait timestamps
	 * are produced.
	 */
	async startTaskForExecution(
		task: Task,
		agentId: string,
	): Promise<Task | undefined> {
		return startTaskForExecution(task, agentId);
	}

	/**
	 * Non-AI task types: integration-test and run-app
	 */
	async executeSpecialTask(
		projectId: string,
		project: Parameters<typeof executeSpecialTask>[1],
		task: Task,
		dispatchReadyTasks: (projectId: string, phaseId: string) => Promise<void>,
	): Promise<void> {
		return executeSpecialTask(projectId, project, task, dispatchReadyTasks);
	}

	/**
	 * Core inner execution loop: builds prompt, runs CLI, handles output, gates, retries, provider fallback.
	 * Called by ExecutionEngine.executeTask after claim + semaphore acquire.
	 */
	async executeTaskInner(
		projectId: string,
		task: Task,
		executeTask: (projectId: string, task: Task) => Promise<void>,
		dispatchReadyTasks: (projectId: string, phaseId: string) => Promise<void>,
	): Promise<void> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project ${projectId} not found`);

		// Register AbortController for this task so it can be cancelled externally
		const taskController = new AbortController();
		const controllerKey = `${projectId}:${task.id}`;
		this._activeControllers.set(controllerKey, taskController);

		// ═══════════════════════════════════════════════════════════════════════
		// TASK 12: Cold-start tracking
		const { isColdStart } = markExecutionStarted();

		// Provider Telemetry Lifecycle (EPIC 3 — Observability)
		// Managed entirely by ProviderExecutionService — task-executor only tracks
		// task-level abort (pipeline pause) and outer error handling.
		let timeoutMs = 0;

		// --- Non-AI task types: integration-test & run-app ---
		if (task.taskType === "integration-test" || task.taskType === "run-app") {
			await this.executeSpecialTask(projectId, project, task, dispatchReadyTasks);
			return;
		}

		// --- Review task: "Code Review: X" — run review CLI and submit result ---
		if (task.title.startsWith("Code Review: ")) {
			await executeTaskReview(projectId, project, task);
			return;
		}

		// Resolve agent config — prefer the task's assignedAgent value, which may
		// be an agent ID or a role name. Try both.
		const agent = await resolveAgent(projectId, task.assignedAgent);
		if (!agent) {
			await taskEngine.assignTask(task.id, task.assignedAgent);
			await taskEngine.startTask(task.id);
			await taskEngine.failTask(
				task.id,
				`No agent found for assignment "${task.assignedAgent}" in project ${projectId}`,
			);
			await dispatchReadyTasks(projectId, task.phaseId);
			return;
		}

		// Assign + start — task is already claimed via SELECT FOR UPDATE SKIP LOCKED,
		// so no concurrent dispatch race is possible. Transition status based on current state.
		let lastFailureClassification: import("@oscorpex/provider-sdk").ProviderErrorClassification | undefined;
		const startedTask = await this.startTaskForExecution(task, agent.id);
		const queueWaitMs = startedTask ? computeQueueWaitMs(startedTask) : 0;

		// --- Agent Runtime: init session + behavioral memory + protocol ---
		let sessionId: string | undefined;
		let promptSuffix = "";
		try {
			const sessionCtx = await initSession(projectId, agent.id, agent.role, task);
			sessionId = sessionCtx.session.id;
			promptSuffix += sessionCtx.behavioralPrompt;

			// Strategy prompt addendum
			if (sessionCtx.strategySelection.strategy.promptAddendum) {
				promptSuffix += `\n\n## EXECUTION STRATEGY: ${sessionCtx.strategySelection.strategy.name}\n${sessionCtx.strategySelection.strategy.promptAddendum}\n`;
			}

			// Load inter-agent protocol messages
			const protocolCtx = await loadProtocolContext(projectId, agent.id);
			if (protocolCtx.hasBlockers) {
				await updateTask(task.id, {
					status: "blocked",
				});
				eventBus.emit({
					projectId,
					type: "agent:requested_help",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						title: task.title,
						taskTitle: task.title,
						agentName: agent.name,
						reason: "Execution blocked by unresolved inter-agent protocol messages",
						protocolBlocked: true,
					},
				});
				return;
			}
			if (protocolCtx.prompt) {
				promptSuffix += protocolCtx.prompt;
				await acknowledgeMessages(protocolCtx.messageIds);
			}
		} catch (err) {
			log.warn("[task-executor] Agent runtime init failed (non-blocking):" + " " + String(err));
		}

		// --- Goal-based execution: inject goal prompt if task has an associated goal ---
		let goalId: string | undefined;
		try {
			const goal = await getGoalForTask(task.id);
			if (goal && goal.status !== "achieved") {
				promptSuffix += "\n" + formatGoalPrompt(goal);
				goalId = goal.id;
			}
		} catch (err) {
			log.warn("[task-executor] Goal lookup failed (non-blocking):" + " " + String(err));
		}

		const prompt = (await buildTaskPrompt(task, project, agent.role)) + promptSuffix;
		const formatTaskLog = (line: string): string => {
			const shortId = task.id.slice(0, 8);
			return `[task:${shortId}] ${line}`;
		};

		// --- Sandbox: resolve policy for this task ---
		let sandboxContext: SandboxExecutionContext = { runtimeRepoPath: project.repoPath };
		if (project.repoPath) {
			sandboxContext = await setupSandboxExecution(projectId, task, agent.id, agent.role, project.repoPath);
		}
		const { sandboxPolicy, sandboxSessionId, isolatedWorkspace } = sandboxContext;
		const runtimeRepoPath = sandboxContext.runtimeRepoPath;

		// Sync node_modules vs package.json before CLI/test runs (partial clones often lack hoisted deps).
		if (runtimeRepoPath) {
			try {
				const syn = syncDeclaredDependencies(runtimeRepoPath);
				if (syn.ranInstall && syn.ok) {
					log.info(
						`[task-executor] Pre-run dependency sync ok (${syn.command}); restored: ${syn.missingBefore.join(", ")}`,
					);
				} else if (syn.ranInstall && !syn.ok) {
					log.warn(
						`[task-executor] Pre-run dependency sync incomplete` +
							(syn.error ? `: ${syn.error}` : "") +
							(syn.missingAfter.length ? ` — still missing: ${syn.missingAfter.join(", ")}` : ""),
					);
				}
			} catch (err) {
				log.warn("[task-executor] Pre-run dependency sync threw:" + " " + String(err));
			}
		}

		try {
			// CLI-only execution — no API fallback
			if (!project.repoPath) {
				throw new Error(`Project ${projectId} has no repoPath configured`);
			}

			const allowedTools = await resolveAllowedTools(projectId, agent.id, agent.role);

			// --- Sandbox pre-execution: enforce tool restrictions ---
			await enforceSandboxPreExecution(sandboxPolicy, allowedTools, sandboxSessionId);

			// v3.4 + M4: Model routing — complexity + prior failures + review rejections + provider-native models.
			const primaryCliTool: AgentCliTool = agent.cliTool ?? "claude-code";
			let routedModel: string = agent.model ?? "sonnet";
			try {
				const resolved = await resolveModel(task, {
					projectId,
					priorFailures: task.retryCount ?? 0,
					reviewRejections: task.revisionCount ?? 0,
					cliTool: primaryCliTool,
				});
				routedModel = resolved.model;
			} catch (err) {
				log.warn("[task-executor] resolveModel failed, using fallback:" + " " + String(err));
			}

			// TASK 7: Provider-aware timeout resolution
			timeoutMs = await resolveTaskTimeoutMs(projectId, task.complexity, agent.taskTimeout, primaryCliTool);

			// Timeout'un %80'ine girildiğinde warning event emit edecek callback
			const onTimeoutWarning = () => {
				const remainingMs = Math.round(timeoutMs * (1 - TIMEOUT_WARNING_THRESHOLD));
				const remainingSec = Math.round(remainingMs / 1000);
				log.warn(`[task-executor] Timeout uyarısı: "${task.title}" — ${remainingSec}sn kaldı`);
				eventBus.emit({
					projectId,
					type: "task:timeout_warning",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						timeoutMs,
						remainingMs,
						taskTitle: task.title,
						message: `Görev timeout'a ${remainingSec} saniye kaldı (toplam ${(timeoutMs / 60_000).toFixed(0)} dk).`,
					},
				});
			};

			// Sandbox pre-execution gate: in hard mode, verify tools before spawning CLI
			enforceSandboxHardPreflight(sandboxPolicy, allowedTools);

			const providerRun = await runProviderTask({
				projectId,
				task,
				agent,
				runtimeRepoPath,
				prompt,
				routedModel,
				primaryCliTool,
				allowedTools,
				timeoutMs,
				signal: taskController.signal,
				queueWaitMs,
				isColdStart,
				sessionId,
				telemetry: this.telemetry,
				executeTask,
				formatTaskLog,
			});
			if (providerRun.deferred) {
				return;
			}

			const cliResult = providerRun.result!;
			lastFailureClassification = undefined;

			const output = await buildTaskOutput(cliResult, runtimeRepoPath, isolatedWorkspace);
			recordOutputReceived(sessionId, output);
			await runTaskCompletionEffects({ projectId, project, task, agent, output, cliResult, agentRuntime, formatTaskLog });
			await enforceSandboxPostExecution(sandboxPolicy, output, sandboxSessionId);
			if (project.repoPath) {
				await runOutputAndTestGates(projectId, task, project.repoPath, output, agent, sessionId);
			}

			await taskEngine.completeTask(task.id, output, { executionRepoPath: runtimeRepoPath });

			closeSandboxExecution(sandboxContext);

			// --- Goal evaluation (delegated to execution-gates.ts) ---
			if (goalId) {
				await runGoalGate(task.id, task.title, output, projectId);
			}

			// --- Agent Runtime: record successful session ---
			if (sessionId) {
				completeSession(sessionId, projectId, agent.id, agent.role, task, {
					costUsd: cliResult?.costUsd,
				}).catch((e) => log.warn("[task-executor] Session complete failed:" + " " + String(e)));
			}

			// Review task dispatch: task-engine creates a review task which
			// will be picked up by dispatchReadyTasks below.
		} catch (err) {
			// If task was aborted by pipeline pause, don't mark as failed — cancelRunningTasks
			// already reset it to queued. Just bail out silently.
			if (taskController.signal.aborted) {
				log.info(`[task-executor] Task "${task.title}" aborted (pipeline paused)`);
				return;
			}

			// --- Sandbox violation: emit specific event for observability ---
			if (err instanceof SandboxViolationError) {
				eventBus.emit({
					projectId,
					type: "verification:failed",
					agentId: agent?.id,
					taskId: task.id,
					payload: {
						source: "sandbox",
						violationType: err.violation.type,
						detail: err.violation.detail,
						enforcementMode: sandboxPolicy?.enforcementMode ?? "hard",
						taskTitle: task.title,
					},
				});
			}

			const isTimeout = err instanceof TaskTimeoutError;
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.error(`[task-executor] Task failed: "${task.title}" — ${errorMsg}`);

			// --- Rate-limit guard: pause pipeline instead of failing the task ---
			if (isRateLimitError(errorMsg)) {
				log.warn(`[task-executor] Rate limit detected — pausing pipeline for ${projectId}`);

				// Reset task back to queued so it can resume later
				await updateTask(task.id, { status: "queued" });

				eventBus.emit({
					projectId,
					type: "pipeline:rate_limited",
					agentId: agent?.id,
					taskId: task.id,
					payload: { message: errorMsg, taskTitle: task.title },
				});

				// Pause the pipeline — stops all running tasks
				try {
					const { pipelineEngine } = await import("../pipeline-engine.js");
					await pipelineEngine.pausePipeline(projectId);
				} catch (pauseErr) {
					log.error({ err: pauseErr }, "Failed to pause pipeline after rate limit");
				}
				return; // Don't fail/retry — just stop
			}

			if (isTimeout) {
				// Emit a dedicated timeout event before the generic error event
				eventBus.emit({
					projectId,
					type: "task:timeout",
					agentId: agent?.id,
					taskId: task.id,
					payload: {
						timeoutMs,
						taskTitle: task.title,
						message: errorMsg,
					},
				});
			}

			eventBus.emit({
				projectId,
				type: "agent:error",
				agentId: agent?.id,
				taskId: task.id,
				payload: { error: errorMsg },
			});

			// Agent output buffer'ını log dosyasına persist et
			if (agent) {
				const failOutputLines = agentRuntime.getAgentOutput(projectId, agent.id);
				if (failOutputLines.length > 0) {
					persistAgentLog(projectId, agent.id, failOutputLines).catch((err) =>
						log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
					);
				}
			}

			await taskEngine.failTask(task.id, errorMsg);

			// --- Agent Runtime: record failed session ---
			if (sessionId && agent) {
				failSession(sessionId, projectId, agent.id, agent.role, task, errorMsg).catch((e) =>
					log.warn("[task-executor] Session fail record failed:" + " " + String(e)),
				);
			}
			if (isolatedWorkspace?.isolated) {
				isolatedWorkspace
					.cleanup()
					.catch((e) => log.warn("[task-executor] Workspace cleanup failed:" + " " + String(e)));
			}

			// --- Self-healing: auto-retry with error context (TASK 10) ---
			const failedTask = await getTask(task.id);
			const failureClass = lastFailureClassification ?? "unknown";
			const { shouldRetry, delayMs } = evaluateRetry(failureClass, failedTask?.retryCount ?? 0);

			if (!isTimeout && shouldRetry && failedTask) {
				log.info(
					`[task-executor] Self-healing: auto-retry #${failedTask.retryCount + 1} for "${task.title}" after ${delayMs}ms`,
				);
				eventBus.emit({
					projectId,
					type: "task:transient_failure",
					agentId: agent?.id,
					taskId: task.id,
					payload: {
						error: errorMsg.slice(0, 500),
						retryCount: failedTask.retryCount + 1,
						maxRetries: MAX_AUTO_RETRIES,
						backoffMs: delayMs,
						classification: failureClass,
					},
				});
				eventBus.emitTransient({
					projectId,
					type: "agent:output",
					agentId: agent?.id,
					taskId: task.id,
					payload: {
						output: `[self-heal] Retry #${failedTask.retryCount + 1} (${failureClass}) after ${delayMs}ms: ${errorMsg.slice(0, 200)}`,
					},
				});

				// Exponential backoff before retry
				if (delayMs > 0) {
					await new Promise((r) => setTimeout(r, delayMs));
				}

				const retried = await taskEngine.retryTask(task.id);
				// Re-queue through executeTask to respect semaphore concurrency limits
				setTimeout(() => {
					executeTask(projectId, retried).catch((err) =>
						log.warn("[task-executor] Self-heal retry dispatch failed:" + " " + String(err?.message ?? err)),
					);
				}, 25);
				return; // skip dispatchReadyTasks — retry will go through executeTask
			}
		}
	}
}
