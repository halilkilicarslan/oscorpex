// ---------------------------------------------------------------------------
// Oscorpex — Task Engine v2
// Manages task lifecycle, dependency resolution, phase progression
// v2: Review loop, escalation, revision support
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRisk } from "./agent-runtime/agent-constraints.js";
import { indexTaskOutput } from "./context-sandbox.js";
import {
	areAllSubTasksDone,
	createTask,
	getAgentCostSummary,
	getLatestPlan,
	getProject,
	getProjectCostSummary,
	getProjectSetting,
	getProjectSettingsMap,
	getTask,
	getTasksByIds,
	listAgentDependencies,
	listPhases,
	listProjectAgents,
	listTasks,
	releaseTaskClaim,
	updatePhaseStatus,
	updateProject,
	updateTask,
} from "./db.js";
import { upsertAgentDailyStat } from "./db.js";
import { captureTaskDiffs } from "./diff-capture.js";
import { applyPostCompletionHooks, taskNeedsApprovalFromEdges } from "./edge-hooks.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import { recordAgentStep } from "./memory-bridge.js";
import { updateWorkingMemory } from "./memory-manager.js";
import { queryOne } from "./pg.js";
import { evaluatePolicies } from "./policy-engine.js";
import { syncDeclaredDependencies } from "./repo-dependency-sync.js";
import type { Phase, ProjectAgent, Task, TaskOutput } from "./types.js";

const log = createLogger("task-engine");

function isStrictFixTask(task: Task): boolean {
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

// Default onay keyword'leri — proje bazlı override yoksa bunlar kullanılır
const DEFAULT_APPROVAL_KEYWORDS = [
	"deploy",
	"database migration",
	"drop",
	"truncate",
	"migration",
	"seed",
	"production",
];

/**
 * Proje bazlı approval keyword'lerini döner.
 * project_settings category="approval" key="keywords" JSON array.
 * Yoksa DEFAULT_APPROVAL_KEYWORDS kullanılır.
 */
async function getApprovalKeywords(projectId: string): Promise<string[]> {
	const raw = await getProjectSetting(projectId, "approval", "keywords");
	if (!raw) return DEFAULT_APPROVAL_KEYWORDS;
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.length > 0) return parsed;
		return DEFAULT_APPROVAL_KEYWORDS;
	} catch {
		return DEFAULT_APPROVAL_KEYWORDS;
	}
}

/**
 * Task'ın onay gerektirip gerektirmediğini belirler.
 * XL complexity veya kritik keyword içeren task'lar onay gerektirir.
 */
async function shouldRequireApproval(
	projectId: string,
	task: Pick<Task, "title" | "description" | "complexity">,
): Promise<boolean> {
	if (task.complexity === "XL") return true;
	const keywords = await getApprovalKeywords(projectId);
	const searchText = `${task.title} ${task.description}`.toLowerCase();
	return keywords.some((kw) => searchText.includes(kw));
}

// Max review döngüsü — aşılırsa tech-lead'e eskalasyon
const MAX_REVISION_CYCLES = 3;

type TaskCompletionCallback = (taskId: string, projectId: string) => void;

// Maximum number of task→project mappings to hold in the in-memory LRU cache.
// task→project relationships are immutable so no invalidation is needed.
const PROJECT_ID_CACHE_MAX = 500;

class TaskEngine {
	private completionCallbacks: Set<TaskCompletionCallback> = new Set();
	private _projectIdCache: Map<string, string> = new Map();

	// -------------------------------------------------------------------------
	// Callback kayıt mekanizması (pipeline engine için hook noktası)
	// -------------------------------------------------------------------------

	onTaskCompleted(callback: TaskCompletionCallback): () => void {
		this.completionCallbacks.add(callback);
		return () => {
			this.completionCallbacks.delete(callback);
		};
	}

	private notifyCompleted(taskId: string, projectId: string): void {
		for (const cb of this.completionCallbacks) {
			try {
				cb(taskId, projectId);
			} catch {
				/* callback hatası pipeline'ı durdurmamalı */
			}
		}
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

	// -------------------------------------------------------------------------
	// Budget kontrolü — task başlatılmadan önce proje harcamasını kontrol eder
	// -------------------------------------------------------------------------

	/**
	 * Projenin budget ayarlarını okur ve mevcut harcamayı kontrol eder.
	 * - Budget devre dışıysa: null döner (devam et)
	 * - Budget aşılmamışsa: null döner (devam et)
	 * - Budget aşılmışsa: { exceeded: true, level: 'error' | 'warning', message } döner
	 */
	private async checkProjectBudget(
		projectId: string,
		agentId?: string,
	): Promise<{ exceeded: boolean; level: "warning" | "error"; message: string } | null> {
		try {
			const settingsMap = await getProjectSettingsMap(projectId);
			const budgetSettings = settingsMap["budget"];

			// Budget özelliği aktif değilse kontrol etme
			if (!budgetSettings || budgetSettings["enabled"] !== "true") return null;

			const maxCostStr = budgetSettings["maxCostUsd"];
			const warnThresholdStr = budgetSettings["warningThreshold"];

			// maxCostUsd tanımlı değilse kontrol etme
			const maxCost = maxCostStr ? Number.parseFloat(maxCostStr) : null;
			if (maxCost === null || isNaN(maxCost) || maxCost <= 0) return null;

			// Mevcut harcamayı al
			const costSummary = await getProjectCostSummary(projectId);
			const currentCost = costSummary.totalCostUsd;

			// %100 limit aşımı — execution durdurulacak
			if (currentCost >= maxCost) {
				return {
					exceeded: true,
					level: "error",
					message: `Budget limit exceeded: $${currentCost.toFixed(4)} / $${maxCost.toFixed(2)} USD. Task execution blocked.`,
				};
			}

			// Uyarı eşiği kontrolü
			const warnThreshold = warnThresholdStr ? Number.parseFloat(warnThresholdStr) : null;
			if (warnThreshold !== null && !isNaN(warnThreshold) && warnThreshold > 0 && currentCost >= warnThreshold) {
				return {
					exceeded: false,
					level: "warning",
					message: `Budget warning: $${currentCost.toFixed(4)} / $${maxCost.toFixed(2)} USD (${Math.round((currentCost / maxCost) * 100)}% used).`,
				};
			}

			// Agent-level budget kontrolü
			const agentMaxCostStr = budgetSettings["agent_max_cost_usd"];
			const agentMaxCost = agentMaxCostStr ? Number.parseFloat(agentMaxCostStr) : null;
			if (agentId && agentMaxCost && !isNaN(agentMaxCost) && agentMaxCost > 0) {
				const agentCost = await getAgentCostSummary(projectId, agentId);
				if (agentCost.totalCostUsd >= agentMaxCost) {
					return {
						exceeded: true,
						level: "error",
						message: `Agent budget limit exceeded: $${agentCost.totalCostUsd.toFixed(4)} / $${agentMaxCost.toFixed(2)} USD.`,
					};
				}
			}

			return null;
		} catch {
			// Budget kontrolü hataları task'ı durdurmamalı
			return null;
		}
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
			log.warn("[task-engine] Risk classification failed (non-blocking):" + " " + String(err));
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
				log.warn(`[task-engine] Task ${taskId} blocked by policy: ${message}`);
				return blocked;
			}
			if (policyResult.violations.length > 0) {
				log.warn(`[task-engine] Task ${taskId} policy warnings: ${policyResult.violations.join("; ")}`);
			}
		} catch (err) {
			log.warn("[task-engine] evaluatePolicies failed (non-blocking):" + " " + String(err));
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

			log.info(`[task-engine] Task ${taskId} onay bekliyor: "${task.title}" (complexity: ${task.complexity})`);
			return waiting;
		}

		// Budget limiti kontrolü — aşıldıysa task'ı blocked yap ve event emit et
		// (projectId yukarıda zaten tanımlandı)
		const effectiveAgentId = task.assignedAgentId ?? task.assignedAgent;
		const budgetStatus = await this.checkProjectBudget(projectId, effectiveAgentId);

		if (budgetStatus && budgetStatus.exceeded) {
			// Task'ı 'blocked' statüsüne al (failed yerine ayrı bir durum olarak işaretlenir)
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

			log.warn(`[task-engine] Budget limit aşıldı, task blocked: ${taskId} — ${budgetStatus.message}`);
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
			log.warn(`[task-engine] Budget uyarısı: ${budgetStatus.message}`);
		}

		const updated = (await updateTask(taskId, {
			status: "running",
			startedAt: new Date().toISOString(),
		}))!;

		// projectId budget kontrolünde zaten tanımlandı, tekrar tanımlamaya gerek yok
		eventBus.emit({
			projectId,
			type: "task:started",
			taskId,
			payload: { title: task.title },
		});

		return updated;
	}

	// -------------------------------------------------------------------------
	// Human-in-the-Loop: Onay mekanizması
	// -------------------------------------------------------------------------

	/**
	 * Bekleyen onay task'ını onaylar.
	 * Task 'queued' durumuna döner ve execution engine tarafından çalıştırılabilir.
	 */
	async approveTask(taskId: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "waiting_approval") {
			throw new Error(`Task ${taskId} onay beklemiyor (status: ${task.status})`);
		}

		// If a previous dispatch left a stale claim behind, clear it before re-queueing.
		// Otherwise execution-engine claimTask() can skip this task indefinitely.
		await releaseTaskClaim(taskId);

		const updated = (await updateTask(taskId, {
			status: "queued",
			approvalStatus: "approved",
		}))!;

		const projectId = await this.getProjectIdForTask(task);

		eventBus.emit({
			projectId,
			type: "task:approved",
			taskId,
			payload: {
				title: task.title,
				taskTitle: task.title,
				agentName: task.assignedAgent,
			},
		});

		log.info(`[task-engine] Task ${taskId} onaylandı: "${task.title}" — kuyruğa alındı`);
		return updated;
	}

	/**
	 * Bekleyen onay task'ını reddeder.
	 * Task 'failed' durumuna alınır, execution devam etmez.
	 */
	async rejectTask(taskId: string, reason?: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "waiting_approval") {
			throw new Error(`Task ${taskId} onay beklemiyor (status: ${task.status})`);
		}

		const rejectionReason = reason ?? "Kullanıcı tarafından reddedildi";

		const updated = (await updateTask(taskId, {
			status: "failed",
			approvalStatus: "rejected",
			approvalRejectionReason: rejectionReason,
			error: `Onay reddedildi: ${rejectionReason}`,
		}))!;

		const projectId = await this.getProjectIdForTask(task);

		eventBus.emit({
			projectId,
			type: "task:rejected",
			taskId,
			payload: {
				title: task.title,
				taskTitle: task.title,
				agentName: task.assignedAgent,
				reason: rejectionReason,
			},
		});

		log.info(`[task-engine] Task ${taskId} reddedildi: "${task.title}" — sebep: ${rejectionReason}`);
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
			// Sandbox repos often declare deps in package.json but never ran install —
			// agent may report zero file changes while the real fix is node_modules sync.
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
						`[task-engine] Fix task "${task.title}" healed by dependency sync (${sync.missingBefore.length} packages).`,
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
			const decisionContent = this.buildDecisionContent(task);
			const fileWritten = await this.writeZeroFileDecision(projectId, task, decisionContent);
			output.filesCreated = fileWritten ? [this.decisionMdPath(projectId, task)] : [];
			output.logs = [
				...(output.logs ?? []),
				"[zero-file-guard] Task hiçbir dosya üretmedi. Reviewer inceleyecek.",
				"--- DECISION ---",
				decisionContent,
				"--- /DECISION ---",
			];
		}

		// v2: Review dependency kontrolü
		const reviewer = isReviewTask ? null : await this.findReviewerForTask(projectId, task);

		if (reviewer) {
			// Review loop: task'ı review durumuna al
			const updated = (await updateTask(taskId, {
				status: "review",
				output,
				reviewerAgentId: reviewer.id,
				reviewStatus: null,
			}))!;

			// Create a real review task for the reviewer agent (visible in pipeline/board)
			const reviewTask = await createTask({
				phaseId: task.phaseId,
				title: `Code Review: ${task.title}`,
				description: `${reviewer.name} tarafından "${task.title}" task'ının kod incelemesi. Dosyalar: ${[...output.filesCreated, ...output.filesModified].slice(0, 5).join(", ") || "N/A"}`,
				assignedAgent: reviewer.id,
				assignedAgentId: reviewer.id,
				complexity: "S" as any,
				dependsOn: [taskId],
				branch: task.branch || "main",
			});

			// Link the review task to the original task
			await updateTask(taskId, { reviewTaskId: reviewTask.id });

			eventBus.emit({
				projectId,
				type: "task:completed",
				taskId,
				payload: {
					title: task.title,
					filesCreated: output.filesCreated.length,
					filesModified: output.filesModified.length,
					testResults: output.testResults,
					reviewRequired: true,
					reviewerAgentId: reviewer.id,
					reviewerName: reviewer.name,
					reviewTaskId: reviewTask.id,
				},
			});

			log.info(
				`[task-engine] Task ${taskId} review'a gönderildi → reviewer: ${reviewer.name} — review task: ${reviewTask.id}`,
			);

			// Review task dispatch: notify completion so onTaskCompleted callback
			// triggers dispatchReadyTasks and picks up the newly created review task
			this.notifyCompleted(taskId, projectId);

			return updated;
		}

		// Normal akış: doğrudan done
		return this.markTaskDone(taskId, output, projectId, task);
	}

	/**
	 * Task'ı doğrudan 'done' olarak işaretler ve pipeline'ı bilgilendirir.
	 */
	private async markTaskDone(taskId: string, output: TaskOutput, projectId: string, task: Task): Promise<Task> {
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
			log.warn("[task-engine] applyPostCompletionHooks failed:" + " " + String(err));
		});

		// v3.4: Refresh working memory snapshot for downstream context packets
		updateWorkingMemory(projectId).catch((err) => {
			log.warn("[task-engine] updateWorkingMemory failed:" + " " + String(err));
		});

		// v4.0: Index task output for FTS cross-agent context
		indexTaskOutput(projectId, taskId, task.title, output).catch((err) => {
			log.warn("[task-engine] indexTaskOutput failed:" + " " + String(err));
		});

		// v4.1: Capture file diffs for DiffViewer
		let proj = await getProject(projectId);
		if (proj?.repoPath) {
			captureTaskDiffs(taskId, proj.repoPath, output).catch((err) => {
				log.warn("[task-engine] captureTaskDiffs failed:" + " " + String(err));
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
			log.warn("[task-engine] upsertAgentDailyStat failed:" + " " + String(err));
		});

		// v3.0: Sub-task rollup — if this task has a parent, check if all siblings are done
		if (task.parentTaskId) {
			try {
				const allDone = await areAllSubTasksDone(task.parentTaskId);
				if (allDone) {
					const parentTask = await getTask(task.parentTaskId);
					if (parentTask && parentTask.status !== "done") {
						log.info(`[task-engine] All sub-tasks done — auto-completing parent "${parentTask.title}"`);
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
						await this.checkAndAdvancePhase(parentTask.phaseId, projectId);
						this.notifyCompleted(task.parentTaskId, projectId);
					}
				}
			} catch (err) {
				log.warn("[task-engine] Sub-task rollup check failed:" + " " + String(err));
			}
		}

		await this.checkAndAdvancePhase(task.phaseId, projectId);
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
			).catch((err) => log.warn("[task-engine] Non-blocking operation failed:", err?.message ?? err));
		}

		return updated;
	}

	// -------------------------------------------------------------------------
	// v2: Review loop
	// -------------------------------------------------------------------------

	/**
	 * Reviewer bir task'ı onaylar veya reddeder.
	 *
	 * Onay: task → 'done', pipeline ilerler
	 * Red:  task → 'revision', revisionCount++
	 *       Max cycle aşıldıysa → tech-lead'e eskalasyon
	 */
	async submitReview(taskId: string, approved: boolean, feedback?: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "review") {
			throw new Error(`Task ${taskId} is not in review (status: ${task.status})`);
		}

		const projectId = await this.getProjectIdForTask(task);

		if (approved) {
			// Onay → done
			const updated = (await updateTask(taskId, {
				status: "done",
				reviewStatus: "approved",
				completedAt: new Date().toISOString(),
				error: null,
			}))!;

			eventBus.emit({
				projectId,
				type: "task:completed",
				taskId,
				payload: {
					title: task.title,
					reviewApproved: true,
					reviewerAgentId: task.reviewerAgentId,
				},
			});

			log.info(`[task-engine] Task ${taskId} review onaylandı`);

			await this.checkAndAdvancePhase(task.phaseId, projectId);
			this.notifyCompleted(taskId, projectId);

			return updated;
		}

		// Red → revision
		const newRevisionCount = task.revisionCount + 1;

		if (newRevisionCount >= MAX_REVISION_CYCLES) {
			// Eskalasyon: tech-lead'e yönlendir
			return this.escalateTask(taskId, task, projectId, feedback);
		}

		const updated = (await updateTask(taskId, {
			status: "revision",
			reviewStatus: "rejected",
			revisionCount: newRevisionCount,
			error: feedback ? `Review red: ${feedback}` : "Review reddedildi",
		}))!;

		eventBus.emit({
			projectId,
			type: "task:review_rejected",
			agentId: task.assignedAgent,
			taskId,
			payload: {
				title: task.title,
				revisionCount: newRevisionCount,
				feedback,
				reviewerAgentId: task.reviewerAgentId,
			},
		});

		log.info(`[task-engine] Task ${taskId} revision'a gönderildi (döngü ${newRevisionCount}/${MAX_REVISION_CYCLES})`);

		return updated;
	}

	/**
	 * Max revision döngüsü aşıldığında tech-lead'e eskalasyon.
	 */
	private async escalateTask(taskId: string, task: Task, projectId: string, feedback?: string): Promise<Task> {
		// Tech lead'i bul
		const agents = await listProjectAgents(projectId);
		const techLead = agents.find((a) => a.role === "tech-lead");

		const escalationTarget = techLead?.name ?? "Tech Lead";
		const escalationAgentId = techLead?.id;

		const updated = (await updateTask(taskId, {
			status: "failed",
			reviewStatus: "rejected",
			error: `Max review döngüsü aşıldı (${MAX_REVISION_CYCLES}x). Eskalasyon: ${escalationTarget}. Son feedback: ${feedback ?? "N/A"}`,
			assignedAgentId: escalationAgentId,
		}))!;

		eventBus.emit({
			projectId,
			type: "escalation:user",
			taskId,
			payload: {
				title: task.title,
				reason: `Max review cycle exceeded (${MAX_REVISION_CYCLES})`,
				escalatedTo: escalationTarget,
				escalatedAgentId: escalationAgentId,
				feedback,
				revisionCount: task.revisionCount + 1,
			},
		});

		// v3.2: Auto-create bug work item when review loop can't converge
		try {
			const { createWorkItem } = await import("./db/work-item-repo.js");
			await createWorkItem({
				projectId,
				type: "bug",
				title: `Review escalation: ${task.title}`,
				description: `Task "${task.title}" could not pass review within ${MAX_REVISION_CYCLES} cycles. Last reviewer feedback: ${feedback?.slice(0, 500) ?? "N/A"}`,
				priority: "high",
				source: "review",
				sourceTaskId: taskId,
				sourceAgentId: task.assignedAgentId,
			});
		} catch (err) {
			log.warn("[task-engine] Auto work-item creation on escalation failed:" + " " + String(err));
		}

		log.warn(
			`[task-engine] Task ${taskId} eskalasyon: ${escalationTarget} (${MAX_REVISION_CYCLES} review döngüsü aşıldı)`,
		);

		return updated;
	}

	/**
	 * Revision durumundaki task'ı tekrar kuyruğa alır.
	 */
	async restartRevision(taskId: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (task.status !== "revision") {
			throw new Error(`Task ${taskId} is not in revision (status: ${task.status})`);
		}

		const updated = (await updateTask(taskId, {
			status: "queued",
			startedAt: undefined,
			reviewStatus: undefined,
		}))!;

		const projectId = await this.getProjectIdForTask(task);

		eventBus.emit({
			projectId,
			type: "task:retry",
			taskId,
			payload: {
				title: task.title,
				isRevision: true,
				revisionCount: task.revisionCount,
			},
		});

		log.info(`[task-engine] Task ${taskId} revision'dan tekrar kuyruğa alındı (döngü ${task.revisionCount})`);

		return updated;
	}

	// -------------------------------------------------------------------------
	// Review helper: Agent'ın reviewer'ını bul
	// -------------------------------------------------------------------------

	/**
	 * Bir task'ın agent'ının review dependency'si var mı kontrol eder.
	 * Eşleşme: task.assignedAgent (role/name/id) → project agent → review dep → reviewer agent
	 */
	private async findReviewerForTask(projectId: string, task: Task): Promise<ProjectAgent | null> {
		const agents = await listProjectAgents(projectId);
		const deps = await listAgentDependencies(projectId, "review");

		if (deps.length === 0) return null;

		// Task'ın atandığı agent'ı bul
		const assigned = task.assignedAgent ?? "";
		const assignedAgentId = task.assignedAgentId;

		let devAgent: ProjectAgent | undefined;

		if (assignedAgentId) {
			devAgent = agents.find((a) => a.id === assignedAgentId);
		}
		if (!devAgent) {
			devAgent = agents.find(
				(a) =>
					a.id === assigned ||
					a.sourceAgentId === assigned ||
					a.role.toLowerCase() === assigned.toLowerCase() ||
					a.name.toLowerCase() === assigned.toLowerCase(),
			);
		}

		if (!devAgent) return null;

		// Bu dev agent'ın review dependency'si var mı?
		const reviewDep = deps.find((d) => d.fromAgentId === devAgent!.id);
		if (!reviewDep) return null;

		return agents.find((a) => a.id === reviewDep.toAgentId) ?? null;
	}

	// -------------------------------------------------------------------------
	// Standard lifecycle (unchanged)
	// -------------------------------------------------------------------------

	async failTask(taskId: string, error: string): Promise<Task> {
		const task = await this.requireTask(taskId);
		if (!["running", "assigned", "waiting_approval"].includes(task.status)) {
			throw new Error(`Task ${taskId} cannot be failed from status: ${task.status}`);
		}
		if (task.status !== "running") {
			log.warn(`[task-engine] Failing task "${task.title}" from non-running status: ${task.status}`);
		}

		const projectId = await this.getProjectIdForTask(task);

		// v3.1: Check for fallback edge — if primary agent fails, try fallback agent
		try {
			const deps = await listAgentDependencies(projectId);
			const effectiveAgentId = task.assignedAgentId ?? task.assignedAgent;
			const fallbackEdge = deps.find((d) => d.type === "fallback" && d.fromAgentId === effectiveAgentId);
			if (fallbackEdge && task.retryCount === 0) {
				log.info(`[task-engine] Fallback edge found — re-assigning task "${task.title}" to fallback agent`);
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
				log.info(`[task-engine] Escalation triggered — task "${task.title}" failed ${task.retryCount} times`);
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
			log.warn("[task-engine] Edge-type check failed in failTask:" + " " + String(err));
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
			log.warn("[task-engine] Auto work-item creation failed:" + " " + String(err));
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
	// Dependency resolution
	// -------------------------------------------------------------------------

	async getReadyTasks(phaseId: string): Promise<Task[]> {
		const tasks = await listTasks(phaseId);
		const queued = tasks.filter((t) => t.status === "queued");
		if (queued.length === 0) return [];

		// Batch-fetch all dependency tasks in a single query (eliminates N+1)
		const allDepIds = new Set(queued.flatMap((t) => t.dependsOn));
		const depMap = allDepIds.size > 0 ? await getTasksByIds([...allDepIds]) : new Map<string, Task>();

		const ready: Task[] = [];
		for (const task of queued) {
			if (task.dependsOn.length === 0) {
				ready.push(task);
				continue;
			}

			const isReviewTask = task.title.startsWith("Code Review: ");

			// Review tasks can start when original task is in 'review' status
			const allDepsDone = task.dependsOn.every((depId) => {
				const dep = depMap.get(depId);
				return dep?.status === "done" || (isReviewTask && dep?.status === "review");
			});
			if (allDepsDone) ready.push(task);
		}
		return ready;
	}

	async isPhaseComplete(phaseId: string): Promise<boolean> {
		const tasks = await listTasks(phaseId);
		if (tasks.length === 0) return false;
		return tasks.every((t) => t.status === "done");
	}

	async isPhaseFailed(phaseId: string): Promise<boolean> {
		const tasks = await listTasks(phaseId);
		return tasks.some((t) => t.status === "failed");
	}

	// -------------------------------------------------------------------------
	// Phase progression
	// -------------------------------------------------------------------------

	async startPhase(projectId: string, phaseId: string): Promise<Task[]> {
		await updatePhaseStatus(phaseId, "running");

		eventBus.emit({
			projectId,
			type: "phase:started",
			payload: { phaseId },
		});

		return this.getReadyTasks(phaseId);
	}

	async getNextPhase(projectId: string): Promise<Phase | null> {
		const plan = await getLatestPlan(projectId);
		if (!plan || plan.status !== "approved") return null;

		for (const phase of plan.phases) {
			if (phase.status === "pending") {
				const depsComplete = phase.dependsOn.every((depId) => {
					const depPhase = plan.phases.find((p) => p.id === depId);
					return depPhase?.status === "completed";
				});
				if (depsComplete) return phase;
			}
		}

		return null;
	}

	async isProjectComplete(projectId: string): Promise<boolean> {
		const plan = await getLatestPlan(projectId);
		if (!plan) return false;
		return plan.phases.every((p) => p.status === "completed");
	}

	// -------------------------------------------------------------------------
	// Auto-advance
	// -------------------------------------------------------------------------

	private async checkAndAdvancePhase(phaseId: string, projectId: string): Promise<void> {
		if (!(await this.isPhaseComplete(phaseId))) return;

		await updatePhaseStatus(phaseId, "completed");

		eventBus.emit({
			projectId,
			type: "phase:completed",
			payload: { phaseId },
		});

		const nextPhase = await this.getNextPhase(projectId);
		if (nextPhase) {
			await this.startPhase(projectId, nextPhase.id);
		} else if (await this.isProjectComplete(projectId)) {
			await updateProject(projectId, { status: "completed" });
		}
	}

	// -------------------------------------------------------------------------
	// Full execution (after plan approval)
	// -------------------------------------------------------------------------

	async beginExecution(projectId: string): Promise<Task[]> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project ${projectId} not found`);

		const plan = await getLatestPlan(projectId);
		if (!plan || plan.status !== "approved") {
			throw new Error(`Project ${projectId} has no approved plan`);
		}

		await updateProject(projectId, { status: "running" });

		const firstPhase = await this.getNextPhase(projectId);
		if (!firstPhase) throw new Error("No phase is ready to start");

		return this.startPhase(projectId, firstPhase.id);
	}

	// -------------------------------------------------------------------------
	// Progress summary
	// -------------------------------------------------------------------------

	async getProgress(projectId: string) {
		const plan = await getLatestPlan(projectId);
		if (!plan) {
			return {
				phases: [],
				overall: { total: 0, done: 0, running: 0, failed: 0, queued: 0, review: 0, revision: 0, waitingApproval: 0 },
			};
		}

		let total = 0;
		let done = 0;
		let running = 0;
		let failed = 0;
		let queued = 0;
		let review = 0;
		let revision = 0;
		let waitingApproval = 0;

		const phases = plan.phases.map((phase) => {
			const tasks = phase.tasks;
			const tasksDone = tasks.filter((t) => t.status === "done").length;
			total += tasks.length;
			done += tasksDone;
			running += tasks.filter((t) => t.status === "running").length;
			failed += tasks.filter((t) => t.status === "failed").length;
			queued += tasks.filter((t) => t.status === "queued" || t.status === "assigned").length;
			review += tasks.filter((t) => t.status === "review").length;
			revision += tasks.filter((t) => t.status === "revision").length;
			// Human-in-the-Loop: Onay bekleyen task sayısını takip et
			waitingApproval += tasks.filter((t) => t.status === "waiting_approval").length;

			return {
				id: phase.id,
				name: phase.name,
				status: phase.status,
				tasksDone,
				tasksTotal: tasks.length,
			};
		});

		return { phases, overall: { total, done, running, failed, queued, review, revision, waitingApproval } };
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private async requireTask(taskId: string): Promise<Task> {
		const task = await getTask(taskId);
		if (!task) throw new Error(`Task ${taskId} not found`);
		return task;
	}

	private decisionMdPath(projectId: string, task: Task): string {
		return `.oscorpex/decisions/${task.id}-decision.md`;
	}

	private buildDecisionContent(task: Task): string {
		return [
			`# Zero-File Decision — ${task.title}`,
			"",
			`**Task ID:** ${task.id}`,
			`**Branch:** ${task.branch || "N/A"}`,
			`**Agent:** ${task.assignedAgent}`,
			`**Date:** ${new Date().toISOString()}`,
			"",
			"## Durum",
			"Bu task tamamlandığını bildirdi ancak hiçbir dosya oluşturmadı veya değiştirmedi.",
			"",
			"## Task Açıklaması",
			task.description || "(açıklama yok)",
			"",
			"## Reviewer İçin Kontrol Listesi",
			"- [ ] Task gerçekten dosya değişikliği gerektirmiyor mu?",
			"- [ ] Agent yanlışlıkla mı dosya üretmedi?",
			"- [ ] Bu bir araştırma/analiz task'ı olarak kabul edilebilir mi?",
			"- [ ] Proje bütünlüğü etkileniyor mu?",
			"",
			"## Karar",
			"Reviewer bu dosyayı inceleyip APPROVED veya REJECTED kararı vermelidir.",
		].join("\n");
	}

	private async writeZeroFileDecision(projectId: string, task: Task, content: string): Promise<boolean> {
		const project = await getProject(projectId);
		if (!project?.repoPath) {
			log.warn(`[task-engine] decision.md yazılamadı: proje repoPath boş (projectId=${projectId})`);
			return false;
		}

		const dir = join(project.repoPath, ".oscorpex", "decisions");
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(project.repoPath, this.decisionMdPath(projectId, task)), content);
			return true;
		} catch (err) {
			log.warn(`[task-engine] decision.md yazılamadı: ${err}`);
			return false;
		}
	}

	private async getProjectIdForTask(task: Task): Promise<string> {
		// Fast path 1: already on the task object (populated by createTask v4.2)
		if (task.projectId) {
			this._projectIdCache.set(task.id, task.projectId);
			return task.projectId;
		}

		// Fast path 2: in-memory LRU cache
		const cached = this._projectIdCache.get(task.id);
		if (cached !== undefined) return cached;

		// DB lookup: try direct column first (COALESCE), fall back to JOIN for un-backfilled rows.
		const row = await queryOne<{ project_id: string }>(
			`SELECT COALESCE(t.project_id, pp.project_id) AS project_id
			 FROM tasks t
			 JOIN phases p ON t.phase_id = p.id
			 JOIN project_plans pp ON p.plan_id = pp.id
			 WHERE t.id = $1`,
			[task.id],
		);
		const projectId = row?.project_id ?? "";

		// Evict the oldest entry when the cache is full (Map preserves insertion order).
		if (this._projectIdCache.size >= PROJECT_ID_CACHE_MAX) {
			const oldestKey = this._projectIdCache.keys().next().value;
			if (oldestKey !== undefined) this._projectIdCache.delete(oldestKey);
		}
		this._projectIdCache.set(task.id, projectId);

		return projectId;
	}

	// --- v8.0: Approval timeout check ---

	/**
	 * Check for tasks stuck in waiting_approval beyond timeout.
	 * Emits warning at 80% threshold, escalates at 100%.
	 * Should be called periodically (e.g., every 15 minutes via setInterval).
	 */
	async checkApprovalTimeouts(projectId: string): Promise<{ warned: string[]; expired: string[] }> {
		const timeoutHours = Number((await getProjectSetting(projectId, "approval", "timeout_hours")) ?? 24);
		const timeoutMs = timeoutHours * 3600_000;
		const warnMs = timeoutMs * 0.8;
		const now = Date.now();

		// BUG-001 fix: listTasks expects phaseId, not projectId.
		// Resolve all phases for this project and collect tasks across them.
		const plan = await getLatestPlan(projectId);
		if (!plan) return { warned: [], expired: [] };
		const phases = await listPhases(plan.id);
		const allTasks = (await Promise.all(phases.map((ph) => listTasks(ph.id)))).flat();

		const waiting = allTasks.filter((t) => t.status === "waiting_approval");

		const warned: string[] = [];
		const expired: string[] = [];

		for (const task of waiting) {
			const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : 0;
			if (!startedAt) continue;
			const elapsed = now - startedAt;

			if (elapsed >= timeoutMs) {
				// Expired — auto-escalate: fail with timeout reason
				await updateTask(task.id, {
					status: "failed",
					error: `Approval timeout: waited ${timeoutHours}h without response`,
				});
				eventBus.emit({
					projectId,
					type: "task:failed",
					taskId: task.id,
					payload: {
						title: task.title,
						error: `Approval expired after ${timeoutHours}h`,
						approvalTimeout: true,
					},
				});
				expired.push(task.id);
			} else if (elapsed >= warnMs) {
				// Warning threshold
				eventBus.emit({
					projectId,
					type: "task:approval_required",
					taskId: task.id,
					payload: {
						title: task.title,
						warning: `Approval timeout in ${Math.round((timeoutMs - elapsed) / 3600_000)}h`,
						approvalTimeoutWarning: true,
					},
				});
				warned.push(task.id);
			}
		}

		return { warned, expired };
	}
}

export const taskEngine = new TaskEngine();
