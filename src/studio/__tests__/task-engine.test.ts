import { describe, it, expect, beforeAll } from 'vitest';
import {
  getDb,
  createProject,
  createPlan,
  createPhase,
  createTask,
  updatePlanStatus,
  getTask,
  getProject,
} from '../db.js';
import { taskEngine } from '../task-engine.js';

describe('Task Engine', () => {
  beforeAll(() => {
    getDb();
  });

  function setupProjectWithPlan() {
    const project = createProject({ name: 'TE Test', description: '', techStack: [], repoPath: '' });
    const plan = createPlan(project.id);
    updatePlanStatus(plan.id, 'approved');

    const p1 = createPhase({ planId: plan.id, name: 'Foundation', order: 1, dependsOn: [] });
    const t1 = createTask({
      phaseId: p1.id, title: 'Setup', description: 'Init project',
      assignedAgent: 'coder', complexity: 'S', dependsOn: [], branch: 'feat/setup',
    });
    const t2 = createTask({
      phaseId: p1.id, title: 'Config', description: 'Add config',
      assignedAgent: 'coder', complexity: 'S', dependsOn: [t1.id], branch: 'feat/config',
    });

    return { project, plan, phase: p1, t1, t2 };
  }

  // ---- Task lifecycle -----------------------------------------------------

  describe('Task Lifecycle', () => {
    it('should assign a queued task', () => {
      const { t1 } = setupProjectWithPlan();
      const updated = taskEngine.assignTask(t1.id, 'agent-123');
      expect(updated.status).toBe('assigned');
    });

    it('should start an assigned task', () => {
      const { t1 } = setupProjectWithPlan();
      taskEngine.assignTask(t1.id, 'agent-123');
      const updated = taskEngine.startTask(t1.id);
      expect(updated.status).toBe('running');
      expect(updated.startedAt).toBeTruthy();
    });

    it('should complete a running task', () => {
      const { t1 } = setupProjectWithPlan();
      taskEngine.assignTask(t1.id, 'agent-123');
      taskEngine.startTask(t1.id);
      const updated = taskEngine.completeTask(t1.id, {
        filesCreated: ['src/index.ts'],
        filesModified: [],
        logs: ['done'],
      });
      expect(updated.status).toBe('done');
      expect(updated.completedAt).toBeTruthy();
      expect(updated.output?.filesCreated).toEqual(['src/index.ts']);
    });

    it('should fail a running task', () => {
      const { t1 } = setupProjectWithPlan();
      taskEngine.assignTask(t1.id, 'agent-123');
      taskEngine.startTask(t1.id);
      const updated = taskEngine.failTask(t1.id, 'compile error');
      expect(updated.status).toBe('failed');
    });

    it('should retry a failed task', () => {
      const { t1 } = setupProjectWithPlan();
      taskEngine.assignTask(t1.id, 'agent-123');
      taskEngine.startTask(t1.id);
      taskEngine.failTask(t1.id, 'error');
      const updated = taskEngine.retryTask(t1.id);
      expect(updated.status).toBe('queued');
      expect(updated.retryCount).toBe(1);
    });

    it('should throw on invalid state transitions', () => {
      const { t1 } = setupProjectWithPlan();
      // Can't complete a queued task
      expect(() => taskEngine.completeTask(t1.id, { filesCreated: [], filesModified: [], logs: [] }))
        .toThrow('not running');
      // Can't fail a queued task
      expect(() => taskEngine.failTask(t1.id, 'err')).toThrow('not running');
      // Can't retry a queued task
      expect(() => taskEngine.retryTask(t1.id)).toThrow('not failed');
    });
  });

  // ---- Dependency resolution ----------------------------------------------

  describe('Dependency Resolution', () => {
    it('should return tasks with no dependencies as ready', () => {
      const { phase, t1 } = setupProjectWithPlan();
      const ready = taskEngine.getReadyTasks(phase.id);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(t1.id);
    });

    it('should unblock dependent tasks after completion', () => {
      const { phase, t1, t2 } = setupProjectWithPlan();

      // t2 depends on t1, so only t1 is ready
      let ready = taskEngine.getReadyTasks(phase.id);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(t1.id);

      // Complete t1
      taskEngine.assignTask(t1.id, 'agent-1');
      taskEngine.startTask(t1.id);
      taskEngine.completeTask(t1.id, { filesCreated: [], filesModified: [], logs: [] });

      // Now t2 should be ready
      ready = taskEngine.getReadyTasks(phase.id);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(t2.id);
    });
  });

  // ---- Phase progression --------------------------------------------------

  describe('Phase Progression', () => {
    it('should detect phase completion', () => {
      const { phase, t1, t2 } = setupProjectWithPlan();

      expect(taskEngine.isPhaseComplete(phase.id)).toBe(false);

      // Complete both tasks
      taskEngine.assignTask(t1.id, 'a1');
      taskEngine.startTask(t1.id);
      taskEngine.completeTask(t1.id, { filesCreated: [], filesModified: [], logs: [] });

      taskEngine.assignTask(t2.id, 'a2');
      taskEngine.startTask(t2.id);
      taskEngine.completeTask(t2.id, { filesCreated: [], filesModified: [], logs: [] });

      expect(taskEngine.isPhaseComplete(phase.id)).toBe(true);
    });

    it('should detect phase failure', () => {
      const { phase, t1 } = setupProjectWithPlan();
      taskEngine.assignTask(t1.id, 'a1');
      taskEngine.startTask(t1.id);
      taskEngine.failTask(t1.id, 'error');

      expect(taskEngine.isPhaseFailed(phase.id)).toBe(true);
    });
  });

  // ---- Execution flow -----------------------------------------------------

  describe('Execution Flow', () => {
    it('should begin execution and return ready tasks', () => {
      const { project } = setupProjectWithPlan();
      const readyTasks = taskEngine.beginExecution(project.id);
      expect(readyTasks.length).toBeGreaterThan(0);

      const proj = getProject(project.id);
      expect(proj?.status).toBe('running');
    });

    it('should throw if no approved plan', () => {
      const project = createProject({ name: 'No Plan', description: '', techStack: [], repoPath: '' });
      expect(() => taskEngine.beginExecution(project.id)).toThrow('no approved plan');
    });
  });

  // ---- Progress -----------------------------------------------------------

  describe('Progress', () => {
    it('should return progress summary', () => {
      const { project, t1, t2 } = setupProjectWithPlan();
      taskEngine.beginExecution(project.id);

      const progress = taskEngine.getProgress(project.id);
      expect(progress.phases).toHaveLength(1);
      expect(progress.overall.total).toBe(2);
      // t1 is queued (ready), t2 is queued (blocked)
      expect(progress.overall.queued).toBe(2);
    });
  });
});
