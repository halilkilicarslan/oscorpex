// ---------------------------------------------------------------------------
// Oscorpex — Task Review Manager
// Handles review loop: submitReview, escalation, revision restart,
// reviewer resolution, and zero-file decision documents.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createTask,
	getProject,
	listAgentDependencies,
	listProjectAgents,
	updateTask,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { ProjectAgent, Task, TaskOutput } from "./types.js";

const log = createLogger("task-review-manager");

// Max review döngüsü — aşılırsa tech-lead'e eskalasyon
export const MAX_REVISION_CYCLES = 3;

export type ReviewCompletionCallback = (taskId: string, projectId: string) => void;
export type CheckAndAdvancePhaseCallback = (phaseId: string, projectId: string) => Promise<void>;

export class TaskReviewManager {
	private onNotifyCompleted: ReviewCompletionCallback;
	private onCheckAndAdvancePhase: CheckAndAdvancePhaseCallback;

	constructor(
		notifyCompleted: ReviewCompletionCallback,
		checkAndAdvancePhase: CheckAndAdvancePhaseCallback,
	) {
		this.onNotifyCompleted = notifyCompleted;
		this.onCheckAndAdvancePhase = checkAndAdvancePhase;
	}

	// -------------------------------------------------------------------------
	// Review loop
	// -------------------------------------------------------------------------

	/**
	 * Reviewer bir task'ı onaylar veya reddeder.
	 *
	 * Onay: task → 'done', pipeline ilerler
	 * Red:  task → 'revision', revisionCount++
	 *       Max cycle aşıldıysa → tech-lead'e eskalasyon
	 */
	async submitReview(
		taskId: string,
		task: Task,
		projectId: string,
		approved: boolean,
		feedback?: string,
	): Promise<Task> {
		if (task.status !== "review") {
			throw new Error(`Task ${taskId} is not in review (status: ${task.status})`);
		}

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

			log.info(`[task-review-manager] Task ${taskId} review onaylandı`);

			await this.onCheckAndAdvancePhase(task.phaseId, projectId);
			this.onNotifyCompleted(taskId, projectId);

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

		log.info(
			`[task-review-manager] Task ${taskId} revision'a gönderildi (döngü ${newRevisionCount}/${MAX_REVISION_CYCLES})`,
		);

		return updated;
	}

	/**
	 * Max revision döngüsü aşıldığında tech-lead'e eskalasyon.
	 */
	async escalateTask(taskId: string, task: Task, projectId: string, feedback?: string): Promise<Task> {
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
			log.warn("[task-review-manager] Auto work-item creation on escalation failed:" + " " + String(err));
		}

		log.warn(
			`[task-review-manager] Task ${taskId} eskalasyon: ${escalationTarget} (${MAX_REVISION_CYCLES} review döngüsü aşıldı)`,
		);

		return updated;
	}

	/**
	 * Revision durumundaki task'ı tekrar kuyruğa alır.
	 */
	async restartRevision(taskId: string, task: Task, projectId: string): Promise<Task> {
		if (task.status !== "revision") {
			throw new Error(`Task ${taskId} is not in revision (status: ${task.status})`);
		}

		const updated = (await updateTask(taskId, {
			status: "queued",
			startedAt: undefined,
			reviewStatus: undefined,
		}))!;

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

		log.info(
			`[task-review-manager] Task ${taskId} revision'dan tekrar kuyruğa alındı (döngü ${task.revisionCount})`,
		);

		return updated;
	}

	// -------------------------------------------------------------------------
	// Reviewer resolution
	// -------------------------------------------------------------------------

	/**
	 * Bir task'ın agent'ının review dependency'si var mı kontrol eder.
	 * Eşleşme: task.assignedAgent (role/name/id) → project agent → review dep → reviewer agent
	 */
	async findReviewerForTask(projectId: string, task: Task): Promise<ProjectAgent | null> {
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
	// Review task creation (called from task lifecycle on completeTask)
	// -------------------------------------------------------------------------

	/**
	 * Reviewer bulunduğunda review task oluşturur, task'ı 'review' durumuna alır
	 * ve notifyCompleted callback'ini tetikler.
	 */
	async transitionToReview(
		taskId: string,
		task: Task,
		projectId: string,
		output: TaskOutput,
		reviewer: ProjectAgent,
	): Promise<Task> {
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
			`[task-review-manager] Task ${taskId} review'a gönderildi → reviewer: ${reviewer.name} — review task: ${reviewTask.id}`,
		);

		// Review task dispatch: notify completion so onTaskCompleted callback
		// triggers dispatchReadyTasks and picks up the newly created review task
		this.onNotifyCompleted(taskId, projectId);

		return updated;
	}

	// -------------------------------------------------------------------------
	// Zero-file decision document helpers
	// -------------------------------------------------------------------------

	decisionMdPath(_projectId: string, task: Task): string {
		return `.oscorpex/decisions/${task.id}-decision.md`;
	}

	buildDecisionContent(task: Task): string {
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

	async writeZeroFileDecision(projectId: string, task: Task, content: string): Promise<boolean> {
		const project = await getProject(projectId);
		if (!project?.repoPath) {
			log.warn(`[task-review-manager] decision.md yazılamadı: proje repoPath boş (projectId=${projectId})`);
			return false;
		}

		const dir = join(project.repoPath, ".oscorpex", "decisions");
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(project.repoPath, this.decisionMdPath(projectId, task)), content);
			return true;
		} catch (err) {
			log.warn(`[task-review-manager] decision.md yazılamadı: ${err}`);
			return false;
		}
	}
}
