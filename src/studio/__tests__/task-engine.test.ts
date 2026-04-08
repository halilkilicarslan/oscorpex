import { describe, it, expect, beforeAll } from 'vitest';
import {
  createProject,
  createPlan,
  createPhase,
  createTask,
  updatePlanStatus,
  getProject,
} from '../db.js';
import { execute } from '../pg.js';
import { taskEngine } from '../task-engine.js';

describe('Task Engine', () => {
  beforeAll(async () => {
    // Clean up tables so tests start with a known empty state
    await execute('DELETE FROM chat_messages');
    await execute('DELETE FROM events');
    await execute('DELETE FROM tasks');
    await execute('DELETE FROM phases');
    await execute('DELETE FROM plans');
    await execute('DELETE FROM project_agents');
    await execute('DELETE FROM projects');
  });

  async function setupProjectWithPlan() {
    const project = await createProject({ name: 'TE Test', description: '', techStack: [], repoPath: '' });
    const plan = await createPlan(project.id);
    await updatePlanStatus(plan.id, 'approved');

    const p1 = await createPhase({ planId: plan.id, name: 'Foundation', order: 1, dependsOn: [] });
    const t1 = await createTask({
      phaseId: p1.id, title: 'Setup', description: 'Init project',
      assignedAgent: 'coder', complexity: 'S', dependsOn: [], branch: 'feat/setup',
    });
    const t2 = await createTask({
      phaseId: p1.id, title: 'Config', description: 'Add config',
      assignedAgent: 'coder', complexity: 'S', dependsOn: [t1.id], branch: 'feat/config',
    });

    return { project, plan, phase: p1, t1, t2 };
  }

  // ---- Task lifecycle -----------------------------------------------------

  describe('Task Lifecycle', () => {
    it('should assign a queued task', async () => {
      const { t1 } = await setupProjectWithPlan();
      const updated = await taskEngine.assignTask(t1.id, 'agent-123');
      expect(updated.status).toBe('assigned');
    });

    it('should start an assigned task', async () => {
      const { t1 } = await setupProjectWithPlan();
      await taskEngine.assignTask(t1.id, 'agent-123');
      const updated = await taskEngine.startTask(t1.id);
      expect(updated.status).toBe('running');
      expect(updated.startedAt).toBeTruthy();
    });

    it('should complete a running task', async () => {
      const { t1 } = await setupProjectWithPlan();
      await taskEngine.assignTask(t1.id, 'agent-123');
      await taskEngine.startTask(t1.id);
      const updated = await taskEngine.completeTask(t1.id, {
        filesCreated: ['src/index.ts'],
        filesModified: [],
        logs: ['done'],
      });
      expect(updated.status).toBe('done');
      expect(updated.completedAt).toBeTruthy();
      expect(updated.output?.filesCreated).toEqual(['src/index.ts']);
    });

    it('should fail a running task', async () => {
      const { t1 } = await setupProjectWithPlan();
      await taskEngine.assignTask(t1.id, 'agent-123');
      await taskEngine.startTask(t1.id);
      const updated = await taskEngine.failTask(t1.id, 'compile error');
      expect(updated.status).toBe('failed');
    });

    it('should retry a failed task', async () => {
      const { t1 } = await setupProjectWithPlan();
      await taskEngine.assignTask(t1.id, 'agent-123');
      await taskEngine.startTask(t1.id);
      await taskEngine.failTask(t1.id, 'error');
      const updated = await taskEngine.retryTask(t1.id);
      expect(updated.status).toBe('queued');
      expect(updated.retryCount).toBe(1);
    });

    it('should throw on invalid state transitions', async () => {
      const { t1 } = await setupProjectWithPlan();
      // Can't complete a queued task
      await expect(taskEngine.completeTask(t1.id, { filesCreated: [], filesModified: [], logs: [] }))
        .rejects.toThrow('not running');
      // Can't fail a queued task
      await expect(taskEngine.failTask(t1.id, 'err')).rejects.toThrow('not running');
      // Can't retry a queued task
      await expect(taskEngine.retryTask(t1.id)).rejects.toThrow('not failed');
    });
  });

  // ---- Dependency resolution ----------------------------------------------

  describe('Dependency Resolution', () => {
    it('should return tasks with no dependencies as ready', async () => {
      const { phase, t1 } = await setupProjectWithPlan();
      const ready = await taskEngine.getReadyTasks(phase.id);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(t1.id);
    });

    it('should unblock dependent tasks after completion', async () => {
      const { phase, t1, t2 } = await setupProjectWithPlan();

      // t2 depends on t1, so only t1 is ready
      let ready = await taskEngine.getReadyTasks(phase.id);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(t1.id);

      // Complete t1
      await taskEngine.assignTask(t1.id, 'agent-1');
      await taskEngine.startTask(t1.id);
      await taskEngine.completeTask(t1.id, { filesCreated: [], filesModified: [], logs: [] });

      // Now t2 should be ready
      ready = await taskEngine.getReadyTasks(phase.id);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(t2.id);
    });
  });

  // ---- Phase progression --------------------------------------------------

  describe('Phase Progression', () => {
    it('should detect phase completion', async () => {
      const { phase, t1, t2 } = await setupProjectWithPlan();

      expect(await taskEngine.isPhaseComplete(phase.id)).toBe(false);

      // Complete both tasks
      await taskEngine.assignTask(t1.id, 'a1');
      await taskEngine.startTask(t1.id);
      await taskEngine.completeTask(t1.id, { filesCreated: [], filesModified: [], logs: [] });

      await taskEngine.assignTask(t2.id, 'a2');
      await taskEngine.startTask(t2.id);
      await taskEngine.completeTask(t2.id, { filesCreated: [], filesModified: [], logs: [] });

      expect(await taskEngine.isPhaseComplete(phase.id)).toBe(true);
    });

    it('should detect phase failure', async () => {
      const { phase, t1 } = await setupProjectWithPlan();
      await taskEngine.assignTask(t1.id, 'a1');
      await taskEngine.startTask(t1.id);
      await taskEngine.failTask(t1.id, 'error');

      expect(await taskEngine.isPhaseFailed(phase.id)).toBe(true);
    });
  });

  // ---- Execution flow -----------------------------------------------------

  describe('Execution Flow', () => {
    it('should begin execution and return ready tasks', async () => {
      const { project } = await setupProjectWithPlan();
      const readyTasks = await taskEngine.beginExecution(project.id);
      expect(readyTasks.length).toBeGreaterThan(0);

      const proj = await getProject(project.id);
      expect(proj?.status).toBe('running');
    });

    it('should throw if no approved plan', async () => {
      const project = await createProject({ name: 'No Plan', description: '', techStack: [], repoPath: '' });
      await expect(taskEngine.beginExecution(project.id)).rejects.toThrow('no approved plan');
    });
  });

  // ---- Progress -----------------------------------------------------------

  describe('Progress', () => {
    it('should return progress summary', async () => {
      const { project } = await setupProjectWithPlan();
      await taskEngine.beginExecution(project.id);

      const progress = await taskEngine.getProgress(project.id);
      expect(progress.phases).toHaveLength(1);
      expect(progress.overall.total).toBe(2);
      // t1 is queued (ready), t2 is queued (blocked)
      expect(progress.overall.queued).toBe(2);
    });
  });
});
