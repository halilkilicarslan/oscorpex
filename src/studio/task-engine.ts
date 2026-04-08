// ---------------------------------------------------------------------------
// AI Dev Studio — Task Engine v2
// Manages task lifecycle, dependency resolution, phase progression
// v2: Review loop, escalation, revision support
// ---------------------------------------------------------------------------

import {
  getDb,
  getTask,
  updateTask,
  listTasks,
  updatePhaseStatus,
  getLatestPlan,
  updateProject,
  getProject,
  listProjectAgents,
  listAgentDependencies,
} from './db.js';
import { eventBus } from './event-bus.js';
import type { Task, Phase, TaskOutput, ProjectAgent } from './types.js';

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

  assignTask(taskId: string, agentId: string): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'queued') {
      throw new Error(`Task ${taskId} is not queued (status: ${task.status})`);
    }

    const updated = updateTask(taskId, { status: 'assigned', assignedAgent: agentId })!;
    const projectId = this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:assigned',
      taskId,
      agentId,
      payload: { title: task.title },
    });

    return updated;
  }

  startTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'assigned' && task.status !== 'queued') {
      throw new Error(`Task ${taskId} cannot be started (status: ${task.status})`);
    }

    const updated = updateTask(taskId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })!;

    const projectId = this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:started',
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
  completeTask(taskId: string, output: TaskOutput): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'running' && task.status !== 'revision') {
      throw new Error(`Task ${taskId} is not running or in revision (status: ${task.status})`);
    }

    const projectId = this.getProjectIdForTask(task);

    // v2: Review dependency kontrolü
    const reviewer = this.findReviewerForTask(projectId, task);

    if (reviewer) {
      // Review loop: task'ı review durumuna al
      const updated = updateTask(taskId, {
        status: 'review',
        output,
        reviewerAgentId: reviewer.id,
        reviewStatus: null,
      })!;

      eventBus.emit({
        projectId,
        type: 'task:completed' as any, // review'a gönderildi ama output kaydedildi
        taskId,
        payload: {
          title: task.title,
          filesCreated: output.filesCreated.length,
          filesModified: output.filesModified.length,
          testResults: output.testResults,
          reviewRequired: true,
          reviewerAgentId: reviewer.id,
          reviewerName: reviewer.name,
        },
      });

      console.log(`[task-engine] Task ${taskId} review'a gönderildi → reviewer: ${reviewer.name} (${reviewer.role})`);
      return updated;
    }

    // Normal akış: doğrudan done
    return this.markTaskDone(taskId, output, projectId, task);
  }

  /**
   * Task'ı doğrudan 'done' olarak işaretler ve pipeline'ı bilgilendirir.
   */
  private markTaskDone(taskId: string, output: TaskOutput, projectId: string, task: Task): Task {
    const updated = updateTask(taskId, {
      status: 'done',
      output,
      completedAt: new Date().toISOString(),
      reviewStatus: 'approved',
    })!;

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

    this.checkAndAdvancePhase(task.phaseId, projectId);
    this.notifyCompleted(taskId, projectId);

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
  submitReview(taskId: string, approved: boolean, feedback?: string): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'review') {
      throw new Error(`Task ${taskId} is not in review (status: ${task.status})`);
    }

    const projectId = this.getProjectIdForTask(task);

    if (approved) {
      // Onay → done
      const updated = updateTask(taskId, {
        status: 'done',
        reviewStatus: 'approved',
        completedAt: new Date().toISOString(),
      })!;

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

      this.checkAndAdvancePhase(task.phaseId, projectId);
      this.notifyCompleted(taskId, projectId);

      return updated;
    }

    // Red → revision
    const newRevisionCount = task.revisionCount + 1;

    if (newRevisionCount >= MAX_REVISION_CYCLES) {
      // Eskalasyon: tech-lead'e yönlendir
      return this.escalateTask(taskId, task, projectId, feedback);
    }

    const updated = updateTask(taskId, {
      status: 'revision',
      reviewStatus: 'rejected',
      revisionCount: newRevisionCount,
      error: feedback ? `Review red: ${feedback}` : 'Review reddedildi',
    })!;

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
  private escalateTask(taskId: string, task: Task, projectId: string, feedback?: string): Task {
    // Tech lead'i bul
    const agents = listProjectAgents(projectId);
    const techLead = agents.find((a) => a.role === 'tech-lead');

    const escalationTarget = techLead?.name ?? 'Tech Lead';
    const escalationAgentId = techLead?.id;

    const updated = updateTask(taskId, {
      status: 'failed',
      reviewStatus: 'rejected',
      error: `Max review döngüsü aşıldı (${MAX_REVISION_CYCLES}x). Eskalasyon: ${escalationTarget}. Son feedback: ${feedback ?? 'N/A'}`,
      assignedAgentId: escalationAgentId,
    })!;

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
  restartRevision(taskId: string): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'revision') {
      throw new Error(`Task ${taskId} is not in revision (status: ${task.status})`);
    }

    const updated = updateTask(taskId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      reviewStatus: null,
    })!;

    const projectId = this.getProjectIdForTask(task);

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
  private findReviewerForTask(projectId: string, task: Task): ProjectAgent | null {
    const agents = listProjectAgents(projectId);
    const deps = listAgentDependencies(projectId, 'review');

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

  failTask(taskId: string, error: string): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not running (status: ${task.status})`);
    }

    const updated = updateTask(taskId, { status: 'failed', error })!;
    const projectId = this.getProjectIdForTask(task);

    eventBus.emit({
      projectId,
      type: 'task:failed',
      taskId,
      payload: { title: task.title, error },
    });

    return updated;
  }

  retryTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'failed') {
      throw new Error(`Task ${taskId} is not failed (status: ${task.status})`);
    }

    const updated = updateTask(taskId, {
      status: 'queued',
      retryCount: task.retryCount + 1,
    })!;

    const projectId = this.getProjectIdForTask(task);

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

  getReadyTasks(phaseId: string): Task[] {
    const tasks = listTasks(phaseId);
    return tasks.filter((task) => {
      if (task.status !== 'queued') return false;
      if (task.dependsOn.length === 0) return true;
      return task.dependsOn.every((depId) => {
        const dep = getTask(depId);
        return dep?.status === 'done';
      });
    });
  }

  isPhaseComplete(phaseId: string): boolean {
    const tasks = listTasks(phaseId);
    if (tasks.length === 0) return false;
    return tasks.every((t) => t.status === 'done');
  }

  isPhaseFailed(phaseId: string): boolean {
    const tasks = listTasks(phaseId);
    return tasks.some((t) => t.status === 'failed');
  }

  // -------------------------------------------------------------------------
  // Phase progression
  // -------------------------------------------------------------------------

  startPhase(projectId: string, phaseId: string): Task[] {
    updatePhaseStatus(phaseId, 'running');

    eventBus.emit({
      projectId,
      type: 'phase:started',
      payload: { phaseId },
    });

    return this.getReadyTasks(phaseId);
  }

  getNextPhase(projectId: string): Phase | null {
    const plan = getLatestPlan(projectId);
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

  isProjectComplete(projectId: string): boolean {
    const plan = getLatestPlan(projectId);
    if (!plan) return false;
    return plan.phases.every((p) => p.status === 'completed');
  }

  // -------------------------------------------------------------------------
  // Auto-advance
  // -------------------------------------------------------------------------

  private checkAndAdvancePhase(phaseId: string, projectId: string): void {
    if (!this.isPhaseComplete(phaseId)) return;

    updatePhaseStatus(phaseId, 'completed');

    eventBus.emit({
      projectId,
      type: 'phase:completed',
      payload: { phaseId },
    });

    const nextPhase = this.getNextPhase(projectId);
    if (nextPhase) {
      this.startPhase(projectId, nextPhase.id);
    } else if (this.isProjectComplete(projectId)) {
      updateProject(projectId, { status: 'completed' });
    }
  }

  // -------------------------------------------------------------------------
  // Full execution (after plan approval)
  // -------------------------------------------------------------------------

  beginExecution(projectId: string): Task[] {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const plan = getLatestPlan(projectId);
    if (!plan || plan.status !== 'approved') {
      throw new Error(`Project ${projectId} has no approved plan`);
    }

    updateProject(projectId, { status: 'running' });

    const firstPhase = this.getNextPhase(projectId);
    if (!firstPhase) throw new Error('No phase is ready to start');

    return this.startPhase(projectId, firstPhase.id);
  }

  // -------------------------------------------------------------------------
  // Progress summary
  // -------------------------------------------------------------------------

  getProgress(projectId: string) {
    const plan = getLatestPlan(projectId);
    if (!plan) {
      return { phases: [], overall: { total: 0, done: 0, running: 0, failed: 0, queued: 0, review: 0, revision: 0 } };
    }

    let total = 0;
    let done = 0;
    let running = 0;
    let failed = 0;
    let queued = 0;
    let review = 0;
    let revision = 0;

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

      return {
        id: phase.id,
        name: phase.name,
        status: phase.status,
        tasksDone,
        tasksTotal: tasks.length,
      };
    });

    return { phases, overall: { total, done, running, failed, queued, review, revision } };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private requireTask(taskId: string): Task {
    const task = getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return task;
  }

  private getProjectIdForTask(task: Task): string {
    const db = getDb();
    const row = db.prepare(`
      SELECT pp.project_id FROM tasks t
      JOIN phases p ON t.phase_id = p.id
      JOIN project_plans pp ON p.plan_id = pp.id
      WHERE t.id = ?
    `).get(task.id) as any;
    return row?.project_id ?? '';
  }
}

export const taskEngine = new TaskEngine();
