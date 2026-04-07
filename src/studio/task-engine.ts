// ---------------------------------------------------------------------------
// AI Dev Studio — Task Engine
// Manages task lifecycle, dependency resolution, phase progression
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
} from './db.js';
import { eventBus } from './event-bus.js';
import type { Task, Phase, TaskOutput } from './types.js';

// Görev tamamlandığında çağrılacak callback tipi
// Pipeline engine bu callback'i kullanarak aşama ilerlemesini kontrol eder
type TaskCompletionCallback = (taskId: string, projectId: string) => void;

class TaskEngine {
  // Görev tamamlandığında bildirim gönderilecek callback listesi
  private completionCallbacks: Set<TaskCompletionCallback> = new Set();

  // -------------------------------------------------------------------------
  // Callback kayıt mekanizması (pipeline engine için hook noktası)
  // -------------------------------------------------------------------------

  /** Görev tamamlandığında çağrılacak bir callback kaydeder; temizleme fonksiyonu döner */
  onTaskCompleted(callback: TaskCompletionCallback): () => void {
    this.completionCallbacks.add(callback);
    return () => { this.completionCallbacks.delete(callback); };
  }

  /** Kayıtlı tüm tamamlama callback'lerini tetikler */
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

  completeTask(taskId: string, output: TaskOutput): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not running (status: ${task.status})`);
    }

    const updated = updateTask(taskId, {
      status: 'done',
      output,
      completedAt: new Date().toISOString(),
    })!;

    const projectId = this.getProjectIdForTask(task);

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

    // Auto-advance phase
    this.checkAndAdvancePhase(task.phaseId, projectId);

    // Pipeline engine'e görev tamamlandığını bildir
    this.notifyCompleted(taskId, projectId);

    return updated;
  }

  failTask(taskId: string, error: string): Task {
    const task = this.requireTask(taskId);
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not running (status: ${task.status})`);
    }

    const updated = updateTask(taskId, { status: 'failed' })!;
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
      return { phases: [], overall: { total: 0, done: 0, running: 0, failed: 0, queued: 0 } };
    }

    let total = 0;
    let done = 0;
    let running = 0;
    let failed = 0;
    let queued = 0;

    const phases = plan.phases.map((phase) => {
      const tasks = phase.tasks;
      const tasksDone = tasks.filter((t) => t.status === 'done').length;
      total += tasks.length;
      done += tasksDone;
      running += tasks.filter((t) => t.status === 'running').length;
      failed += tasks.filter((t) => t.status === 'failed').length;
      queued += tasks.filter((t) => t.status === 'queued' || t.status === 'assigned').length;

      return {
        id: phase.id,
        name: phase.name,
        status: phase.status,
        tasksDone,
        tasksTotal: tasks.length,
      };
    });

    return { phases, overall: { total, done, running, failed, queued } };
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
