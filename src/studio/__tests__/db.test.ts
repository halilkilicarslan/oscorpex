import { describe, it, expect, beforeAll } from 'vitest';
import {
  getDb,
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  createPlan,
  getPlan,
  getLatestPlan,
  updatePlanStatus,
  createPhase,
  createTask,
  getTask,
  listProjectTasks,
  updateTask,
  createAgentConfig,
  listAgentConfigs,
  listPresetAgents,
  deleteAgentConfig,
  seedPresetAgents,
  insertEvent,
  listEvents,
  insertChatMessage,
  listChatMessages,
} from '../db.js';

// Use in-memory DB for tests by overriding the module-level DB path
// We achieve this by calling getDb() which initialises on first call
// The DB is file-based, so we reset between runs by deleting records

describe('Studio DB', () => {
  beforeAll(() => {
    // Initialise DB (creates tables)
    getDb();
  });

  // ---- Projects -----------------------------------------------------------

  describe('Projects', () => {
    it('should create and retrieve a project', () => {
      const project = createProject({
        name: 'Test App',
        description: 'A test project',
        techStack: ['React', 'Node.js'],
        repoPath: '/tmp/test-app',
      });

      expect(project.id).toBeTruthy();
      expect(project.name).toBe('Test App');
      expect(project.status).toBe('planning');
      expect(project.techStack).toEqual(['React', 'Node.js']);

      const fetched = getProject(project.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Test App');
    });

    it('should list projects', () => {
      const projects = listProjects();
      expect(projects.length).toBeGreaterThan(0);
    });

    it('should update a project', () => {
      const project = createProject({
        name: 'Update Test',
        description: '',
        techStack: [],
        repoPath: '',
      });
      const updated = updateProject(project.id, { status: 'running', techStack: ['Vue'] });
      expect(updated!.status).toBe('running');
      expect(updated!.techStack).toEqual(['Vue']);
    });

    it('should delete a project', () => {
      const project = createProject({ name: 'Delete Me', description: '', techStack: [], repoPath: '' });
      expect(deleteProject(project.id)).toBe(true);
      expect(getProject(project.id)).toBeUndefined();
    });
  });

  // ---- Plans & Phases & Tasks ---------------------------------------------

  describe('Plans, Phases, Tasks', () => {
    it('should create a full plan hierarchy', () => {
      const project = createProject({ name: 'Plan Test', description: '', techStack: [], repoPath: '' });
      const plan = createPlan(project.id);

      expect(plan.version).toBe(1);
      expect(plan.status).toBe('draft');

      const phase = createPhase({ planId: plan.id, name: 'Foundation', order: 1, dependsOn: [] });
      expect(phase.status).toBe('pending');

      const task = createTask({
        phaseId: phase.id,
        title: 'Setup project',
        description: 'Initialize the project',
        assignedAgent: 'agent-1',
        complexity: 'S',
        dependsOn: [],
        branch: 'feat/setup',
      });
      expect(task.status).toBe('queued');
      expect(task.retryCount).toBe(0);

      // Retrieve full plan with phases and tasks
      const fullPlan = getPlan(plan.id);
      expect(fullPlan!.phases).toHaveLength(1);
      expect(fullPlan!.phases[0].tasks).toHaveLength(1);
      expect(fullPlan!.phases[0].tasks[0].title).toBe('Setup project');
    });

    it('should update task status', () => {
      const project = createProject({ name: 'Task Test', description: '', techStack: [], repoPath: '' });
      const plan = createPlan(project.id);
      const phase = createPhase({ planId: plan.id, name: 'P1', order: 1, dependsOn: [] });
      const task = createTask({ phaseId: phase.id, title: 'T1', description: '', assignedAgent: '', complexity: 'M', dependsOn: [], branch: '' });

      const updated = updateTask(task.id, { status: 'running', startedAt: new Date().toISOString() });
      expect(updated!.status).toBe('running');
      expect(updated!.startedAt).toBeTruthy();
    });

    it('should list project tasks across phases', () => {
      const project = createProject({ name: 'Multi Phase', description: '', techStack: [], repoPath: '' });
      const plan = createPlan(project.id);
      const p1 = createPhase({ planId: plan.id, name: 'P1', order: 1, dependsOn: [] });
      const p2 = createPhase({ planId: plan.id, name: 'P2', order: 2, dependsOn: [p1.id] });
      createTask({ phaseId: p1.id, title: 'T1', description: '', assignedAgent: '', complexity: 'S', dependsOn: [], branch: '' });
      createTask({ phaseId: p2.id, title: 'T2', description: '', assignedAgent: '', complexity: 'L', dependsOn: [], branch: '' });

      const tasks = listProjectTasks(project.id);
      expect(tasks).toHaveLength(2);
    });

    it('should get latest plan', () => {
      const project = createProject({ name: 'Version Test', description: '', techStack: [], repoPath: '' });
      createPlan(project.id);
      const plan2 = createPlan(project.id);

      const latest = getLatestPlan(project.id);
      expect(latest!.version).toBe(2);
      expect(latest!.id).toBe(plan2.id);
    });

    it('should update plan status', () => {
      const project = createProject({ name: 'Approve Test', description: '', techStack: [], repoPath: '' });
      const plan = createPlan(project.id);
      updatePlanStatus(plan.id, 'approved');
      const fetched = getPlan(plan.id);
      expect(fetched!.status).toBe('approved');
    });
  });

  // ---- Agent Configs ------------------------------------------------------

  describe('Agent Configs', () => {
    it('should create and list agent configs', () => {
      const agent = createAgentConfig({
        name: 'TestBot',
        role: 'coder',
        avatar: '🤖',
        gender: 'male',
        personality: 'Helpful',
        model: 'claude-sonnet-4-6',
        cliTool: 'claude-code',
        skills: ['typescript'],
        systemPrompt: 'You are a test bot.',
        isPreset: false,
      });

      expect(agent.id).toBeTruthy();
      const all = listAgentConfigs();
      expect(all.some((a) => a.id === agent.id)).toBe(true);
    });

    it('should not delete preset agents', () => {
      const preset = createAgentConfig({
        name: 'Preset',
        role: 'pm',
        avatar: '📋',
        gender: 'male',
        personality: '',
        model: 'claude-sonnet-4-6',
        cliTool: 'none',
        skills: [],
        systemPrompt: '',
        isPreset: true,
      });

      expect(deleteAgentConfig(preset.id)).toBe(false);
    });

    it('should seed preset agents only once', () => {
      seedPresetAgents();
      const presets1 = listPresetAgents();
      seedPresetAgents(); // idempotent
      const presets2 = listPresetAgents();
      expect(presets1.length).toBe(presets2.length);
      expect(presets1.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- Events -------------------------------------------------------------

  describe('Events', () => {
    it('should insert and list events', () => {
      const project = createProject({ name: 'Event Test', description: '', techStack: [], repoPath: '' });
      insertEvent({ projectId: project.id, type: 'task:started', payload: { foo: 'bar' } });
      insertEvent({ projectId: project.id, type: 'task:completed', agentId: 'a1', taskId: 't1', payload: {} });

      const events = listEvents(project.id);
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.type)).toContain('task:completed');
    });
  });

  // ---- Chat Messages ------------------------------------------------------

  describe('Chat Messages', () => {
    it('should insert and list chat messages', () => {
      const project = createProject({ name: 'Chat Test', description: '', techStack: [], repoPath: '' });
      insertChatMessage({ projectId: project.id, role: 'user', content: 'Hello PM' });
      insertChatMessage({ projectId: project.id, role: 'assistant', content: 'Hi! How can I help?' });

      const messages = listChatMessages(project.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user'); // ASC order
      expect(messages[1].role).toBe('assistant');
    });
  });
});
