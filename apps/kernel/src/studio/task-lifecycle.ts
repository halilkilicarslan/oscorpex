// ---------------------------------------------------------------------------
// Oscorpex — Task Lifecycle
// Core task state transitions: assign, start, complete, fail, retry,
// markTaskDone, beginExecution.
// ---------------------------------------------------------------------------

import {
	areAllSubTasksDone,
	getProject,
	getTask,
	getTasksByIds,
	listAgentDependencies,
	listProjectAgents,
	releaseTaskClaim,
	updatePhaseStatus,
	updateProject,
	updateTask,
	upsertAgentDailyStat,
} from "./db.js";
import { classifyRisk } from "./agent-runtime/agent-constraints.js";
import { indexTaskOutput } from "./context-sandbox.js";
import { captureTaskDiffs } from "./diff-capture.js";
import { applyPostCompletionHooks, taskNeedsApprovalFromEdges } from "./edge-hooks.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import { recordAgentStep } from "./memory-bridge.js";
import { updateWorkingMemory } from "./memory-manager.js";
import { evaluatePolicies } from "./policy-engine.js";
import { syncDeclaredDependencies } from "./repo-dependency-sync.js";
import type { Task, TaskOutput } from "./types.js";
import type { TaskApprovalManager } from "./task-approval-manager.js";
import { shouldRequireApproval } from "./task-approval-manager.js";
import type { TaskReviewManager } from "./task-review-manager.js";
import type { PhaseProgressTracker } from "./phase-progress-tracker.js";

const log = createLogger("task-lifecycle");

export function isStrictFixTask(task: Task): boolean {
	const text = `${task.title} ${task.description}`.toLowerCase();
	return (
		text.includes("[bug fix]") ||
		text.includes("bug fix") ||
		text.includes("hotfix") ||
		text.includes("defect") ||
		text.includes("security fix") ||
		text.includes("import hatası") ||
		text.includes("import error")
	);
}

export type GetProjectIdCallback = (task: Task) => Promise<string>;
export type NotifyCompletedCallback = (taskId: string, projectId: string) => void;
export type RequireTaskCallback = (taskId: string) => Promise<Task>;

export class TaskLifecycle {
	private getProjectIdForTask: GetProjectIdCallback;
	private notifyCompleted: NotifyCompletedCallback;
	private requireTask: RequireTaskCallback;
	private approval: TaskApprovalManager;
	private review: TaskReviewManager;
	private progress: PhaseProgressTracker;

	constructor(
		getProjectIdForTask: GetProjectIdCallback,
		notifyCompleted: NotifyCompletedCallback,
		requireTask: RequireTaskCallback,
		approval: TaskApprovalManager,
		review: TaskReviewManager,
		progress: PhaseProgressTracker,
	) {
		this.getProjectIdForTask = getProjectIdForTask;
		this.notifyCompleted = notifyCompleted;
		this.requireTask = requireTask;
		this.approval = approval;
		this.review = review;
		this.progress = progress;
	}

	// -------------------------------------------------------------------------
	// Task lifecycle
	// -------------------------------------------------------------------------

	async assignTask(taskId: string, agentId: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "queued") {
			throw new Error(`Task ${taskId} is not queued (status: ${task.status})`);
		}

		const updated = (await updateTask(taskId, {
			status: "assigned",
			assignedAgent: agentId,
			assignedAgentId: agentId,
		}))!;
		const projectId = await this.getProjectIdForTask(task);

		eventBus.emit({
			projectId,
			type: "task:assigned",
			taskId,
			agentId,
			payload: { title: task.title },
		});

		return updated;
	}

	async startTask(taskId: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "assigned" && task.status !== "queued") {
			throw new Error(`Task ${taskId} cannot be started (status: ${task.status})`);
		}

		const projectId = await this.getProjectIdForTask(task);

		// v8.0: Auto-classify risk level and persist to task record
		try {
			const riskLevel = classifyRisk({
				proposalType: task.parentTaskId ? "sub_task" : "fix_task",
				severity: undefined,
				title: task.title,
			});
			if (!task.riskLevel) {
				await updateTask(taskId, { riskLevel });
			}
		} catch (err) {
			log.warn("[task-lifecycle] Risk classification failed (non-blocking):" + " " + String(err));
		}

		// v3.7: Policy enforcement — governance rules can block or warn before execution.
		// Persist the evaluation result so replay can use historical truth instead of re-evaluating.
		try {
			const policyResult = await evaluatePolicies(projectId, task);
			const policySnapshot = JSON.stringify({
				allowed: policyResult.allowed,
				violations: policyResult.violations,
				evaluatedAt: new Date().toISOString(),
			});
			await updateTask(taskId, { policySnapshot });
			if (!policyResult.allowed) {
				const message = policyResult.violations.join("; ");
				const blocked = (await updateTask(taskId, {
					status: "failed",
					error: `Policy violation: ${message}`,
				}))!;
				await releaseTaskClaim(taskId);
				eventBus.emit({
					projectId,
					type: "task:failed",
					agentId: task.assignedAgent,
					taskId,
					payload: {
						title: task.title,
						error: `Policy violation: ${message}`,
						policyBlocked: true,
						violations: policyResult.violations,
					},
				});
				log.warn(`[task-lifecycle] Task ${taskId} blocked by policy: ${message}`);
				return blocked;
			}
			if (policyResult.violations.length > 0) {
				log.warn(`[task-lifecycle] Task ${taskId} policy warnings: ${policyResult.violations.join("; ")}`);
			}
		} catch (err) {
			log.warn("[task-lifecycle] evaluatePolicies failed (non-blocking):" + " " + String(err));
		}

		// Human-in-the-Loop: Onay kontrolü — budget kontrolünden önce yapılır
		// v3.1: Incoming "approval" edge on the agent also forces human approval
		const edgeRequiresApproval = await taskNeedsApprovalFromEdges(projectId, task);
		const needsApproval =
			task.requiresApproval || (await shouldRequireApproval(projectId, task)) || edgeRequiresApproval;
		const alreadyApproved = task.approvalStatus === "approved";
		if (needsApproval && !alreadyApproved) {
			// Task'ı waiting_approval durumuna al ve kullanıcıdan onay iste
			const waiting = (await updateTask(taskId, {
				status: "waiting_approval",
				requiresApproval: true,
				approvalStatus: "pending",
			}))!;
			await releaseTaskClaim(taskId);

			eventBus.emit({
				projectId,
				type: "task:approval_required",
				taskId,
				payload: {
					title: task.title,
					taskTitle: task.title,
					agentName: task.assignedAgent,
					complexity: task.complexity,
					description: task.description,
				},
			});

			log.info(`[task-lifecycle] Task ${taskId} onay bekliyor: "${task.title}" (complexity: ${task.complexity})`);
			return waiting;
		}

		// Budget limiti kontrolü — aşıldıysa task'ı blocked yap ve event emit et
		const effectiveAgentId = task.assignedAgentId ?? task.assignedAgent;
		const budgetStatus = await this.approval.checkProjectBudget(projectId, effectiveAgentId);

		if (budgetStatus && budgetStatus.exceeded) {
			const blocked = (await updateTask(taskId, {
				status: "failed",
				error: budgetStatus.message,
			}))!;
			await releaseTaskClaim(taskId);

			eventBus.emit({
				projectId,
				type: "task:failed",
				agentId: task.assignedAgent,
				taskId,
				payload: {
					title: task.title,
					error: budgetStatus.message,
					budgetExceeded: true,
				},
			});

			// Kullanıcıya budget aşım uyarısı gönder
			eventBus.emit({
				projectId,
				type: "escalation:user",
				taskId,
				payload: {
					question: `Budget limit exceeded. Task "${task.title}" could not be started. ${budgetStatus.message}`,
					budgetExceeded: true,
				},
			});

			log.warn(`[task-lifecycle] Budget limit aşıldı, task blocked: ${taskId} — ${budgetStatus.message}`);
			return blocked;
		}

		// Uyarı seviyesindeyse event emit et ama task'ı durdurma
		if (budgetStatus && budgetStatus.level === "warning") {
			eventBus.emit({
				projectId,
				type: "escalation:user",
				taskId,
				payload: {
					question: budgetStatus.message,
					budgetWarning: true,
				},
			});
			log.warn(`[task-lifecycle] Budget uyarısı: ${budgetStatus.message}`);
		}

		const updated = (await updateTask(taskId, {
			status: "running",
			startedAt: new Date().toISOString(),
		}))!;

		eventBus.emit({
			projectId,
			type: "task:started",
			taskId,
			payload: { title: task.title },
		});

		return updated;
	}

	/**
	 * Task'ı tamamlar.
	 *
	 * v2 Review Loop:
	 *   1. Agent'ın review dependency'si var mı kontrol et
	 *   2. Varsa → task'ı 'review' durumuna al, reviewer bilgisini set et
	 *   3. Yoksa → normal 'done' akışı
	 */
	async completeTask(taskId: string, output: TaskOutput, options?: { executionRepoPath?: string }): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "running" && task.status !== "revision") {
			throw new Error(`Task ${taskId} is not running or in revision (status: ${task.status})`);
		}

		const projectId = await this.getProjectIdForTask(task);

		// Review task'ları için tekrar review araması yapma (sonsuz döngü önleme)
		const isReviewTask = task.title.startsWith("Code Review: ");
		const isCodingTask = !task.taskType || task.taskType === "ai";
		const changedFileCount = (output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0);

		if (isCodingTask && !isReviewTask && changedFileCount === 0 && isStrictFixTask(task)) {
			const proj = await getProject(projectId);
			const repoRoot = options?.executionRepoPath ?? proj?.repoPath;
			let healedByInstall = false;
			if (repoRoot) {
				const sync = syncDeclaredDependencies(repoRoot);
				if (sync.ranInstall && sync.ok && sync.missingBefore.length > 0 && sync.missingAfter.length === 0) {
					healedByInstall = true;
					output.logs = [
						...(output.logs ?? []),
						`[kernel] node_modules synced (${sync.command}); resolved missing packages: ${sync.missingBefore.join(", ")}`,
					];
					log.info(
						`[task-lifecycle] Fix task "${task.title}" healed by dependency sync (${sync.missingBefore.length} packages).`,
					);
				}
			}
			if (!healedByInstall) {
				throw new Error(
					`Zero-file output is not allowed for fix task "${task.title}" — task must include concrete file changes`,
				);
			}
		}

		if (isCodingTask && !isReviewTask && changedFileCount === 0) {
			// Fail etme — decision.md yaz ve reviewer'a gönder
			const decisionContent = this.review.buildDecisionContent(task);
			const fileWritten = await this.review.writeZeroFileDecision(projectId, task, decisionContent);
			output.filesCreated = fileWritten ? [this.review.decisionMdPath(projectId, task)] : [];
			output.logs = [
				...(output.logs ?? []),
				"[zero-file-guard] Task hiçbir dosya üretmedi. Reviewer inceleyecek.",
				"--- DECISION ---",
				decisionContent,
				"--- /DECISION ---",
			];
		}

		// v2: Review dependency kontrolü
		const reviewer = isReviewTask ? null : await this.review.findReviewerForTask(projectId, task);

		if (reviewer) {
			return this.review.transitionToReview(taskId, task, projectId, output, reviewer);
		}

		// Normal akış: doğrudan done
		return this.markTaskDone(taskId, output, projectId, task);
	}

	/**
	 * Task'ı doğrudan 'done' olarak işaretler ve pipeline'ı bilgilendirir.
	 */
	async markTaskDone(taskId: string, output: TaskOutput, projectId: string, task: Task): Promise<Task> {
		const updated = (await updateTask(taskId, {
			status: "done",
			output,
			completedAt: new Date().toISOString(),
			reviewStatus: "approved",
			error: null,
		}))!;

		eventBus.emit({
			projectId,
			type: "task:completed",
			taskId,
			payload: {
				title: task.title,
				filesCreated: output.filesCreated.length,
				filesModified: output.filesModified.length,
				testResults: output.testResults,
			},
		});

		// v3.1: Execution-time edge hooks — notification, mentoring, handoff doc check
		applyPostCompletionHooks(projectId, updated, output).catch((err) => {
			log.warn("[task-lifecycle] applyPostCompletionHooks failed:" + " " + String(err));
		});

		// v3.4: Refresh working memory snapshot for downstream context packets
		updateWorkingMemory(projectId).catch((err) => {
			log.warn("[task-lifecycle] updateWorkingMemory failed:" + " " + String(err));
		});

		// v4.0: Index task output for FTS cross-agent context
		indexTaskOutput(projectId, taskId, task.title, output).catch((err) => {
			log.warn("[task-lifecycle] indexTaskOutput failed:" + " " + String(err));
		});

		// v4.1: Capture file diffs for DiffViewer
		let proj = await getProject(projectId);
		if (proj?.repoPath) {
			captureTaskDiffs(taskId, proj.repoPath, output).catch((err) => {
				log.warn("[task-lifecycle] captureTaskDiffs failed:" + " " + String(err));
			});
		}

		// v4.1: Update agent daily stats for heat map / timeline
		const today = new Date().toISOString().slice(0, 10);
		const agentId = task.assignedAgentId || task.assignedAgent;
		const taskTimeMs = task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : 0;
		upsertAgentDailyStat(projectId, agentId, today, {
			tasksCompleted: 1,
			avgTaskTimeMs: taskTimeMs,
		}).catch((err) => {
			log.warn("[task-lifecycle] upsertAgentDailyStat failed:" + " " + String(err));
		});

		// v3.0: Sub-task rollup — if this task has a parent, check if all siblings are done
		if (task.parentTaskId) {
			try {
				const allDone = await areAllSubTasksDone(task.parentTaskId);
				if (allDone) {
					const parentTask = await getTask(task.parentTaskId);
					if (parentTask && parentTask.status !== "done") {
						log.info(`[task-lifecycle] All sub-tasks done — auto-completing parent "${parentTask.title}"`);
						await updateTask(task.parentTaskId, {
							status: "done",
							completedAt: new Date().toISOString(),
							output: { filesCreated: [], filesModified: [], logs: ["Auto-completed: all sub-tasks done"] },
						});
						eventBus.emit({
							projectId,
							type: "task:completed",
							taskId: task.parentTaskId,
							payload: { title: parentTask.title, autoCompleted: true },
						});
						await this.progress.checkAndAdvancePhase(parentTask.phaseId, projectId);
						this.notifyCompleted(task.parentTaskId, projectId);
					}
				}
			} catch (err) {
				log.warn("[task-lifecycle] Sub-task rollup check failed:" + " " + String(err));
			}
		}

		await this.progress.checkAndAdvancePhase(task.phaseId, projectId);
		this.notifyCompleted(taskId, projectId);

		// Record to memory tables for Memory page
		if (!proj) proj = await getProject(projectId);
		if (proj) {
			const agents = await listProjectAgents(projectId);
			const agent = agents.find((a) => a.id === task.assignedAgentId);
			recordAgentStep(
				projectId,
				proj.name,
				task.assignedAgentId || task.assignedAgent,
				agent?.name || task.assignedAgent,
				task.title,
				output.logs?.[0] || null,
			).catch((err) => log.warn("[task-lifecycle] Non-blocking operation failed:", err?.message ?? err));
		}

		return updated;
	}

	async failTask(taskId: string, error: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (!["running", "assigned", "waiting_approval"].includes(task.status)) {
			throw new Error(`Task ${taskId} cannot be failed from status: ${task.status}`);
		}
		if (task.status !== "running") {
			log.warn(`[task-lifecycle] Failing task "${task.title}" from non-running status: ${task.status}`);
		}

		const projectId = await this.getProjectIdForTask(task);

		// v3.1: Check for fallback edge — if primary agent fails, try fallback agent
		try {
			const deps = await listAgentDependencies(projectId);
			const effectiveAgentId = task.assignedAgentId ?? task.assignedAgent;
			const fallbackEdge = deps.find((d) => d.type === "fallback" && d.fromAgentId === effectiveAgentId);
			if (fallbackEdge && task.retryCount === 0) {
				log.info(`[task-lifecycle] Fallback edge found — re-assigning task "${task.title}" to fallback agent`);
				await updateTask(taskId, {
					assignedAgentId: fallbackEdge.toAgentId,
					assignedAgent: fallbackEdge.toAgentId,
					status: "queued",
					error: null,
					retryCount: (task.retryCount ?? 0) + 1,
				});
				this.notifyCompleted(taskId, projectId);
				return (await getTask(taskId))!;
			}

			// v3.1: Check for escalation edge — if task fails N times, escalate
			const escalationEdge = deps.find((d) => d.type === "escalation" && d.fromAgentId === effectiveAgentId);
			const maxFailures = escalationEdge?.metadata?.maxFailures ?? 3;
			if (escalationEdge && (task.retryCount ?? 0) >= maxFailures) {
				log.info(`[task-lifecycle] Escalation triggered — task "${task.title}" failed ${task.retryCount} times`);
				await updateTask(taskId, {
					assignedAgentId: escalationEdge.toAgentId,
					assignedAgent: escalationEdge.toAgentId,
					status: "queued",
					error: null,
				});
				this.notifyCompleted(taskId, projectId);
				return (await getTask(taskId))!;
			}
		} catch (err) {
			log.warn("[task-lifecycle] Edge-type check failed in failTask:" + " " + String(err));
		}

		const updated = (await updateTask(taskId, { status: "failed", error }))!;

		eventBus.emit({
			projectId,
			type: "task:failed",
			agentId: task.assignedAgent,
			taskId,
			payload: { title: task.title, error },
		});

		// v3.2: Auto-create defect work item on task failure
		try {
			const { createWorkItem } = await import("./db/work-item-repo.js");
			await createWorkItem({
				projectId,
				type: "defect",
				title: `Task failed: ${task.title}`,
				description: `Task "${task.title}" failed with error: ${error?.slice(0, 500) ?? "unknown"}`,
				priority: "high",
				source: "runtime",
				sourceTaskId: taskId,
				sourceAgentId: task.assignedAgentId,
			});
		} catch (err) {
			log.warn("[task-lifecycle] Auto work-item creation failed:" + " " + String(err));
		}

		await updatePhaseStatus(task.phaseId, "failed");
		await updateProject(projectId, { status: "failed" });
		eventBus.emit({
			projectId,
			type: "execution:error",
			taskId,
			payload: { title: task.title, error, phaseId: task.phaseId },
		});

		return updated;
	}

	async retryTask(taskId: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "failed" && task.status !== "done") {
			throw new Error(`Task ${taskId} cannot be retried (status: ${task.status})`);
		}

		await releaseTaskClaim(taskId);

		// Clear timestamps so a rerun gets fresh startedAt / duration; allow null via updateTask branch.
		const updated = (await updateTask(taskId, {
			status: "queued",
			retryCount: task.retryCount + 1,
			error: null,
			startedAt: null as unknown as string,
			completedAt: null as unknown as string,
		}))!;

		const projectId = await this.getProjectIdForTask(task);

		eventBus.emit({
			projectId,
			type: "task:retry",
			taskId,
			payload: { title: task.title, retryCount: updated.retryCount },
		});

		await updatePhaseStatus(task.phaseId, "running");
		await updateProject(projectId, { status: "running" });

		return updated;
	}

	// -------------------------------------------------------------------------
	// Full execution (after plan approval)
	// -------------------------------------------------------------------------

	async beginExecution(projectId: string): Promise<Task[]> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project ${projectId} not found`);

		const plan = await (await import("./db.js")).getLatestPlan(projectId);
		if (!plan || plan.status !== "approved") {
			throw new Error(`Project ${projectId} has no approved plan`);
		}

		await updateProject(projectId, { status: "running" });

		const firstPhase = await this.progress.getNextPhase(projectId);
		if (!firstPhase) throw new Error("No phase is ready to start");

		return this.progress.startPhase(projectId, firstPhase.id);
	}
}
