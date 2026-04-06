// ---------------------------------------------------------------------------
// AI Dev Studio — SQLite Database (better-sqlite3)
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Project,
  ProjectStatus,
  ProjectPlan,
  PlanStatus,
  Phase,
  PhaseStatus,
  Task,
  TaskStatus,
  TaskComplexity,
  TaskOutput,
  AgentConfig,
  AgentRole,
  CLITool,
  StudioEvent,
  EventType,
  ChatMessage,
  ChatRole,
} from './types.js';

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = process.env.STUDIO_DB_PATH || './.voltagent/studio.db';
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    migrate(_db);
  }
  return _db;
}

/** Reset DB connection (used by tests). */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'planning',
      tech_stack    TEXT NOT NULL DEFAULT '[]',
      repo_path     TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_plans (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version     INTEGER NOT NULL DEFAULT 1,
      status      TEXT NOT NULL DEFAULT 'draft',
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS phases (
      id          TEXT PRIMARY KEY,
      plan_id     TEXT NOT NULL REFERENCES project_plans(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      "order"     INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending',
      depends_on  TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id              TEXT PRIMARY KEY,
      phase_id        TEXT NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      assigned_agent  TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'queued',
      complexity      TEXT NOT NULL DEFAULT 'M',
      depends_on      TEXT NOT NULL DEFAULT '[]',
      branch          TEXT NOT NULL DEFAULT '',
      output          TEXT,
      retry_count     INTEGER NOT NULL DEFAULT 0,
      started_at      TEXT,
      completed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_configs (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL,
      avatar        TEXT NOT NULL DEFAULT '',
      personality   TEXT NOT NULL DEFAULT '',
      model         TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      cli_tool      TEXT NOT NULL DEFAULT 'claude-code',
      skills        TEXT NOT NULL DEFAULT '[]',
      system_prompt TEXT NOT NULL DEFAULT '',
      is_preset     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      agent_id    TEXT,
      task_id     TEXT,
      payload     TEXT NOT NULL DEFAULT '{}',
      timestamp   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plans_project   ON project_plans(project_id);
    CREATE INDEX IF NOT EXISTS idx_phases_plan     ON phases(plan_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_phase     ON tasks(phase_id);
    CREATE INDEX IF NOT EXISTS idx_events_project  ON events(project_id);
    CREATE INDEX IF NOT EXISTS idx_chat_project    ON chat_messages(project_id);
  `);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

export function createProject(data: Pick<Project, 'name' | 'description' | 'techStack' | 'repoPath'>): Project {
  const db = getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO projects (id, name, description, status, tech_stack, repo_path, created_at, updated_at)
    VALUES (?, ?, ?, 'planning', ?, ?, ?, ?)
  `).run(id, data.name, data.description, JSON.stringify(data.techStack), data.repoPath, ts, ts);
  return getProject(id)!;
}

export function getProject(id: string): Project | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  return row ? rowToProject(row) : undefined;
}

export function listProjects(): Project[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[]).map(rowToProject);
}

export function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'description' | 'status' | 'techStack' | 'repoPath'>>): Project | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.techStack !== undefined) { fields.push('tech_stack = ?'); values.push(JSON.stringify(data.techStack)); }
  if (data.repoPath !== undefined) { fields.push('repo_path = ?'); values.push(data.repoPath); }

  if (fields.length === 0) return getProject(id);

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as ProjectStatus,
    techStack: JSON.parse(row.tech_stack),
    repoPath: row.repo_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Plans CRUD
// ---------------------------------------------------------------------------

export function createPlan(projectId: string): ProjectPlan {
  const db = getDb();
  const id = randomUUID();
  const maxVersion = (db.prepare('SELECT MAX(version) as v FROM project_plans WHERE project_id = ?').get(projectId) as any)?.v ?? 0;
  const version = maxVersion + 1;
  const ts = now();

  db.prepare(`
    INSERT INTO project_plans (id, project_id, version, status, created_at)
    VALUES (?, ?, ?, 'draft', ?)
  `).run(id, projectId, version, ts);

  return { id, projectId, version, status: 'draft', phases: [], createdAt: ts };
}

export function getPlan(id: string): ProjectPlan | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM project_plans WHERE id = ?').get(id) as any;
  if (!row) return undefined;
  const phases = listPhases(id);
  return { id: row.id, projectId: row.project_id, version: row.version, status: row.status as PlanStatus, phases, createdAt: row.created_at };
}

export function getLatestPlan(projectId: string): ProjectPlan | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM project_plans WHERE project_id = ? ORDER BY version DESC LIMIT 1').get(projectId) as any;
  if (!row) return undefined;
  return getPlan(row.id);
}

export function updatePlanStatus(id: string, status: PlanStatus): void {
  const db = getDb();
  db.prepare('UPDATE project_plans SET status = ? WHERE id = ?').run(status, id);
}

// ---------------------------------------------------------------------------
// Phases CRUD
// ---------------------------------------------------------------------------

export function createPhase(data: Pick<Phase, 'planId' | 'name' | 'order' | 'dependsOn'>): Phase {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO phases (id, plan_id, name, "order", status, depends_on)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, data.planId, data.name, data.order, JSON.stringify(data.dependsOn));
  return { id, planId: data.planId, name: data.name, order: data.order, status: 'pending', tasks: [], dependsOn: data.dependsOn };
}

export function listPhases(planId: string): Phase[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM phases WHERE plan_id = ? ORDER BY "order"').all(planId) as any[];
  return rows.map((row) => ({
    id: row.id,
    planId: row.plan_id,
    name: row.name,
    order: row.order,
    status: row.status as PhaseStatus,
    tasks: listTasks(row.id),
    dependsOn: JSON.parse(row.depends_on),
  }));
}

export function updatePhaseStatus(id: string, status: PhaseStatus): void {
  const db = getDb();
  db.prepare('UPDATE phases SET status = ? WHERE id = ?').run(status, id);
}

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

export function createTask(data: Pick<Task, 'phaseId' | 'title' | 'description' | 'assignedAgent' | 'complexity' | 'dependsOn' | 'branch'>): Task {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tasks (id, phase_id, title, description, assigned_agent, status, complexity, depends_on, branch, retry_count)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, 0)
  `).run(id, data.phaseId, data.title, data.description, data.assignedAgent, data.complexity, JSON.stringify(data.dependsOn), data.branch);

  return {
    id,
    phaseId: data.phaseId,
    title: data.title,
    description: data.description,
    assignedAgent: data.assignedAgent,
    status: 'queued',
    complexity: data.complexity,
    dependsOn: data.dependsOn,
    branch: data.branch,
    retryCount: 0,
  };
}

export function getTask(id: string): Task | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
  return row ? rowToTask(row) : undefined;
}

export function listTasks(phaseId: string): Task[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM tasks WHERE phase_id = ?').all(phaseId) as any[]).map(rowToTask);
}

export function listProjectTasks(projectId: string): Task[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN phases p ON t.phase_id = p.id
    JOIN project_plans pp ON p.plan_id = pp.id
    WHERE pp.project_id = ?
    ORDER BY p."order", t.id
  `).all(projectId) as any[];
  return rows.map(rowToTask);
}

export function updateTask(id: string, data: Partial<Pick<Task, 'status' | 'assignedAgent' | 'output' | 'retryCount' | 'startedAt' | 'completedAt'>>): Task | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.assignedAgent !== undefined) { fields.push('assigned_agent = ?'); values.push(data.assignedAgent); }
  if (data.output !== undefined) { fields.push('output = ?'); values.push(JSON.stringify(data.output)); }
  if (data.retryCount !== undefined) { fields.push('retry_count = ?'); values.push(data.retryCount); }
  if (data.startedAt !== undefined) { fields.push('started_at = ?'); values.push(data.startedAt); }
  if (data.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(data.completedAt); }

  if (fields.length === 0) return getTask(id);

  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getTask(id);
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    phaseId: row.phase_id,
    title: row.title,
    description: row.description,
    assignedAgent: row.assigned_agent,
    status: row.status as TaskStatus,
    complexity: row.complexity as TaskComplexity,
    dependsOn: JSON.parse(row.depends_on),
    branch: row.branch,
    output: row.output ? JSON.parse(row.output) : undefined,
    retryCount: row.retry_count,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Agent Configs CRUD
// ---------------------------------------------------------------------------

export function createAgentConfig(data: Omit<AgentConfig, 'id'>): AgentConfig {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO agent_configs (id, name, role, avatar, personality, model, cli_tool, skills, system_prompt, is_preset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.role, data.avatar, data.personality, data.model, data.cliTool, JSON.stringify(data.skills), data.systemPrompt, data.isPreset ? 1 : 0);
  return { id, ...data };
}

export function getAgentConfig(id: string): AgentConfig | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agent_configs WHERE id = ?').get(id) as any;
  return row ? rowToAgentConfig(row) : undefined;
}

export function listAgentConfigs(): AgentConfig[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM agent_configs ORDER BY name').all() as any[]).map(rowToAgentConfig);
}

export function listPresetAgents(): AgentConfig[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM agent_configs WHERE is_preset = 1 ORDER BY name').all() as any[]).map(rowToAgentConfig);
}

export function updateAgentConfig(id: string, data: Partial<Omit<AgentConfig, 'id'>>): AgentConfig | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.role !== undefined) { fields.push('role = ?'); values.push(data.role); }
  if (data.avatar !== undefined) { fields.push('avatar = ?'); values.push(data.avatar); }
  if (data.personality !== undefined) { fields.push('personality = ?'); values.push(data.personality); }
  if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
  if (data.cliTool !== undefined) { fields.push('cli_tool = ?'); values.push(data.cliTool); }
  if (data.skills !== undefined) { fields.push('skills = ?'); values.push(JSON.stringify(data.skills)); }
  if (data.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(data.systemPrompt); }
  if (data.isPreset !== undefined) { fields.push('is_preset = ?'); values.push(data.isPreset ? 1 : 0); }

  if (fields.length === 0) return getAgentConfig(id);

  values.push(id);
  db.prepare(`UPDATE agent_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getAgentConfig(id);
}

export function deleteAgentConfig(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM agent_configs WHERE id = ? AND is_preset = 0').run(id);
  return result.changes > 0;
}

function rowToAgentConfig(row: any): AgentConfig {
  return {
    id: row.id,
    name: row.name,
    role: row.role as AgentRole,
    avatar: row.avatar,
    personality: row.personality,
    model: row.model,
    cliTool: row.cli_tool as CLITool,
    skills: JSON.parse(row.skills),
    systemPrompt: row.system_prompt,
    isPreset: row.is_preset === 1,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function insertEvent(data: Omit<StudioEvent, 'id' | 'timestamp'>): StudioEvent {
  const db = getDb();
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`
    INSERT INTO events (id, project_id, type, agent_id, task_id, payload, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.projectId, data.type, data.agentId ?? null, data.taskId ?? null, JSON.stringify(data.payload), timestamp);
  return { id, ...data, timestamp };
}

export function listEvents(projectId: string, limit = 100): StudioEvent[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?').all(projectId, limit) as any[]).map(rowToEvent);
}

function rowToEvent(row: any): StudioEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type as EventType,
    agentId: row.agent_id ?? undefined,
    taskId: row.task_id ?? undefined,
    payload: JSON.parse(row.payload),
    timestamp: row.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Chat Messages
// ---------------------------------------------------------------------------

export function insertChatMessage(data: Pick<ChatMessage, 'projectId' | 'role' | 'content'>): ChatMessage {
  const db = getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO chat_messages (id, project_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.projectId, data.role, data.content, ts);
  return { id, ...data, createdAt: ts };
}

export function listChatMessages(projectId: string): ChatMessage[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at').all(projectId) as any[]).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    role: row.role as ChatRole,
    content: row.content,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Seed preset agents
// ---------------------------------------------------------------------------

export function seedPresetAgents(): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM agent_configs WHERE is_preset = 1').get() as any).c;
  if (count > 0) return;

  const presets: Omit<AgentConfig, 'id'>[] = [
    {
      name: 'Kerem',
      role: 'pm',
      avatar: '📋',
      personality: 'Organized, detail-oriented, communicative',
      model: 'claude-sonnet-4-6',
      cliTool: 'none',
      skills: ['project-management', 'planning', 'communication'],
      systemPrompt: `You are Kerem, a senior Project Manager for AI Dev Studio.
Your role:
1. Understand user's project requirements through conversation
2. Ask clarifying questions about tech stack, features, scope
3. Create a structured project plan with phases and tasks
4. Assign tasks to appropriate team members
5. Monitor progress and handle escalations

When creating a plan, use the createProjectPlan tool.
Break work into small, focused tasks that can be done independently.
Identify dependencies between tasks accurately.`,
      isPreset: true,
    },
    {
      name: 'Atlas',
      role: 'architect',
      avatar: '🏗️',
      personality: 'Analytical, systematic, thorough',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['system-design', 'database', 'api-design', 'documentation'],
      systemPrompt: `You are Atlas, a senior Software Architect.
Your role:
1. Design system architecture based on project requirements
2. Create database schemas and API contracts
3. Write architecture documentation
4. Review code for architectural consistency
5. Make technology decisions and document rationale`,
      isPreset: true,
    },
    {
      name: 'Nova',
      role: 'frontend',
      avatar: '🎨',
      personality: 'Creative, detail-oriented, user-focused',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['react', 'typescript', 'tailwindcss', 'ui-design', 'accessibility'],
      systemPrompt: `You are Nova, a senior Frontend Developer.
Your role:
1. Build responsive UI components following design specs
2. Implement client-side state management
3. Ensure accessibility and performance
4. Write unit and integration tests for components
5. Follow the project's coding standards and component patterns`,
      isPreset: true,
    },
    {
      name: 'Forge',
      role: 'backend',
      avatar: '⚙️',
      personality: 'Pragmatic, security-conscious, performance-oriented',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['node.js', 'typescript', 'postgresql', 'rest-api', 'authentication'],
      systemPrompt: `You are Forge, a senior Backend Developer.
Your role:
1. Implement API endpoints following the API contract
2. Build database queries and migrations
3. Handle authentication and authorization
4. Write unit and integration tests
5. Ensure security best practices and input validation`,
      isPreset: true,
    },
    {
      name: 'Shield',
      role: 'qa',
      avatar: '🛡️',
      personality: 'Meticulous, thorough, quality-focused',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['testing', 'e2e', 'test-automation', 'bug-reporting'],
      systemPrompt: `You are Shield, a senior QA Engineer.
Your role:
1. Write comprehensive test suites (unit, integration, e2e)
2. Identify edge cases and potential bugs
3. Verify features meet acceptance criteria
4. Report bugs with clear reproduction steps
5. Ensure test coverage meets project standards`,
      isPreset: true,
    },
    {
      name: 'Sentinel',
      role: 'reviewer',
      avatar: '👁️',
      personality: 'Critical, constructive, detail-oriented',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['code-review', 'best-practices', 'security', 'performance'],
      systemPrompt: `You are Sentinel, a senior Code Reviewer.
Your role:
1. Review pull requests for quality and correctness
2. Check adherence to coding standards
3. Identify security vulnerabilities
4. Suggest performance improvements
5. Ensure documentation is adequate`,
      isPreset: true,
    },
  ];

  for (const preset of presets) {
    createAgentConfig(preset);
  }
}
