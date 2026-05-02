// ---------------------------------------------------------------------------
// Oscorpex — Task Approval Manager
// Handles human-in-the-loop approval: approve/reject, timeout checks,
// budget validation, and approval requirement detection.
// ---------------------------------------------------------------------------

import {
	getAgentCostSummary,
	getLatestPlan,
	getProjectCostSummary,
	getProjectSetting,
	getProjectSettingsMap,
	listPhases,
	listTasks,
	releaseTaskClaim,
	updateTask,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { Task } from "./types.js";

const log = createLogger("task-approval-manager");

// Default onay keyword'leri — proje bazlı override yoksa bunlar kullanılır
export const DEFAULT_APPROVAL_KEYWORDS = [
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
export async function getApprovalKeywords(projectId: string): Promise<string[]> {
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
export async function shouldRequireApproval(
	projectId: string,
	task: Pick<Task, "title" | "description" | "complexity">,
): Promise<boolean> {
	if (task.complexity === "XL") return true;
	const keywords = await getApprovalKeywords(projectId);
	const searchText = `${task.title} ${task.description}`.toLowerCase();
	return keywords.some((kw) => searchText.includes(kw));
}

export type GetProjectIdForTaskCallback = (task: Task) => Promise<string>;

export class TaskApprovalManager {
	private getProjectIdForTask: GetProjectIdForTaskCallback;

	constructor(getProjectIdForTask: GetProjectIdForTaskCallback) {
		this.getProjectIdForTask = getProjectIdForTask;
	}

	// -------------------------------------------------------------------------
	// Human-in-the-Loop: Onay mekanizması
	// -------------------------------------------------------------------------

	/**
	 * Bekleyen onay task'ını onaylar.
	 * Task 'queued' durumuna döner ve execution engine tarafından çalıştırılabilir.
	 */
	async approveTask(taskId: string, task: Task): Promise<Task> {
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

		log.info(`[task-approval-manager] Task ${taskId} onaylandı: "${task.title}" — kuyruğa alındı`);
		return updated;
	}

	/**
	 * Bekleyen onay task'ını reddeder.
	 * Task 'failed' durumuna alınır, execution devam etmez.
	 */
	async rejectTask(taskId: string, task: Task, reason?: string): Promise<Task> {
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

		log.info(`[task-approval-manager] Task ${taskId} reddedildi: "${task.title}" — sebep: ${rejectionReason}`);
		return updated;
	}

	// -------------------------------------------------------------------------
	// Budget kontrolü
	// -------------------------------------------------------------------------

	/**
	 * Projenin budget ayarlarını okur ve mevcut harcamayı kontrol eder.
	 * - Budget devre dışıysa: null döner (devam et)
	 * - Budget aşılmamışsa: null döner (devam et)
	 * - Budget aşılmışsa: { exceeded: true, level: 'error' | 'warning', message } döner
	 */
	async checkProjectBudget(
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

	// -------------------------------------------------------------------------
	// Approval timeout check
	// -------------------------------------------------------------------------

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
