// ---------------------------------------------------------------------------
// Oscorpex — Task Engine v2
// Manages task lifecycle, dependency resolution, phase progression
// v2: Review loop, escalation, revision support
// ---------------------------------------------------------------------------

import {
  getTask,
  updateTask,
  createTask,
  listTasks,
  updatePhaseStatus,
  getLatestPlan,
  updateProject,
  getProject,
  listProjectAgents,
  listAgentDependencies,
  getProjectCostSummary,
  getAgentCostSummary,
  getProjectSettingsMap,
} from './db.js';
import { queryOne } from './pg.js';
import { eventBus } from './event-bus.js';
import { recordAgentStep } from './memory-bridge.js';
import type { Task, Phase, TaskOutput, ProjectAgent } from './types.js';

// Onay gerektiren task keyword'leri — büyük/küçük harf duyarsız kontrol
const APPROVAL_KEYWORDS = ['deploy', 'database migration', 'delete', 'drop', 'truncate', 'migration', 'seed', 'production'];

/**
 * Task'ın onay gerektirip gerektirmediğini belirler.
 * XL complexity veya kritik keyword içeren task'lar onay gerektirir.
 */
function shouldRequireApproval(task: Pick<Task, 'title' | 'description' | 'complexity'>): boolean {
  // XL complexity her zaman onay gerektirir
  if (task.complexity === 'XL') return true;
  // Başlık veya açıklamada kritik keyword var mı kontrol et
  const searchText = `${task.title} ${task.description}`.toLowerCase();
  return APPROVAL_KEYWORDS.some((kw) => searchText.includes(kw));
}

// Max review döngüsü — aşılırsa tech-lead'e eskalasyon
const MAX_REVISION_CYCLES = 3;

type TaskCompletionCallback = (taskId: string, projectId: string) => void;

class TaskEngine {
  private completionCallbacks: Set<TaskCompletionCallback> = new Set();

  // -------------------------------------------------------------------------
  // Callback kayıt mekanizması (pipeline engine için hook noktası)
  // -------------------------------------------------------------------------

  onTaskCompleted(callback: TaskCompletionCallback): () => void {
    this.completionCallbacks.add(callback);
    return () => { this.completionCallbacks.delete(callback); };
  }

  private notifyCompleted(taskId: string, projectId: string): void {
    for (const cb of this.completionCallbacks) {
      try { cb(taskId, projectId); } catch { /* callback hatası pipeline'ı durdurmamalı */ }
    }
  }

  // -------------------------------------------------------------------------
  // Task lifecycle
  // -------------------------------------------------------------------------

  async assignTask(taskId: string, agentId: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (task.status !== 'queued') {
      throw new Error(`Task ${taskId} is not queued (status: ${task.status})`);
    }

    const updated = (await updateTask(taskId, { status: 'assigned', assignedAgent: agentId }))!;
    const projectId = await this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:assigned',
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
  private async checkProjectBudget(projectId: string, agentId?: string): Promise<{ exceeded: boolean; level: 'warning' | 'error'; message: string } | null> {
    try {
      const settingsMap = await getProjectSettingsMap(projectId);
      const budgetSettings = settingsMap['budget'];

      // Budget özelliği aktif değilse kontrol etme
      if (!budgetSettings || budgetSettings['enabled'] !== 'true') return null;

      const maxCostStr = budgetSettings['maxCostUsd'];
      const warnThresholdStr = budgetSettings['warningThreshold'];

      // maxCostUsd tanımlı değilse kontrol etme
      const maxCost = maxCostStr ? parseFloat(maxCostStr) : null;
      if (maxCost === null || isNaN(maxCost) || maxCost <= 0) return null;

      // Mevcut harcamayı al
      const costSummary = await getProjectCostSummary(projectId);
      const currentCost = costSummary.totalCostUsd;

      // %100 limit aşımı — execution durdurulacak
      if (currentCost >= maxCost) {
        return {
          exceeded: true,
          level: 'error',
          message: `Budget limit exceeded: $${currentCost.toFixed(4)} / $${maxCost.toFixed(2)} USD. Task execution blocked.`,
        };
      }

      // Uyarı eşiği kontrolü
      const warnThreshold = warnThresholdStr ? parseFloat(warnThresholdStr) : null;
      if (warnThreshold !== null && !isNaN(warnThreshold) && warnThreshold > 0 && currentCost >= warnThreshold) {
        return {
          exceeded: false,
          level: 'warning',
          message: `Budget warning: $${currentCost.toFixed(4)} / $${maxCost.toFixed(2)} USD (${Math.round((currentCost / maxCost) * 100)}% used).`,
        };
      }

      // Agent-level budget kontrolü
      const agentMaxCostStr = budgetSettings['agent_max_cost_usd'];
      const agentMaxCost = agentMaxCostStr ? parseFloat(agentMaxCostStr) : null;
      if (agentId && agentMaxCost && !isNaN(agentMaxCost) && agentMaxCost > 0) {
        const agentCost = await getAgentCostSummary(projectId, agentId);
        if (agentCost.totalCostUsd >= agentMaxCost) {
          return {
            exceeded: true,
            level: 'error',
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
    if (task.status !== 'assigned' && task.status !== 'queued') {
      throw new Error(`Task ${taskId} cannot be started (status: ${task.status})`);
    }

    const projectId = await this.getProjectIdForTask(task);

    // Human-in-the-Loop: Onay kontrolü — budget kontrolünden önce yapılır
    const needsApproval = task.requiresApproval || shouldRequireApproval(task);
    const alreadyApproved = task.approvalStatus === 'approved';
    if (needsApproval && !alreadyApproved) {
      // Task'ı waiting_approval durumuna al ve kullanıcıdan onay iste
      const waiting = (await updateTask(taskId, {
        status: 'waiting_approval',
        requiresApproval: true,
        approvalStatus: 'pending',
      }))!;

      eventBus.emit({
        projectId,
        type: 'task:approval_required',
        taskId,
        payload: {
          title: task.title,
          taskTitle: task.title,
          agentName: task.assignedAgent,
          complexity: task.complexity,
          description: task.description,
        },
      });

      console.log(`[task-engine] Task ${taskId} onay bekliyor: "${task.title}" (complexity: ${task.complexity})`);
      return waiting;
    }

    // Budget limiti kontrolü — aşıldıysa task'ı blocked yap ve event emit et
    // (projectId yukarıda zaten tanımlandı)
    const budgetStatus = await this.checkProjectBudget(projectId, task.assignedAgentId);

    if (budgetStatus && budgetStatus.exceeded) {
      // Task'ı 'blocked' statüsüne al (failed yerine ayrı bir durum olarak işaretlenir)
      const blocked = (await updateTask(taskId, {
        status: 'failed',
        error: budgetStatus.message,
      }))!;

      eventBus.emit({
        projectId,
        type: 'task:failed',
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
        type: 'escalation:user',
        taskId,
        payload: {
          question: `Budget limit exceeded. Task "${task.title}" could not be started. ${budgetStatus.message}`,
          budgetExceeded: true,
        },
      });

      console.warn(`[task-engine] Budget limit aşıldı, task blocked: ${taskId} — ${budgetStatus.message}`);
      return blocked;
    }

    // Uyarı seviyesindeyse event emit et ama task'ı durdurma
    if (budgetStatus && budgetStatus.level === 'warning') {
      eventBus.emit({
        projectId,
        type: 'escalation:user',
        taskId,
        payload: {
          question: budgetStatus.message,
          budgetWarning: true,
        },
      });
      console.warn(`[task-engine] Budget uyarısı: ${budgetStatus.message}`);
    }

    const updated = (await updateTask(taskId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    }))!;

    // projectId budget kontrolünde zaten tanımlandı, tekrar tanımlamaya gerek yok
    eventBus.emit({
      projectId,
      type: 'task:started',
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
    if (task.status !== 'waiting_approval') {
      throw new Error(`Task ${taskId} onay beklemiyor (status: ${task.status})`);
    }

    const updated = (await updateTask(taskId, {
      status: 'queued',
      approvalStatus: 'approved',
    }))!;

    const projectId = await this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:approved',
      taskId,
      payload: {
        title: task.title,
        taskTitle: task.title,
        agentName: task.assignedAgent,
      },
    });

    console.log(`[task-engine] Task ${taskId} onaylandı: "${task.title}" — kuyruğa alındı`);
    return updated;
  }

  /**
   * Bekleyen onay task'ını reddeder.
   * Task 'failed' durumuna alınır, execution devam etmez.
   */
  async rejectTask(taskId: string, reason?: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (task.status !== 'waiting_approval') {
      throw new Error(`Task ${taskId} onay beklemiyor (status: ${task.status})`);
    }

    const rejectionReason = reason ?? 'Kullanıcı tarafından reddedildi';

    const updated = (await updateTask(taskId, {
      status: 'failed',
      approvalStatus: 'rejected',
      approvalRejectionReason: rejectionReason,
      error: `Onay reddedildi: ${rejectionReason}`,
    }))!;

    const projectId = await this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:rejected',
      taskId,
      payload: {
        title: task.title,
        taskTitle: task.title,
        agentName: task.assignedAgent,
        reason: rejectionReason,
      },
    });

    console.log(`[task-engine] Task ${taskId} reddedildi: "${task.title}" — sebep: ${rejectionReason}`);
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
  async completeTask(taskId: string, output: TaskOutput): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (task.status !== 'running' && task.status !== 'revision') {
      throw new Error(`Task ${taskId} is not running or in revision (status: ${task.status})`);
    }

    const projectId = await this.getProjectIdForTask(task);

    // Review task'ları için tekrar review araması yapma (sonsuz döngü önleme)
    const isReviewTask = task.title.startsWith('Code Review: ');

    // v2: Review dependency kontrolü
    const reviewer = isReviewTask ? null : await this.findReviewerForTask(projectId, task);

    if (reviewer) {
      // Review loop: task'ı review durumuna al
      const updated = (await updateTask(taskId, {
        status: 'review',
        output,
        reviewerAgentId: reviewer.id,
        reviewStatus: null,
      }))!;

      // Create a real review task for the reviewer agent (visible in pipeline/board)
      const reviewTask = await createTask({
        phaseId: task.phaseId,
        title: `Code Review: ${task.title}`,
        description: `${reviewer.name} tarafından "${task.title}" task'ının kod incelemesi. Dosyalar: ${[...output.filesCreated, ...output.filesModified].slice(0, 5).join(', ') || 'N/A'}`,
        assignedAgent: reviewer.id,
        complexity: 'S' as any,
        dependsOn: [taskId],
        branch: task.branch || 'main',
      });

      // Link the review task to the original task
      await updateTask(taskId, { reviewTaskId: reviewTask.id } as any);

      eventBus.emit({
        projectId,
        type: 'task:completed' as any,
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

      console.log(`[task-engine] Task ${taskId} review'a gönderildi → reviewer: ${reviewer.name} — review task: ${reviewTask.id}`);

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
      status: 'done',
      output,
      completedAt: new Date().toISOString(),
      reviewStatus: 'approved',
    }))!;

    eventBus.emit({
      projectId,
      type: 'task:completed',
      taskId,
      payload: {
        title: task.title,
        filesCreated: output.filesCreated.length,
        filesModified: output.filesModified.length,
        testResults: output.testResults,
      },
    });

    await this.checkAndAdvancePhase(task.phaseId, projectId);
    this.notifyCompleted(taskId, projectId);

    // Record to memory tables for Memory page
    const proj = await getProject(projectId);
    if (proj) {
      const agents = await listProjectAgents(projectId);
      const agent = agents.find(a => a.id === task.assignedAgentId);
      recordAgentStep(
        projectId,
        proj.name,
        task.assignedAgentId || task.assignedAgent,
        agent?.name || task.assignedAgent,
        task.title,
        output.summary || null,
      ).catch(() => {});
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
    if (task.status !== 'review') {
      throw new Error(`Task ${taskId} is not in review (status: ${task.status})`);
    }

    const projectId = await this.getProjectIdForTask(task);

    if (approved) {
      // Onay → done
      const updated = (await updateTask(taskId, {
        status: 'done',
        reviewStatus: 'approved',
        completedAt: new Date().toISOString(),
      }))!;

      eventBus.emit({
        projectId,
        type: 'task:completed',
        taskId,
        payload: {
          title: task.title,
          reviewApproved: true,
          reviewerAgentId: task.reviewerAgentId,
        },
      });

      console.log(`[task-engine] Task ${taskId} review onaylandı`);

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
      status: 'revision',
      reviewStatus: 'rejected',
      revisionCount: newRevisionCount,
      error: feedback ? `Review red: ${feedback}` : 'Review reddedildi',
    }))!;

    eventBus.emit({
      projectId,
      type: 'task:failed' as any,
      taskId,
      payload: {
        title: task.title,
        reviewRejected: true,
        revisionCount: newRevisionCount,
        feedback,
        reviewerAgentId: task.reviewerAgentId,
      },
    });

    console.log(`[task-engine] Task ${taskId} revision'a gönderildi (döngü ${newRevisionCount}/${MAX_REVISION_CYCLES})`);

    return updated;
  }

  /**
   * Max revision döngüsü aşıldığında tech-lead'e eskalasyon.
   */
  private async escalateTask(taskId: string, task: Task, projectId: string, feedback?: string): Promise<Task> {
    // Tech lead'i bul
    const agents = await listProjectAgents(projectId);
    const techLead = agents.find((a) => a.role === 'tech-lead');

    const escalationTarget = techLead?.name ?? 'Tech Lead';
    const escalationAgentId = techLead?.id;

    const updated = (await updateTask(taskId, {
      status: 'failed',
      reviewStatus: 'rejected',
      error: `Max review döngüsü aşıldı (${MAX_REVISION_CYCLES}x). Eskalasyon: ${escalationTarget}. Son feedback: ${feedback ?? 'N/A'}`,
      assignedAgentId: escalationAgentId,
    }))!;

    eventBus.emit({
      projectId,
      type: 'escalation:user' as any,
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

    console.warn(`[task-engine] Task ${taskId} eskalasyon: ${escalationTarget} (${MAX_REVISION_CYCLES} review döngüsü aşıldı)`);

    return updated;
  }

  /**
   * Revision durumundaki task'ı dev agent'a geri gönderir (running durumuna alır).
   */
  async restartRevision(taskId: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (task.status !== 'revision') {
      throw new Error(`Task ${taskId} is not in revision (status: ${task.status})`);
    }

    const updated = (await updateTask(taskId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      reviewStatus: null,
    }))!;

    const projectId = await this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:started',
      taskId,
      payload: {
        title: task.title,
        isRevision: true,
        revisionCount: task.revisionCount,
      },
    });

    console.log(`[task-engine] Task ${taskId} revision'dan tekrar çalışmaya alındı (döngü ${task.revisionCount})`);

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
    const deps = await listAgentDependencies(projectId, 'review');

    if (deps.length === 0) return null;

    // Task'ın atandığı agent'ı bul
    const assigned = task.assignedAgent ?? '';
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
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not running (status: ${task.status})`);
    }

    const updated = (await updateTask(taskId, { status: 'failed', error }))!;
    const projectId = await this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:failed',
      taskId,
      payload: { title: task.title, error },
    });

    return updated;
  }

  async retryTask(taskId: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (task.status !== 'failed') {
      throw new Error(`Task ${taskId} is not failed (status: ${task.status})`);
    }

    const updated = (await updateTask(taskId, {
      status: 'queued',
      retryCount: task.retryCount + 1,
    }))!;

    const projectId = await this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:retry',
      taskId,
      payload: { title: task.title, retryCount: updated.retryCount },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Dependency resolution
  // -------------------------------------------------------------------------

  async getReadyTasks(phaseId: string): Promise<Task[]> {
    const tasks = await listTasks(phaseId);
    const ready: Task[] = [];
    for (const task of tasks) {
      if (task.status !== 'queued') continue;
      if (task.dependsOn.length === 0) {
        ready.push(task);
        continue;
      }

      const isReviewTask = task.title.startsWith('Code Review: ');

      let allDepsDone = true;
      for (const depId of task.dependsOn) {
        const dep = await getTask(depId);
        // Review tasks can start when original task is in 'review' status
        const depSatisfied = dep?.status === 'done' || (isReviewTask && dep?.status === 'review');
        if (!depSatisfied) {
          allDepsDone = false;
          break;
        }
      }
      if (allDepsDone) ready.push(task);
    }
    return ready;
  }

  async isPhaseComplete(phaseId: string): Promise<boolean> {
    const tasks = await listTasks(phaseId);
    if (tasks.length === 0) return false;
    // review durumundaki task'lar phase ilerlemesini bloklamaz —
    // review task ayrı çalışır, bitince orijinal task done olur
    return tasks.every((t) => t.status === 'done' || t.status === 'review');
  }

  async isPhaseFailed(phaseId: string): Promise<boolean> {
    const tasks = await listTasks(phaseId);
    return tasks.some((t) => t.status === 'failed');
  }

  // -------------------------------------------------------------------------
  // Phase progression
  // -------------------------------------------------------------------------

  async startPhase(projectId: string, phaseId: string): Promise<Task[]> {
    await updatePhaseStatus(phaseId, 'running');

    eventBus.emit({
      projectId,
      type: 'phase:started',
      payload: { phaseId },
    });

    return this.getReadyTasks(phaseId);
  }

  async getNextPhase(projectId: string): Promise<Phase | null> {
    const plan = await getLatestPlan(projectId);
    if (!plan || plan.status !== 'approved') return null;

    for (const phase of plan.phases) {
      if (phase.status === 'pending') {
        const depsComplete = phase.dependsOn.every((depId) => {
          const depPhase = plan.phases.find((p) => p.id === depId);
          return depPhase?.status === 'completed';
        });
        if (depsComplete) return phase;
      }
    }

    return null;
  }

  async isProjectComplete(projectId: string): Promise<boolean> {
    const plan = await getLatestPlan(projectId);
    if (!plan) return false;
    return plan.phases.every((p) => p.status === 'completed');
  }

  // -------------------------------------------------------------------------
  // Auto-advance
  // -------------------------------------------------------------------------

  private async checkAndAdvancePhase(phaseId: string, projectId: string): Promise<void> {
    if (!(await this.isPhaseComplete(phaseId))) return;

    await updatePhaseStatus(phaseId, 'completed');

    eventBus.emit({
      projectId,
      type: 'phase:completed',
      payload: { phaseId },
    });

    const nextPhase = await this.getNextPhase(projectId);
    if (nextPhase) {
      await this.startPhase(projectId, nextPhase.id);
    } else if (await this.isProjectComplete(projectId)) {
      await updateProject(projectId, { status: 'completed' });
    }
  }

  // -------------------------------------------------------------------------
  // Full execution (after plan approval)
  // -------------------------------------------------------------------------

  async beginExecution(projectId: string): Promise<Task[]> {
    const project = await getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const plan = await getLatestPlan(projectId);
    if (!plan || plan.status !== 'approved') {
      throw new Error(`Project ${projectId} has no approved plan`);
    }

    await updateProject(projectId, { status: 'running' });

    const firstPhase = await this.getNextPhase(projectId);
    if (!firstPhase) throw new Error('No phase is ready to start');

    return this.startPhase(projectId, firstPhase.id);
  }

  // -------------------------------------------------------------------------
  // Progress summary
  // -------------------------------------------------------------------------

  async getProgress(projectId: string) {
    const plan = await getLatestPlan(projectId);
    if (!plan) {
      return { phases: [], overall: { total: 0, done: 0, running: 0, failed: 0, queued: 0, review: 0, revision: 0, waitingApproval: 0 } };
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
      const tasksDone = tasks.filter((t) => t.status === 'done').length;
      total += tasks.length;
      done += tasksDone;
      running += tasks.filter((t) => t.status === 'running').length;
      failed += tasks.filter((t) => t.status === 'failed').length;
      queued += tasks.filter((t) => t.status === 'queued' || t.status === 'assigned').length;
      review += tasks.filter((t) => t.status === 'review').length;
      revision += tasks.filter((t) => t.status === 'revision').length;
      // Human-in-the-Loop: Onay bekleyen task sayısını takip et
      waitingApproval += tasks.filter((t) => t.status === 'waiting_approval').length;

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

  private async getProjectIdForTask(task: Task): Promise<string> {
    const row = await queryOne<{ project_id: string }>(`
      SELECT pp.project_id FROM tasks t
      JOIN phases p ON t.phase_id = p.id
      JOIN project_plans pp ON p.plan_id = pp.id
      WHERE t.id = $1
    `, [task.id]);
    return row?.project_id ?? '';
  }
}

export const taskEngine = new TaskEngine();
