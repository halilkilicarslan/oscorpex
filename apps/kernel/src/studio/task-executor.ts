// ---------------------------------------------------------------------------
// Oscorpex — Task Executor
// Handles the inner execution logic for individual tasks:
// prompt building, CLI dispatch, output gates, retry, provider fallback.
// ---------------------------------------------------------------------------

import { type ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import { agentRuntime } from "./agent-runtime.js";
import {
	acknowledgeMessages,
	completeSession,
	failSession,
	initSession,
	loadProtocolContext,
	recordStep,
} from "./agent-runtime/index.js";
import { startApp } from "./app-runner.js";
import { enforceBudgetGuard } from "./budget-guard.js";
import { resolveAllowedTools } from "./capability-resolver.js";
import { resolveFilePaths } from "./cli-runtime.js";
import { buildPolicyPromptSection, getDefaultPolicy } from "./command-policy.js";
import { buildRAGContext, formatRAGContext } from "./context-builder.js";
import { compactCrossAgentContext } from "./context-sandbox.js";
import { buildResumeSnapshot, formatResumeSnapshot } from "./context-session.js";
import {
	claimTask,
	getAgentConfig,
	getLatestPlan,
	getProject,
	getTask,
	listPhases,
	recordTokenUsage,
	releaseTaskClaim,
	updateProject,
	updateTask,
} from "./db.js";
import { updateDocsAfterTask } from "./docs-generator.js";
import { eventBus } from "./event-bus.js";
import { runGoalEvaluation, runTestGateCheck, runVerificationGate } from "./execution-gates.js";
import { type ExecutionWorkspace, resolveWorkspace } from "./execution-workspace.js";
import { formatGoalPrompt, getGoalForTask } from "./goal-engine.js";
import { runLintFix } from "./lint-runner.js";
import { createLogger } from "./logger.js";
import { resolveModel } from "./model-router.js";
import { persistAgentLog } from "./agent-log-store.js";
import { markExecutionStarted } from "./preflight-warmup.js";
import { buildTaskPrompt } from "./prompt-builder.js";
import { processAgentProposals } from "./proposal-processor.js";
import { ProviderExecutionService, isProvidersExhausted } from "./execution/index.js";
import { syncDeclaredDependencies } from "./repo-dependency-sync.js";
import { MAX_AUTO_RETRIES, evaluateRetry } from "./retry-policy.js";
import { executeReviewTask, resolveAgent } from "./review-dispatcher.js";
import {
	type SandboxPolicy,
	SandboxViolationError,
	endSandboxSession,
	enforceOutputSizeCheck,
	enforcePathChecks,
	enforceToolCheck,
	resolveTaskPolicy,
	startSandboxSession,
} from "./sandbox-manager.js";
import { taskEngine } from "./task-engine.js";
import { runIntegrationTest } from "./task-runners.js";
import { TIMEOUT_WARNING_THRESHOLD, resolveTaskTimeoutMs } from "./timeout-policy.js";
import type { AgentCliTool, Project, Task, TaskOutput } from "./types.js";

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
// TaskTimeoutError
// ---------------------------------------------------------------------------

/** Thrown when a task exceeds its configured timeout */
export class TaskTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		const minutes = (timeoutMs / 60_000).toFixed(1);
		super(`Task timed out after ${minutes} minute(s) (${timeoutMs}ms). The task was aborted.`);
		this.name = "TaskTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

// ---------------------------------------------------------------------------
// withTimeout helper
// ---------------------------------------------------------------------------

/**
 * Wraps a promise with a timeout using AbortController.
 * If the promise does not resolve within `timeoutMs`, the AbortController is
 * aborted and a TaskTimeoutError is thrown.
 *
 * @param operation   - Factory that receives an AbortSignal and returns the promise to race.
 * @param timeoutMs   - Maximum allowed duration in milliseconds.
 * @param onWarning   - Timeout'un %80'i dolduğunda çağrılır (opsiyonel).
 * @returns The resolved value of the operation promise.
 */
export function withTimeout<T>(
	operation: (signal: AbortSignal, extendTimeout: (ms: number) => void) => Promise<T>,
	timeoutMs: number,
	onWarning?: () => void,
): Promise<T> {
	const controller = new AbortController();
	let remainingMs = timeoutMs;
	let timer: ReturnType<typeof setTimeout>;
	let warningTimer: ReturnType<typeof setTimeout> | null = null;

	const resetTimers = () => {
		clearTimeout(timer);
		if (warningTimer) clearTimeout(warningTimer);

		const warningMs = Math.round(remainingMs * TIMEOUT_WARNING_THRESHOLD);
		warningTimer = onWarning
			? setTimeout(() => {
					onWarning();
				}, warningMs)
			: null;

		timer = setTimeout(() => {
			if (warningTimer) clearTimeout(warningTimer);
			controller.abort();
		}, remainingMs);
	};

	const extendTimeout = (ms: number) => {
		remainingMs += ms;
		resetTimers();
	};

	resetTimers();

	const timeoutPromise = new Promise<never>((_, reject) => {
		controller.signal.addEventListener("abort", () => {
			clearTimeout(timer);
			if (warningTimer) clearTimeout(warningTimer);
			reject(new TaskTimeoutError(timeoutMs));
		});
	});

	return Promise.race([operation(controller.signal, extendTimeout), timeoutPromise]);
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
		const currentTask = await getTask(task.id);
		const currentStatus = currentTask?.status ?? task.status;
		let startedTask: Task | undefined;

		if (currentStatus === "queued") {
			await taskEngine.assignTask(task.id, agentId);
			startedTask = await taskEngine.startTask(task.id);
		} else if (currentStatus === "assigned") {
			startedTask = await taskEngine.startTask(task.id);
		}
		// status === "running" → already started (e.g. revision restart), return undefined
		return startedTask;
	}

	/**
	 * Non-AI task types: integration-test and run-app
	 */
	async executeSpecialTask(
		projectId: string,
		project: Project,
		task: Task,
		dispatchReadyTasks: (projectId: string, phaseId: string) => Promise<void>,
	): Promise<void> {
		await taskEngine.assignTask(task.id, task.taskType ?? "system");
		await taskEngine.startTask(task.id);

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
				// run-app
				termLog("[task-executor] Starting application...");
				const result = await startApp(projectId, project.repoPath, termLog);
				output = {
					filesCreated: [],
					filesModified: [],
					logs: [`Started ${result.services.length} service(s). Preview: ${result.previewUrl}`],
				};
			}

			await taskEngine.completeTask(task.id, output, { executionRepoPath: project.repoPath });
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.error(`[task-executor] Special task failed: "${task.title}" — ${errorMsg}`);
			eventBus.emit({
				projectId,
				type: "agent:error",
				taskId: task.id,
				payload: { error: errorMsg },
			});
			await taskEngine.failTask(task.id, errorMsg);
			await updateProject(projectId, { status: "failed" });
		}

		// Dispatch next tasks
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
			await executeReviewTask(projectId, project, task, agentRuntime);
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
		let sandboxSessionId: string | undefined;
		let sandboxPolicy: SandboxPolicy | undefined;
		let isolatedWorkspace: ExecutionWorkspace | undefined;
		let runtimeRepoPath = project.repoPath;
		try {
			sandboxPolicy = await resolveTaskPolicy(projectId, task, agent.role);
			if (project.repoPath) {
				isolatedWorkspace = await resolveWorkspace(project.repoPath, task.id, sandboxPolicy);
				runtimeRepoPath = isolatedWorkspace.repoPath || project.repoPath;
				const sbSession = await startSandboxSession({
					projectId,
					taskId: task.id,
					agentId: agent.id,
					workspacePath: runtimeRepoPath,
				});
				sandboxSessionId = sbSession.id;
			}
		} catch (err) {
			log.warn("[task-executor] Sandbox init failed (non-blocking):" + " " + String(err));
		}

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
			if (sandboxPolicy && sandboxPolicy.enforcementMode !== "off") {
				for (const tool of allowedTools) {
					await enforceToolCheck(sandboxPolicy, tool, sandboxSessionId);
				}
				// Also enforce denied tools list against any critical tool names
				for (const denied of sandboxPolicy.deniedTools) {
					if (allowedTools.includes(denied)) {
						await enforceToolCheck(sandboxPolicy, denied, sandboxSessionId);
					}
				}
			}

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
			if (sandboxPolicy?.enforcementMode === "hard" && sandboxPolicy.deniedTools.length > 0) {
				const deniedInAllowed = allowedTools.filter((t) => sandboxPolicy!.deniedTools.includes(t));
				if (deniedInAllowed.length > 0) {
					throw new SandboxViolationError({
						type: "tool_denied",
						detail: `Pre-execution tool check: denied tools in allowedTools list: ${deniedInAllowed.join(", ")}`,
						timestamp: new Date().toISOString(),
					});
				}
			}

			// M4: Provider dispatch — ProviderExecutionService handles fallback chain,
			// telemetry lifecycle, cooldown marking, and error classification.
			const providerService = new ProviderExecutionService(this.telemetry);

			// Session step: CLI execution started (before we know which adapter wins)
			if (sessionId) {
				recordStep(sessionId, {
					step: 1,
					type: "action_executed",
					summary: `CLI execution started: ${primaryCliTool}`,
				}).catch((err) =>
					log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
				);
			}
			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				agentId: agent.id,
				taskId: task.id,
				payload: { output: `[execution] CLI started: ${primaryCliTool}` },
			});
			agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
			agentRuntime.appendVirtualOutput(
				projectId,
				agent.id,
				formatTaskLog(`[execution] CLI started: ${primaryCliTool}`),
			);

			const providerExecResult = await providerService.execute({
				projectId,
				taskId: task.id,
				agentId: agent.id,
				agentName: agent.name,
				repoPath: runtimeRepoPath,
				prompt,
				rawSystemPrompt: agent.systemPrompt || undefined,
				agentConfig: { name: agent.name, role: agent.role, model: agent.model, skills: agent.skills ?? [] },
				model: routedModel,
				cliTool: primaryCliTool,
				allowedTools,
				timeoutMs,
				signal: taskController.signal,
				onLog: (line: string) => {
					agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
					agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(line));
					eventBus.emitTransient({
						projectId,
						type: "agent:output",
						agentId: agent.id,
						taskId: task.id,
						payload: { output: line },
					});
				},
				queueWaitMs,
				isColdStart,
			});

			// Graceful degraded mode: if all providers are exhausted, defer the task
			// instead of failing it. Reset to queued and schedule a retry.
			if (isProvidersExhausted(providerExecResult)) {
				const { retryMs } = providerExecResult;
				log.warn(
					`[task-executor] All providers exhausted — deferring "${task.title}" for ${Math.round(retryMs / 1000)}s`,
				);
				await updateTask(task.id, { status: "queued" });
				eventBus.emit({
					projectId,
					type: "pipeline:degraded",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						message: `All providers exhausted. Task "${task.title}" deferred. Retry in ${Math.round(retryMs / 1000)}s.`,
						retryMs,
					},
				});
				// Schedule a retry after cooldown expires
				setTimeout(() => {
					getTask(task.id).then((t) => {
						if (t && t.status === "queued") {
							executeTask(projectId, t).catch((err) =>
								log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
							);
						}
					});
				}, retryMs + 1000);
				return;
			}

			// From here providerExecResult is NormalizedProviderResult
			const cliResult = providerExecResult;
			// Track the winning provider's classification for retry policy
			lastFailureClassification = undefined;

			const output: TaskOutput = {
				filesCreated: resolveFilePaths(cliResult.filesCreated, runtimeRepoPath),
				filesModified: resolveFilePaths(cliResult.filesModified, runtimeRepoPath),
				logs: cliResult.logs,
			};

			// Session step: CLI output received
			if (sessionId) {
				const fileCount = (output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0);
				recordStep(sessionId, {
					step: 2,
					type: "result_inspected",
					summary: `Output received: ${fileCount} files (${output.filesCreated?.length ?? 0} created, ${output.filesModified?.length ?? 0} modified)`,
				}).catch((err) =>
					log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
				);
			}

			if (isolatedWorkspace?.isolated) {
				const synced = await isolatedWorkspace.writeBack([
					...(output.filesCreated ?? []),
					...(output.filesModified ?? []),
				]);
				output.filesCreated = output.filesCreated.filter((file) => synced.includes(file));
				output.filesModified = output.filesModified.filter((file) => synced.includes(file));
			}

			// Record token usage from CLI result
			if (cliResult.inputTokens || cliResult.outputTokens) {
				const totalTokens = cliResult.inputTokens + cliResult.outputTokens;
				await recordTokenUsage({
					projectId,
					taskId: task.id,
					agentId: agent.id,
					model: cliResult.model || "claude-sonnet-4-6",
					provider: cliResult.provider || "anthropic",
					inputTokens: cliResult.inputTokens,
					outputTokens: cliResult.outputTokens,
					totalTokens,
					costUsd: cliResult.costUsd,
					cacheCreationTokens: cliResult.cacheCreationTokens,
					cacheReadTokens: cliResult.cacheReadTokens,
				});

				// Cost circuit breaker: check budget after recording spend
				const budgetExceeded = await enforceBudgetGuard(projectId);
				if (budgetExceeded) {
					// Complete current task normally but stop dispatching further
					log.warn(`[task-executor] Budget exceeded — completing "${task.title}" but pausing pipeline`);
				}
			}

			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				agentId: agent.id,
				taskId: task.id,
				payload: { output: `[execution] Mode: cli` },
			});
			agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
			agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog("[execution] Mode: cli"));

			// --- ESLint/Prettier enforcement: auto-fix generated files ---
			const allFiles = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
			if (allFiles.length > 0 && project.repoPath) {
				try {
					const termLog = (msg: string) => {
						agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
						agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(msg));
					};
					const lintResult = await runLintFix(project.repoPath, allFiles, termLog);
					if (lintResult.eslint.errors.length > 0 || lintResult.prettier.errors.length > 0) {
						eventBus.emitTransient({
							projectId,
							type: "agent:output",
							agentId: agent.id,
							taskId: task.id,
							payload: {
								output: `[lint] Uyarılar: eslint(${lintResult.eslint.errors.length}), prettier(${lintResult.prettier.errors.length})`,
							},
						});
					}
				} catch (lintErr) {
					// Lint failure should never block task completion
					log.warn({ err: lintErr }, "Lint/format failed (non-blocking)");
				}
			}

			// --- Auto-documentation: update docs based on agent role ---
			try {
				await updateDocsAfterTask(project, { ...task, output }, agent, (msg) => {
					agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
					agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(msg));
				});
			} catch (docErr) {
				log.warn({ err: docErr }, "Docs update failed (non-blocking)");
			}

			// Agent output buffer'ını log dosyasına persist et (restart sonrası terminal'de görünsün)
			const agentOutputLines = agentRuntime.getAgentOutput(projectId, agent.id);
			if (agentOutputLines.length > 0) {
				persistAgentLog(projectId, agent.id, agentOutputLines).catch((err) =>
					log.warn("[task-executor] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
				);
			}

			// --- Sandbox post-execution: enforce path + output size restrictions ---
			if (sandboxPolicy && sandboxPolicy.enforcementMode !== "off") {
				const allPaths = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
				if (allPaths.length > 0) {
					await enforcePathChecks(sandboxPolicy, allPaths, sandboxSessionId);
				}
				const outputSizeEstimate = JSON.stringify(output).length;
				await enforceOutputSizeCheck(sandboxPolicy, outputSizeEstimate, sandboxSessionId);
			}

			// --- v8.0: Process structured proposals (delegated to proposal-processor.ts) ---
			if (cliResult?.proposals && cliResult.proposals.length > 0) {
				try {
					await processAgentProposals(projectId, task, agent, cliResult.proposals);
				} catch (err) {
					log.warn("[task-executor] Proposal processing failed (non-blocking):" + " " + String(err));
				}
			}

			// --- Output verification + test gates (delegated to execution-gates.ts) ---
			if (project.repoPath) {
				const verifyResult = await runVerificationGate(projectId, task, project.repoPath, output, agent.id, sessionId);
				if (!verifyResult.passed) {
					throw new Error(`Output verification failed: ${verifyResult.failedChecks}`);
				}

				const testResult = await runTestGateCheck(
					projectId,
					task,
					project.repoPath,
					output,
					agent.role,
					agent.id,
					sessionId,
				);
				if (!testResult.passed) {
					throw new Error(testResult.failedChecks!);
				}
			}

			await taskEngine.completeTask(task.id, output, { executionRepoPath: runtimeRepoPath });

			// --- Sandbox: end session ---
			if (sandboxSessionId) {
				endSandboxSession(sandboxSessionId).catch((e) =>
					log.warn("[task-executor] Sandbox end failed:" + " " + String(e)),
				);
			}
			if (isolatedWorkspace?.isolated) {
				isolatedWorkspace
					.cleanup()
					.catch((e) => log.warn("[task-executor] Workspace cleanup failed:" + " " + String(e)));
			}

			// --- Goal evaluation (delegated to execution-gates.ts) ---
			if (goalId) {
				try {
					await runGoalEvaluation(task.id, task.title, output, projectId);
				} catch (e) {
					if (e instanceof Error && e.message.startsWith("Goal validation failed")) throw e;
					log.warn({ err: e }, "Goal evaluation failed (non-blocking)");
				}
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
					const { pipelineEngine } = await import("./pipeline-engine.js");
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
				setImmediate(() => {
					executeTask(projectId, retried).catch((err) =>
						log.warn("[task-executor] Self-heal retry dispatch failed:" + " " + String(err?.message ?? err)),
					);
				});
				return; // skip dispatchReadyTasks — retry will go through executeTask
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Queue wait computation helper (TASK 2.2 — visible calculation point)
// ---------------------------------------------------------------------------

/**
 * Computes queue wait time in milliseconds from a task's createdAt and startedAt timestamps.
 * Returns 0 if either timestamp is missing.
 *
 * Definition: queue wait = task startedAt − task createdAt
 *   - createdAt: set when task is first inserted into DB (tasks.created_at DEFAULT now())
 *   - startedAt: set when task transitions from "assigned" → "running"
 *
 * This is the **single source of truth** for queue wait calculation.
 */
export function computeQueueWaitMs(task: { createdAt?: string | null; startedAt?: string | null }): number {
	if (!task.createdAt || !task.startedAt) return 0;
	const wait = new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime();
	return Math.max(0, wait);
}
