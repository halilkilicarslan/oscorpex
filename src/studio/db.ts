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
  AIProvider,
  AIProviderType,
  ProjectAgent,
  TeamTemplate,
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

    CREATE TABLE IF NOT EXISTS ai_providers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'openai',
      api_key    TEXT NOT NULL DEFAULT '',
      base_url   TEXT NOT NULL DEFAULT '',
      model      TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plans_project   ON project_plans(project_id);
    CREATE INDEX IF NOT EXISTS idx_phases_plan     ON phases(plan_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_phase     ON tasks(phase_id);
    CREATE INDEX IF NOT EXISTS idx_events_project  ON events(project_id);
    CREATE INDEX IF NOT EXISTS idx_chat_project    ON chat_messages(project_id);

    -- Hazır takım şablonları (team templates)
    CREATE TABLE IF NOT EXISTS team_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      agent_ids   TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL
    );

    -- Projeye özel agent kopyaları (project-scoped team members)
    CREATE TABLE IF NOT EXISTS project_agents (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_agent_id TEXT,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL,
      avatar          TEXT NOT NULL DEFAULT '',
      personality     TEXT NOT NULL DEFAULT '',
      model           TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      cli_tool        TEXT NOT NULL DEFAULT 'claude-code',
      skills          TEXT NOT NULL DEFAULT '[]',
      system_prompt   TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_project_agents_project ON project_agents(project_id);
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

/**
 * Append log lines to a task's output.logs without replacing other output fields.
 * Safe to call from streaming contexts — reads current state then writes atomically.
 */
export function appendTaskLogs(taskId: string, logs: string[]): void {
  if (logs.length === 0) return;
  const task = getTask(taskId);
  if (!task) return;

  const currentOutput: TaskOutput = task.output ?? { filesCreated: [], filesModified: [], logs: [] };
  currentOutput.logs.push(...logs);

  const db = getDb();
  db.prepare('UPDATE tasks SET output = ? WHERE id = ?').run(JSON.stringify(currentOutput), taskId);
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
// AI Providers CRUD
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return key ? '***' : '';
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

function rowToProvider(row: any, masked = false): AIProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AIProviderType,
    apiKey: masked ? maskApiKey(row.api_key) : row.api_key,
    baseUrl: row.base_url,
    model: row.model,
    isDefault: row.is_default === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProvider(
  data: Pick<AIProvider, 'name' | 'type' | 'apiKey' | 'baseUrl' | 'model' | 'isActive'>,
): AIProvider {
  const db = getDb();
  const id = randomUUID();
  const ts = now();

  // Auto-set as default if it is the very first provider
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM ai_providers').get() as any).c;
  const isDefault = existingCount === 0 ? 1 : 0;

  db.prepare(`
    INSERT INTO ai_providers (id, name, type, api_key, base_url, model, is_default, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.type,
    data.apiKey,
    data.baseUrl,
    data.model,
    isDefault,
    data.isActive ? 1 : 0,
    ts,
    ts,
  );

  return getProvider(id)!;
}

export function getProvider(id: string): AIProvider | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as any;
  return row ? rowToProvider(row, true) : undefined;
}

export function listProviders(): AIProvider[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM ai_providers ORDER BY created_at ASC').all() as any[]).map((r) =>
    rowToProvider(r, true),
  );
}

export function updateProvider(
  id: string,
  data: Partial<Pick<AIProvider, 'name' | 'type' | 'apiKey' | 'baseUrl' | 'model' | 'isActive'>>,
): AIProvider | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type); }
  if (data.apiKey !== undefined) { fields.push('api_key = ?'); values.push(data.apiKey); }
  if (data.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(data.baseUrl); }
  if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
  if (data.isActive !== undefined) { fields.push('is_active = ?'); values.push(data.isActive ? 1 : 0); }

  if (fields.length === 0) return getProvider(id);

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  db.prepare(`UPDATE ai_providers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProvider(id);
}

export function deleteProvider(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as any;
  if (!row) return { success: false, error: 'Provider not found' };
  if (row.is_default === 1) {
    return { success: false, error: 'Cannot delete the default provider. Set another provider as default first.' };
  }
  db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
  return { success: true };
}

export function setDefaultProvider(id: string): AIProvider | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as any;
  if (!row) return undefined;

  // Use a transaction to swap default atomically
  const swap = db.transaction(() => {
    db.prepare('UPDATE ai_providers SET is_default = 0, updated_at = ?').run(now());
    db.prepare('UPDATE ai_providers SET is_default = 1, updated_at = ? WHERE id = ?').run(now(), id);
  });
  swap();

  return getProvider(id);
}

export function getDefaultProvider(): AIProvider | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_providers WHERE is_default = 1 LIMIT 1').get() as any;
  // Return with unmasked key — for backend usage
  return row ? rowToProvider(row, false) : undefined;
}

/** Returns the raw (unmasked) API key for a provider — for internal backend use only. */
export function getRawProviderApiKey(id: string): string {
  const db = getDb();
  const row = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get(id) as any;
  return row?.api_key ?? '';
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
    // Solo Coder şablonu için tam-yığın geliştirici
    {
      name: 'Pixel',
      role: 'coder',
      avatar: '💻',
      personality: 'Versatile, fast, pragmatic',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['full-stack', 'typescript', 'react', 'node.js', 'database', 'testing'],
      systemPrompt: `You are Pixel, a senior Full-Stack Developer.
Your role:
1. Implement features end-to-end (frontend + backend)
2. Write clean, well-tested code
3. Handle database queries and API endpoints
4. Ensure code quality and best practices
5. Work independently on all parts of the stack`,
      isPreset: true,
    },
  ];

  for (const preset of presets) {
    createAgentConfig(preset);
  }
}

// ---------------------------------------------------------------------------
// Seed team templates (hazır takım şablonlarını veritabanına ekle)
// ---------------------------------------------------------------------------

export function seedTeamTemplates(): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM team_templates').get() as any).c;
  // Zaten veri varsa tekrar ekleme
  if (count > 0) return;

  const templates = [
    {
      name: 'Full Stack Team',
      description: 'Complete team with PM, architect, frontend, backend, QA, and code reviewer',
      roles: ['pm', 'architect', 'frontend', 'backend', 'qa', 'reviewer'],
    },
    {
      name: 'Frontend Team',
      description: 'Focused team for frontend projects with PM, frontend dev, and QA',
      roles: ['pm', 'frontend', 'qa'],
    },
    {
      name: 'Backend Team',
      description: 'Focused team for backend/API projects with PM, architect, backend dev, and QA',
      roles: ['pm', 'architect', 'backend', 'qa'],
    },
    {
      name: 'Solo Coder',
      description: 'Minimal team with PM and a single full-stack coder agent',
      roles: ['pm', 'coder'],
    },
  ];

  for (const t of templates) {
    db.prepare(
      'INSERT INTO team_templates (id, name, description, agent_ids, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      randomUUID(),
      t.name,
      t.description,
      // agent_ids sütunu aslında rolleri saklar — preset agent eşlemesi role üzerinden yapılır
      JSON.stringify(t.roles),
      now(),
    );
  }
}

// ---------------------------------------------------------------------------
// Team Templates — okuma fonksiyonları
// ---------------------------------------------------------------------------

function rowToTeamTemplate(row: any): TeamTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // agent_ids sütununda roller saklanır
    roles: JSON.parse(row.agent_ids),
    createdAt: row.created_at,
  };
}

export function listTeamTemplates(): TeamTemplate[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM team_templates ORDER BY name').all() as any[]).map(rowToTeamTemplate);
}

export function getTeamTemplate(id: string): TeamTemplate | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM team_templates WHERE id = ?').get(id) as any;
  return row ? rowToTeamTemplate(row) : undefined;
}

// ---------------------------------------------------------------------------
// Project Agents CRUD
// ---------------------------------------------------------------------------

function rowToProjectAgent(row: any): ProjectAgent {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceAgentId: row.source_agent_id ?? undefined,
    name: row.name,
    role: row.role as AgentRole | string,
    avatar: row.avatar,
    personality: row.personality,
    model: row.model,
    cliTool: row.cli_tool as CLITool,
    skills: JSON.parse(row.skills),
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
  };
}

export function createProjectAgent(data: {
  projectId: string;
  sourceAgentId?: string;
  name: string;
  role: string;
  avatar: string;
  personality: string;
  model: string;
  cliTool: string;
  skills: string[];
  systemPrompt: string;
}): ProjectAgent {
  const db = getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO project_agents
      (id, project_id, source_agent_id, name, role, avatar, personality, model, cli_tool, skills, system_prompt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.projectId,
    data.sourceAgentId ?? null,
    data.name,
    data.role,
    data.avatar,
    data.personality,
    data.model,
    data.cliTool,
    JSON.stringify(data.skills),
    data.systemPrompt,
    ts,
  );
  return getProjectAgent(id)!;
}

export function getProjectAgent(id: string): ProjectAgent | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM project_agents WHERE id = ?').get(id) as any;
  return row ? rowToProjectAgent(row) : undefined;
}

export function listProjectAgents(projectId: string): ProjectAgent[] {
  const db = getDb();
  return (
    db.prepare('SELECT * FROM project_agents WHERE project_id = ? ORDER BY created_at').all(projectId) as any[]
  ).map(rowToProjectAgent);
}

export function updateProjectAgent(
  id: string,
  data: Partial<Omit<ProjectAgent, 'id' | 'projectId' | 'createdAt'>>,
): ProjectAgent | undefined {
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
  if (data.sourceAgentId !== undefined) { fields.push('source_agent_id = ?'); values.push(data.sourceAgentId); }

  if (fields.length === 0) return getProjectAgent(id);

  values.push(id);
  db.prepare(`UPDATE project_agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProjectAgent(id);
}

export function deleteProjectAgent(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM project_agents WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Belirtilen rollere sahip preset agentları projeye kopyalar.
 * Template'de tanımlı roller ile preset agentlar rol üzerinden eşleştirilir.
 */
export function copyAgentsToProject(projectId: string, roles: string[]): ProjectAgent[] {
  const presets = listPresetAgents();
  const created: ProjectAgent[] = [];

  for (const role of roles) {
    const preset = presets.find((p) => p.role === role);
    if (preset) {
      const agent = createProjectAgent({
        projectId,
        sourceAgentId: preset.id,
        name: preset.name,
        role: preset.role,
        avatar: preset.avatar,
        personality: preset.personality,
        model: preset.model,
        cliTool: preset.cliTool,
        skills: preset.skills,
        systemPrompt: preset.systemPrompt,
      });
      created.push(agent);
    }
  }

  return created;
}
