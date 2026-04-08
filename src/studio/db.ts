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
  PipelineRun,
  PipelineStatus,
  AgentRun,
  AgentProcessStatus,
  AgentDependency,
  DependencyType,
  AgentCapability,
  CapabilityScopeType,
  CapabilityPermission,
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
      created_at      TEXT NOT NULL,
      reports_to      TEXT,
      color           TEXT NOT NULL DEFAULT '#22c55e',
      pipeline_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_project_agents_project ON project_agents(project_id);

    -- Ajanlar arası mesajlaşma tablosu (agent-to-agent communication)
    CREATE TABLE IF NOT EXISTS agent_messages (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      from_agent_id     TEXT NOT NULL,
      to_agent_id       TEXT NOT NULL,
      type              TEXT NOT NULL,
      subject           TEXT NOT NULL,
      content           TEXT NOT NULL,
      metadata          TEXT NOT NULL DEFAULT '{}',
      status            TEXT NOT NULL DEFAULT 'unread',
      parent_message_id TEXT,
      created_at        TEXT NOT NULL,
      read_at           TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_messages_project  ON agent_messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_to_agent ON agent_messages(to_agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_from_agent ON agent_messages(from_agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_parent   ON agent_messages(parent_message_id);

    -- Pipeline çalıştırma kayıtları (pipeline execution runs)
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL UNIQUE,
      current_stage INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'idle',
      stages_json   TEXT NOT NULL DEFAULT '[]',
      started_at    TEXT,
      completed_at  TEXT,
      created_at    TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project ON pipeline_runs(project_id);

    -- Agent dependencies (v2 org structure — workflow, review, gate relationships)
    CREATE TABLE IF NOT EXISTS agent_dependencies (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_agent_id   TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
      to_agent_id     TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
      type            TEXT NOT NULL DEFAULT 'workflow',
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_deps_project ON agent_dependencies(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_deps_from    ON agent_dependencies(from_agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_deps_to      ON agent_dependencies(to_agent_id);

    -- Agent capabilities (file scope restrictions per agent)
    CREATE TABLE IF NOT EXISTS agent_capabilities (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scope_type  TEXT NOT NULL DEFAULT 'path',
      pattern     TEXT NOT NULL,
      permission  TEXT NOT NULL DEFAULT 'readwrite'
    );

    CREATE INDEX IF NOT EXISTS idx_agent_caps_agent   ON agent_capabilities(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_caps_project  ON agent_capabilities(project_id);
  `);

  // Additive migrations for existing databases — safe to run on every startup
  const existingCols = (db.prepare("PRAGMA table_info(project_agents)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!existingCols.includes('reports_to')) {
    db.exec("ALTER TABLE project_agents ADD COLUMN reports_to TEXT");
  }
  if (!existingCols.includes('color')) {
    db.exec("ALTER TABLE project_agents ADD COLUMN color TEXT NOT NULL DEFAULT '#22c55e'");
  }
  if (!existingCols.includes('pipeline_order')) {
    db.exec("ALTER TABLE project_agents ADD COLUMN pipeline_order INTEGER NOT NULL DEFAULT 0");
  }
  if (!existingCols.includes('gender')) {
    db.exec("ALTER TABLE project_agents ADD COLUMN gender TEXT NOT NULL DEFAULT 'male'");
  }

  // agent_configs tablosuna gender kolonu ekle
  const agentConfigCols = (db.prepare("PRAGMA table_info(agent_configs)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!agentConfigCols.includes('gender')) {
    db.exec("ALTER TABLE agent_configs ADD COLUMN gender TEXT NOT NULL DEFAULT 'male'");
  }

  // Data migration: Update preset agents with name, avatar, gender, role (v1 → v2)
  const AVATAR_BASE = 'https://untitledui.com/images/avatars';
  const PRESET_MIGRATION: Record<string, { name: string; avatar: string; gender: string; newRole: string }> = {
    pm:       { name: 'Olivia Rhye',     avatar: `${AVATAR_BASE}/olivia-rhye`, gender: 'female', newRole: 'product-owner' },
    architect:{ name: 'Zahir Mays',      avatar: `${AVATAR_BASE}/zahir-mays`, gender: 'male', newRole: 'tech-lead' },
    frontend: { name: 'Sophia Perez',    avatar: `${AVATAR_BASE}/sophia-perez`, gender: 'female', newRole: 'frontend-dev' },
    backend:  { name: 'Drew Cano',       avatar: `${AVATAR_BASE}/drew-cano`, gender: 'male', newRole: 'backend-dev' },
    qa:       { name: 'Levi Rocha',      avatar: `${AVATAR_BASE}/levi-rocha`, gender: 'male', newRole: 'backend-qa' },
    reviewer: { name: 'Ethan Campbell',  avatar: `${AVATAR_BASE}/ethan-campbell`, gender: 'male', newRole: 'frontend-reviewer' },
    // coder preset siliniyor — frontend-dev ile birleştirildi
    coder:    { name: '__DELETE__', avatar: '', gender: 'male', newRole: '__DELETE__' },
    designer: { name: 'Amelie Laurent',  avatar: `${AVATAR_BASE}/amelie-laurent`, gender: 'female', newRole: 'design-lead' },
    devops:   { name: 'Joshua Wilson',   avatar: `${AVATAR_BASE}/joshua-wilson`, gender: 'male', newRole: 'devops' },
  };
  const updateConfig = db.prepare('UPDATE agent_configs SET name = ?, avatar = ?, gender = ?, role = ? WHERE role = ? AND is_preset = 1');
  const updateProjectAgent = db.prepare('UPDATE project_agents SET name = ?, avatar = ?, gender = ?, role = ? WHERE source_agent_id IN (SELECT id FROM agent_configs WHERE role = ? AND is_preset = 1)');
  const deleteConfig = db.prepare('DELETE FROM agent_configs WHERE role = ? AND is_preset = 1');
  for (const [oldRole, data] of Object.entries(PRESET_MIGRATION)) {
    if (data.newRole === '__DELETE__') {
      // Remove deprecated preset (e.g. coder merged into frontend-dev)
      deleteConfig.run(oldRole);
      continue;
    }
    updateConfig.run(data.name, data.avatar, data.gender, data.newRole, oldRole);
    updateProjectAgent.run(data.name, data.avatar, data.gender, data.newRole, oldRole);
  }

  // tasks tablosuna error kolonu ekle
  const taskCols = (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  if (!taskCols.includes('error')) {
    db.exec("ALTER TABLE tasks ADD COLUMN error TEXT");
  }
  if (!taskCols.includes('task_type')) {
    db.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'ai'");
  }
  if (!taskCols.includes('review_status')) {
    db.exec("ALTER TABLE tasks ADD COLUMN review_status TEXT");
  }
  if (!taskCols.includes('reviewer_agent_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN reviewer_agent_id TEXT");
  }
  if (!taskCols.includes('revision_count')) {
    db.exec("ALTER TABLE tasks ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!taskCols.includes('assigned_agent_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN assigned_agent_id TEXT");
  }

  // Agent çalışma geçmişi tablosu — yerel CLI süreç kayıtları
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      cli_tool        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'idle',
      task_prompt     TEXT,
      output_summary  TEXT,
      pid             INTEGER,
      exit_code       INTEGER,
      started_at      TEXT,
      stopped_at      TEXT,
      created_at      TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (agent_id)   REFERENCES project_agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent   ON agent_runs(agent_id);
  `);

  // Token kullanım ve maliyet takibi tablosu
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      task_id         TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      model           TEXT NOT NULL,
      provider        TEXT NOT NULL DEFAULT '',
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      total_tokens    INTEGER NOT NULL DEFAULT 0,
      cost_usd        REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_project ON token_usage(project_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_task    ON token_usage(task_id);

    CREATE TABLE IF NOT EXISTS sonar_scans (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      quality_gate    TEXT NOT NULL DEFAULT 'NONE',
      conditions      TEXT NOT NULL DEFAULT '[]',
      scan_output     TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sonar_scans_project ON sonar_scans(project_id);

    CREATE TABLE IF NOT EXISTS project_settings (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      category        TEXT NOT NULL,
      key             TEXT NOT NULL,
      value           TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_settings_unique ON project_settings(project_id, category, key);
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

export function createTask(data: Pick<Task, 'phaseId' | 'title' | 'description' | 'assignedAgent' | 'complexity' | 'dependsOn' | 'branch'> & { taskType?: Task['taskType'] }): Task {
  const db = getDb();
  const id = randomUUID();
  const taskType = data.taskType ?? 'ai';
  db.prepare(`
    INSERT INTO tasks (id, phase_id, title, description, assigned_agent, status, complexity, depends_on, branch, retry_count, task_type)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, 0, ?)
  `).run(id, data.phaseId, data.title, data.description, data.assignedAgent, data.complexity, JSON.stringify(data.dependsOn), data.branch, taskType);

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
    taskType: taskType !== 'ai' ? taskType as Task['taskType'] : undefined,
    retryCount: 0,
    revisionCount: 0,
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

export function updateTask(id: string, data: Partial<Pick<Task, 'status' | 'assignedAgent' | 'output' | 'retryCount' | 'error' | 'startedAt' | 'completedAt' | 'reviewStatus' | 'reviewerAgentId' | 'revisionCount' | 'assignedAgentId'>>): Task | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.assignedAgent !== undefined) { fields.push('assigned_agent = ?'); values.push(data.assignedAgent); }
  if (data.output !== undefined) { fields.push('output = ?'); values.push(JSON.stringify(data.output)); }
  if (data.retryCount !== undefined) { fields.push('retry_count = ?'); values.push(data.retryCount); }
  if (data.startedAt !== undefined) { fields.push('started_at = ?'); values.push(data.startedAt); }
  if (data.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(data.completedAt); }
  if (data.error !== undefined) { fields.push('error = ?'); values.push(data.error); }
  if (data.reviewStatus !== undefined) { fields.push('review_status = ?'); values.push(data.reviewStatus); }
  if (data.reviewerAgentId !== undefined) { fields.push('reviewer_agent_id = ?'); values.push(data.reviewerAgentId); }
  if (data.revisionCount !== undefined) { fields.push('revision_count = ?'); values.push(data.revisionCount); }
  if (data.assignedAgentId !== undefined) { fields.push('assigned_agent_id = ?'); values.push(data.assignedAgentId); }

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
    taskType: row.task_type !== 'ai' ? row.task_type : undefined,
    output: row.output ? JSON.parse(row.output) : undefined,
    retryCount: row.retry_count,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    reviewStatus: row.review_status ?? undefined,
    reviewerAgentId: row.reviewer_agent_id ?? undefined,
    revisionCount: row.revision_count ?? 0,
    assignedAgentId: row.assigned_agent_id ?? undefined,
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
    INSERT INTO agent_configs (id, name, role, avatar, gender, personality, model, cli_tool, skills, system_prompt, is_preset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.role, data.avatar, data.gender ?? 'male', data.personality, data.model, data.cliTool, JSON.stringify(data.skills), data.systemPrompt, data.isPreset ? 1 : 0);
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
  if (data.gender !== undefined) { fields.push('gender = ?'); values.push(data.gender); }
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
    gender: row.gender ?? 'male',
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
  // Mevcut preset rollerini al — sadece eksik olanları ekle (additive)
  const existingRoles = new Set(
    (db.prepare('SELECT role FROM agent_configs WHERE is_preset = 1').all() as { role: string }[]).map((r) => r.role),
  );

  const BASE = 'https://untitledui.com/images/avatars';
  const presets: Omit<AgentConfig, 'id'>[] = [
    // ---- Leadership ----
    {
      name: 'Olivia Rhye',
      role: 'product-owner',
      avatar: `${BASE}/olivia-rhye`,
      gender: 'female' as const,
      personality: 'Visionary, user-focused, decisive, communicative',
      model: 'claude-sonnet-4-6',
      cliTool: 'none',
      skills: ['product-management', 'requirements', 'prioritization', 'stakeholder-communication'],
      systemPrompt: `You are Olivia Rhye, a senior Product Owner for AI Dev Studio.
Your role:
1. Understand user's project requirements through conversation
2. Ask clarifying questions about tech stack, features, scope
3. Create PRDs and define product vision
4. Prioritize backlog items based on business value
5. Communicate with stakeholders and ensure alignment

When creating a plan, use the createProjectPlan tool.
Break work into small, focused tasks that can be done independently.
Identify dependencies between tasks accurately.`,
      isPreset: true,
    },
    {
      name: 'Loki Bright',
      role: 'scrum-master',
      avatar: `${BASE}/loki-bright`,
      gender: 'male' as const,
      personality: 'Organized, facilitating, blocker-removing, process-oriented',
      model: 'claude-sonnet-4-6',
      cliTool: 'none',
      skills: ['sprint-planning', 'task-distribution', 'blocker-resolution', 'agile', 'kanban'],
      systemPrompt: `You are Loki Bright, a senior Scrum Master for AI Dev Studio.
Your role:
1. Plan sprints and distribute tasks to team members
2. Monitor progress and remove blockers
3. Facilitate communication between teams
4. Ensure the pipeline runs smoothly
5. Escalate issues to Product Owner or Tech Lead when needed
6. Track velocity and suggest process improvements`,
      isPreset: true,
    },
    {
      name: 'Zahir Mays',
      role: 'tech-lead',
      avatar: `${BASE}/zahir-mays`,
      gender: 'male' as const,
      personality: 'Analytical, systematic, thorough, mentoring',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['system-design', 'code-review', 'architecture', 'tech-decisions', 'database', 'api-design'],
      systemPrompt: `You are Zahir Mays, a senior Tech Lead for AI Dev Studio.
Your role:
1. Make architecture and technology decisions
2. Design system architecture and database schemas
3. Set coding standards for frontend and backend teams
4. Review critical code changes across all teams
5. Mentor developers and resolve technical disputes
6. Write architecture documentation and API contracts`,
      isPreset: true,
    },
    {
      name: 'Natali Craig',
      role: 'business-analyst',
      avatar: `${BASE}/natali-craig`,
      gender: 'female' as const,
      personality: 'Detail-oriented, analytical, bridge between business and tech',
      model: 'claude-sonnet-4-6',
      cliTool: 'none',
      skills: ['requirements-analysis', 'user-stories', 'acceptance-criteria', 'domain-modeling'],
      systemPrompt: `You are Natali Craig, a senior Business Analyst for AI Dev Studio.
Your role:
1. Transform PRD requirements into detailed user stories
2. Define acceptance criteria for each story
3. Create domain models and data flow diagrams
4. Ensure requirements are clear and testable
5. Bridge communication between Product Owner and development teams`,
      isPreset: true,
    },
    // ---- Design ----
    {
      name: 'Amelie Laurent',
      role: 'design-lead',
      avatar: `${BASE}/amelie-laurent`,
      gender: 'female' as const,
      personality: 'Creative, empathetic, user-centric, detail-obsessed',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['ui-design', 'ux-research', 'wireframing', 'design-systems', 'accessibility', 'tailwindcss'],
      systemPrompt: `You are Amelie Laurent, a senior Design Lead for AI Dev Studio.
Your role:
1. Create wireframes and UI mockups based on user stories
2. Design user flows and interaction patterns
3. Build and maintain design system components
4. Write CSS/Tailwind specifications for frontend developers
5. Ensure accessibility (WCAG) and responsive design
6. Conduct UX reviews on implemented features`,
      isPreset: true,
    },
    // ---- Frontend Team ----
    {
      name: 'Sophia Perez',
      role: 'frontend-dev',
      avatar: `${BASE}/sophia-perez`,
      gender: 'female' as const,
      personality: 'Creative, detail-oriented, user-focused',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['react', 'typescript', 'tailwindcss', 'next.js', 'state-management', 'accessibility'],
      systemPrompt: `You are Sophia Perez, a senior Frontend Developer for AI Dev Studio.
Your role:
1. Build responsive UI components following design specs
2. Implement client-side state management
3. Ensure accessibility and performance
4. Write unit tests for components
5. Follow the project's coding standards and component patterns
6. Collaborate with Design Lead for pixel-perfect implementation`,
      isPreset: true,
    },
    {
      name: 'Sienna Hewitt',
      role: 'frontend-qa',
      avatar: `${BASE}/sienna-hewitt`,
      gender: 'female' as const,
      personality: 'Meticulous, user-perspective, quality-obsessed',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['e2e-testing', 'accessibility-testing', 'visual-regression', 'playwright', 'component-testing'],
      systemPrompt: `You are Sienna Hewitt, a senior Frontend QA Engineer for AI Dev Studio.
Your role:
1. Write E2E tests using Playwright or Cypress
2. Test accessibility compliance (WCAG 2.1)
3. Perform visual regression testing
4. Write component-level tests
5. Verify responsive behavior across breakpoints
6. Report bugs with screenshots and reproduction steps`,
      isPreset: true,
    },
    {
      name: 'Ethan Campbell',
      role: 'frontend-reviewer',
      avatar: `${BASE}/ethan-campbell`,
      gender: 'male' as const,
      personality: 'Critical, constructive, pattern-focused',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['code-review', 'react-patterns', 'performance', 'accessibility-audit', 'best-practices'],
      systemPrompt: `You are Ethan Campbell, a senior Frontend Code Reviewer for AI Dev Studio.
Your role:
1. Review frontend pull requests for quality and correctness
2. Check React component patterns and best practices
3. Audit performance (bundle size, rendering, memoization)
4. Verify accessibility implementation
5. Ensure consistent code style and naming conventions
6. Approve or request revisions with clear feedback`,
      isPreset: true,
    },
    // ---- Backend Team ----
    {
      name: 'Drew Cano',
      role: 'backend-dev',
      avatar: `${BASE}/drew-cano`,
      gender: 'male' as const,
      personality: 'Pragmatic, security-conscious, performance-oriented',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['node.js', 'typescript', 'postgresql', 'rest-api', 'authentication', 'microservices'],
      systemPrompt: `You are Drew Cano, a senior Backend Developer for AI Dev Studio.
Your role:
1. Implement API endpoints following the API contract
2. Build database queries and migrations
3. Handle authentication and authorization
4. Write unit and integration tests
5. Ensure security best practices and input validation
6. Optimize database queries and API performance`,
      isPreset: true,
    },
    {
      name: 'Levi Rocha',
      role: 'backend-qa',
      avatar: `${BASE}/levi-rocha`,
      gender: 'male' as const,
      personality: 'Thorough, systematic, data-driven',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['api-testing', 'integration-testing', 'load-testing', 'data-validation', 'jest'],
      systemPrompt: `You are Levi Rocha, a senior Backend QA Engineer for AI Dev Studio.
Your role:
1. Write API integration tests
2. Test edge cases and error handling
3. Validate data integrity and database constraints
4. Perform load and stress testing
5. Verify authentication and authorization flows
6. Report bugs with curl commands and reproduction steps`,
      isPreset: true,
    },
    {
      name: 'Noah Pierre',
      role: 'backend-reviewer',
      avatar: `${BASE}/noah-pierre`,
      gender: 'male' as const,
      personality: 'Security-focused, thorough, constructive',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['code-review', 'security-audit', 'api-design', 'database-optimization', 'best-practices'],
      systemPrompt: `You are Noah Pierre, a senior Backend Code Reviewer for AI Dev Studio.
Your role:
1. Review backend pull requests for quality and security
2. Audit for SQL injection, XSS, and OWASP vulnerabilities
3. Check API contract compliance and RESTful conventions
4. Review database query performance and indexing
5. Ensure error handling and logging best practices
6. Approve or request revisions with clear feedback`,
      isPreset: true,
    },
    // ---- Operations ----
    {
      name: 'Joshua Wilson',
      role: 'devops',
      avatar: `${BASE}/joshua-wilson`,
      gender: 'male' as const,
      personality: 'Methodical, reliability-focused, automation-driven',
      model: 'claude-sonnet-4-6',
      cliTool: 'claude-code',
      skills: ['docker', 'ci-cd', 'kubernetes', 'aws', 'monitoring', 'infrastructure-as-code'],
      systemPrompt: `You are Joshua Wilson, a senior DevOps Engineer for AI Dev Studio.
Your role:
1. Set up CI/CD pipelines for automated build, test, and deploy
2. Create and manage Docker containers and orchestration
3. Configure infrastructure as code (Terraform, CloudFormation)
4. Set up monitoring, logging, and alerting systems
5. Manage environment configurations (dev, staging, production)
6. Ensure security best practices in infrastructure`,
      isPreset: true,
    },
  ];

  for (const preset of presets) {
    if (!existingRoles.has(preset.role)) {
      createAgentConfig(preset);
    }
  }
}

// ---------------------------------------------------------------------------
// Seed team templates (hazır takım şablonlarını veritabanına ekle)
// ---------------------------------------------------------------------------

export function seedTeamTemplates(): void {
  const db = getDb();

  // Mevcut şablonları sil ve güncellenmiş halleri ile yeniden oluştur
  db.prepare('DELETE FROM team_templates').run();

  const templates = [
    {
      name: 'Scrum Team',
      description: 'Full Scrum team: PO, SM, Tech Lead, BA, Design Lead, FE/BE Dev, FE/BE QA, FE/BE Reviewer, DevOps',
      roles: ['product-owner', 'scrum-master', 'tech-lead', 'business-analyst', 'design-lead', 'frontend-dev', 'backend-dev', 'frontend-qa', 'backend-qa', 'frontend-reviewer', 'backend-reviewer', 'devops'],
    },
    {
      name: 'Startup Team',
      description: 'Lean team: Product Owner, Tech Lead, Frontend Dev, Backend Dev, DevOps',
      roles: ['product-owner', 'tech-lead', 'frontend-dev', 'backend-dev', 'devops'],
    },
    {
      name: 'Frontend Team',
      description: 'Frontend-focused: Product Owner, Design Lead, Frontend Dev, Frontend QA, Frontend Reviewer',
      roles: ['product-owner', 'design-lead', 'frontend-dev', 'frontend-qa', 'frontend-reviewer'],
    },
    {
      name: 'Backend Team',
      description: 'Backend-focused: Product Owner, Tech Lead, Backend Dev, Backend QA, Backend Reviewer, DevOps',
      roles: ['product-owner', 'tech-lead', 'backend-dev', 'backend-qa', 'backend-reviewer', 'devops'],
    },
    {
      name: 'Full Stack Team',
      description: 'Balanced team: Product Owner, Tech Lead, Design Lead, FE Dev, BE Dev, Backend QA, DevOps',
      roles: ['product-owner', 'tech-lead', 'design-lead', 'frontend-dev', 'backend-dev', 'backend-qa', 'devops'],
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
    gender: row.gender ?? 'male',
    personality: row.personality,
    model: row.model,
    cliTool: row.cli_tool as CLITool,
    skills: JSON.parse(row.skills),
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
    reportsTo: row.reports_to || undefined,
    color: row.color || '#22c55e',
    pipelineOrder: row.pipeline_order ?? 0,
  };
}

export function createProjectAgent(data: {
  projectId: string;
  sourceAgentId?: string;
  name: string;
  role: string;
  avatar: string;
  gender?: 'male' | 'female';
  personality: string;
  model: string;
  cliTool: string;
  skills: string[];
  systemPrompt: string;
  reportsTo?: string;
  color?: string;
  pipelineOrder?: number;
}): ProjectAgent {
  const db = getDb();
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO project_agents
      (id, project_id, source_agent_id, name, role, avatar, gender, personality, model, cli_tool, skills, system_prompt, created_at, reports_to, color, pipeline_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.projectId,
    data.sourceAgentId ?? null,
    data.name,
    data.role,
    data.avatar,
    data.gender ?? 'male',
    data.personality,
    data.model,
    data.cliTool,
    JSON.stringify(data.skills),
    data.systemPrompt,
    ts,
    data.reportsTo ?? null,
    data.color ?? '#22c55e',
    data.pipelineOrder ?? 0,
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
  if (data.gender !== undefined) { fields.push('gender = ?'); values.push(data.gender); }
  if (data.personality !== undefined) { fields.push('personality = ?'); values.push(data.personality); }
  if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
  if (data.cliTool !== undefined) { fields.push('cli_tool = ?'); values.push(data.cliTool); }
  if (data.skills !== undefined) { fields.push('skills = ?'); values.push(JSON.stringify(data.skills)); }
  if (data.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(data.systemPrompt); }
  if (data.sourceAgentId !== undefined) { fields.push('source_agent_id = ?'); values.push(data.sourceAgentId); }
  if (data.reportsTo !== undefined) { fields.push('reports_to = ?'); values.push(data.reportsTo || null); }
  if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color); }
  if (data.pipelineOrder !== undefined) { fields.push('pipeline_order = ?'); values.push(data.pipelineOrder); }

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
 * Belirli bir beceriye sahip proje agentlarını döner (büyük/küçük harf duyarsız).
 */
export function getProjectAgentsBySkill(projectId: string, skill: string): ProjectAgent[] {
  const db = getDb();
  const agents = (
    db.prepare('SELECT * FROM project_agents WHERE project_id = ? ORDER BY created_at').all(projectId) as any[]
  ).map(rowToProjectAgent);
  const lowerSkill = skill.toLowerCase();
  return agents.filter((a) =>
    a.skills.some((s: string) => s.toLowerCase().includes(lowerSkill)),
  );
}

/**
 * Bir projedeki tüm agentları beceri listesiyle birlikte döner.
 * PM ajanının akıllı görev atama kararları için kullanılır.
 */
export function getProjectAgentsWithSkills(projectId: string): Array<{
  id: string;
  name: string;
  role: string;
  skills: string[];
}> {
  const db = getDb();
  return (
    db.prepare('SELECT id, name, role, skills FROM project_agents WHERE project_id = ? ORDER BY pipeline_order, created_at').all(projectId) as any[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    skills: JSON.parse(row.skills ?? '[]'),
  }));
}

/**
 * Belirtilen rollere sahip preset agentları projeye kopyalar.
 * Template'de tanımlı roller ile preset agentlar rol üzerinden eşleştirilir.
 * Ayrıca PM liderliğinde varsayılan hiyerarşi ve pipeline sırası kurulur.
 */
export function copyAgentsToProject(projectId: string, roles: string[]): ProjectAgent[] {
  const presets = listPresetAgents();
  const created: ProjectAgent[] = [];

  const colorMap: Record<string, string> = {
    pm: '#f59e0b',
    designer: '#f472b6',
    architect: '#3b82f6',
    frontend: '#ec4899',
    backend: '#22c55e',
    coder: '#06b6d4',
    qa: '#a855f7',
    reviewer: '#ef4444',
    devops: '#0ea5e9',
  };

  const pipelineMap: Record<string, number> = {
    pm: 0,
    designer: 1,
    architect: 2,
    frontend: 3,
    backend: 3,
    coder: 3,
    qa: 4,
    reviewer: 5,
    devops: 6,
  };

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
        color: colorMap[preset.role] || '#22c55e',
        pipelineOrder: pipelineMap[preset.role] ?? 2,
      });
      created.push(agent);
    }
  }

  // Set up professional hierarchy:
  // - PM is the top-level lead
  // - Designer, Architect, QA, Reviewer, DevOps report to PM
  // - Frontend, Backend, Coder report to Architect (technical chain)
  const pm = created.find((a) => a.role === 'pm');
  const architect = created.find((a) => a.role === 'architect');
  const devRoles = new Set(['frontend', 'backend', 'coder']);

  if (pm) {
    for (const agent of created) {
      if (agent.id === pm.id) continue;

      // Devs report to Architect if present, otherwise to PM
      if (devRoles.has(agent.role) && architect) {
        updateProjectAgent(agent.id, { reportsTo: architect.id });
        agent.reportsTo = architect.id;
      } else {
        updateProjectAgent(agent.id, { reportsTo: pm.id });
        agent.reportsTo = pm.id;
      }
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Pipeline Runs CRUD
// Pipeline çalıştırma kayıtları — PipelineState'i kalıcı olarak saklar
// ---------------------------------------------------------------------------

/** Bir PipelineRun satırını TypeScript nesnesine çevirir */
function rowToPipelineRun(row: any): PipelineRun {
  return {
    id: row.id,
    projectId: row.project_id,
    currentStage: row.current_stage,
    status: row.status as PipelineStatus,
    stagesJson: row.stages_json,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
  };
}

/** Projeye yeni bir pipeline run kaydı oluşturur (ya da mevcut olanı günceller — UPSERT) */
export function createPipelineRun(data: Pick<PipelineRun, 'projectId' | 'status' | 'stagesJson'>): PipelineRun {
  const db = getDb();
  const id = randomUUID();
  const ts = now();

  // Projeye ait tek bir pipeline_run kaydı olur; varsa güncelle
  db.prepare(`
    INSERT INTO pipeline_runs (id, project_id, current_stage, status, stages_json, started_at, completed_at, created_at)
    VALUES (?, ?, 0, ?, ?, NULL, NULL, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      current_stage = 0,
      status = excluded.status,
      stages_json = excluded.stages_json,
      started_at = NULL,
      completed_at = NULL
  `).run(id, data.projectId, data.status, data.stagesJson, ts);

  return getPipelineRun(data.projectId)!;
}

/** Projenin mevcut pipeline run kaydını getirir */
export function getPipelineRun(projectId: string): PipelineRun | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pipeline_runs WHERE project_id = ?').get(projectId) as any;
  return row ? rowToPipelineRun(row) : undefined;
}

/** Pipeline run kaydını günceller */
export function updatePipelineRun(
  projectId: string,
  data: Partial<Pick<PipelineRun, 'currentStage' | 'status' | 'stagesJson' | 'startedAt' | 'completedAt'>>,
): PipelineRun | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.currentStage !== undefined) { fields.push('current_stage = ?'); values.push(data.currentStage); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.stagesJson !== undefined) { fields.push('stages_json = ?'); values.push(data.stagesJson); }
  if (data.startedAt !== undefined) { fields.push('started_at = ?'); values.push(data.startedAt); }
  if (data.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(data.completedAt); }

  if (fields.length === 0) return getPipelineRun(projectId);

  values.push(projectId);
  db.prepare(`UPDATE pipeline_runs SET ${fields.join(', ')} WHERE project_id = ?`).run(...values);
  return getPipelineRun(projectId);
}

// ---------------------------------------------------------------------------
// Agent Runs CRUD — yerel CLI süreç çalışma geçmişi
// ---------------------------------------------------------------------------

function rowToAgentRun(row: any): AgentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    cliTool: row.cli_tool,
    status: row.status as AgentProcessStatus,
    taskPrompt: row.task_prompt ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    pid: row.pid ?? undefined,
    exitCode: row.exit_code ?? undefined,
    startedAt: row.started_at ?? undefined,
    stoppedAt: row.stopped_at ?? undefined,
    createdAt: row.created_at,
  };
}

/** Yeni bir agent çalışma kaydı oluşturur */
export function createAgentRun(
  data: Pick<AgentRun, 'id' | 'projectId' | 'agentId' | 'cliTool' | 'status'> &
    Partial<Pick<AgentRun, 'taskPrompt' | 'pid' | 'startedAt'>>,
): AgentRun {
  const db = getDb();
  const ts = now();
  db.prepare(`
    INSERT INTO agent_runs
      (id, project_id, agent_id, cli_tool, status, task_prompt, pid, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.id,
    data.projectId,
    data.agentId,
    data.cliTool,
    data.status,
    data.taskPrompt ?? null,
    data.pid ?? null,
    data.startedAt ?? null,
    ts,
  );
  return getAgentRun(data.id)!;
}

/** Tek bir agent çalışma kaydını getirir */
export function getAgentRun(id: string): AgentRun | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as any;
  return row ? rowToAgentRun(row) : undefined;
}

/** Agent çalışma kaydını günceller */
export function updateAgentRun(
  id: string,
  data: Partial<Pick<AgentRun, 'status' | 'outputSummary' | 'exitCode' | 'stoppedAt'>>,
): AgentRun | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.outputSummary !== undefined) { fields.push('output_summary = ?'); values.push(data.outputSummary); }
  if (data.exitCode !== undefined) { fields.push('exit_code = ?'); values.push(data.exitCode); }
  if (data.stoppedAt !== undefined) { fields.push('stopped_at = ?'); values.push(data.stoppedAt); }

  if (fields.length === 0) return getAgentRun(id);

  values.push(id);
  db.prepare(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getAgentRun(id);
}

/** Belirli bir agent'ın tüm çalışma geçmişini listeler (en yeniden eskiye) */
export function listAgentRuns(projectId: string, agentId: string, limit = 50): AgentRun[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM agent_runs
    WHERE project_id = ? AND agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(projectId, agentId, limit) as any[];
  return rows.map(rowToAgentRun);
}

// ---------------------------------------------------------------------------
// Analytics Queries
// ---------------------------------------------------------------------------

export function getProjectAnalytics(projectId: string) {
  const db = getDb();

  const taskStats = db.prepare(`
    SELECT
      COUNT(*)                                           AS total,
      SUM(CASE WHEN t.status = 'done'    THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status IN ('running','assigned','review') THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN t.status = 'failed'  THEN 1 ELSE 0 END) AS blocked
    FROM tasks t
    JOIN phases ph ON ph.id = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = ?
  `).get(projectId) as any;

  // Match tasks to project agents by: project_agent ID, source_agent_id, or role
  const agentTaskRows = db.prepare(`
    SELECT
      pa.id AS agent_id, pa.name AS agent_name,
      COUNT(t.id) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed
    FROM tasks t
    JOIN phases ph  ON ph.id  = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    JOIN project_agents pa ON pa.project_id = pp.project_id
      AND (pa.id = t.assigned_agent OR pa.source_agent_id = t.assigned_agent OR pa.role = t.assigned_agent)
    WHERE pp.project_id = ?
    GROUP BY pa.id, pa.name
  `).all(projectId) as any[];

  const avgRow = db.prepare(`
    SELECT AVG(
      (julianday(t.completed_at) - julianday(t.started_at)) * 86400000
    ) AS avg_ms
    FROM tasks t
    JOIN phases ph ON ph.id = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = ?
      AND t.started_at IS NOT NULL AND t.completed_at IS NOT NULL AND t.status = 'done'
  `).get(projectId) as any;

  const pipelineRow = db.prepare(`
    SELECT COUNT(*) AS run_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successes
    FROM pipeline_runs WHERE project_id = ?
  `).get(projectId) as any;

  // Deduplicate by agent name (multiple project_agents may match same tasks)
  const agentMap = new Map<string, any>();
  for (const r of agentTaskRows || []) {
    if (!agentMap.has(r.agent_name)) agentMap.set(r.agent_name, r);
  }
  const tasksPerAgent = [...agentMap.values()].map((r: any) => ({
    agentId: r.agent_id, agentName: r.agent_name,
    total: r.total ?? 0, completed: r.completed ?? 0,
    completionRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
  }));

  const runCount = pipelineRow?.run_count ?? 0;
  const successes = pipelineRow?.successes ?? 0;

  return {
    totalTasks: taskStats?.total ?? 0,
    completedTasks: taskStats?.completed ?? 0,
    inProgressTasks: taskStats?.in_progress ?? 0,
    blockedTasks: taskStats?.blocked ?? 0,
    tasksPerAgent,
    avgCompletionTimeMs: avgRow?.avg_ms ?? null,
    pipelineRunCount: runCount,
    pipelineSuccessRate: runCount > 0 ? Math.round((successes / runCount) * 100) : 0,
  };
}

export function getAgentAnalytics(projectId: string) {
  const db = getDb();
  const allAgents = db.prepare('SELECT id, name, role, color, source_agent_id FROM project_agents WHERE project_id = ?').all(projectId) as any[];
  // Deduplicate agents by source_agent_id (keep first occurrence)
  const seen = new Set<string>();
  const agents = allAgents.filter((a: any) => {
    const key = a.source_agent_id || a.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return agents.map((a: any) => {
    // Match tasks by: project_agent ID, source (agent_config) ID, or role name
    const matchIds = [a.id, a.source_agent_id, a.role].filter(Boolean);
    const placeholders = matchIds.map(() => '?').join(',');

    const taskStats = db.prepare(`
      SELECT COUNT(*) AS assigned,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM tasks t JOIN phases ph ON ph.id = t.phase_id
      JOIN project_plans pp ON pp.id = ph.plan_id
      WHERE pp.project_id = ? AND t.assigned_agent IN (${placeholders})
    `).get(projectId, ...matchIds) as any;

    const runStats = db.prepare(`
      SELECT COUNT(*) AS run_count,
        SUM(CASE WHEN started_at IS NOT NULL AND stopped_at IS NOT NULL
          THEN (julianday(stopped_at) - julianday(started_at)) * 86400000 ELSE 0 END) AS total_runtime_ms
      FROM agent_runs WHERE project_id = ? AND agent_id = ?
    `).get(projectId, a.id) as any;

    const msgSent = (db.prepare('SELECT COUNT(*) AS cnt FROM agent_messages WHERE project_id = ? AND from_agent_id = ?').get(projectId, a.id) as any)?.cnt ?? 0;
    const msgReceived = (db.prepare('SELECT COUNT(*) AS cnt FROM agent_messages WHERE project_id = ? AND to_agent_id = ?').get(projectId, a.id) as any)?.cnt ?? 0;
    const lastRun = db.prepare('SELECT status FROM agent_runs WHERE project_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId, a.id) as any;

    return {
      agentId: a.id, agentName: a.name, role: a.role, color: a.color,
      tasksAssigned: taskStats?.assigned ?? 0, tasksCompleted: taskStats?.completed ?? 0,
      tasksFailed: taskStats?.failed ?? 0, runCount: runStats?.run_count ?? 0,
      totalRuntimeMs: Math.round(runStats?.total_runtime_ms ?? 0),
      messagesSent: msgSent, messagesReceived: msgReceived,
      isRunning: lastRun?.status === 'running' || lastRun?.status === 'starting',
    };
  });
}

export function getActivityTimeline(projectId: string, days = 7) {
  const db = getDb();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const taskRows = db.prepare(`
    SELECT substr(t.completed_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM tasks t JOIN phases ph ON ph.id = t.phase_id JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = ? AND t.status = 'done' AND t.completed_at >= ?
    GROUP BY day
  `).all(projectId, dates[0]) as any[];

  const runsStartedRows = db.prepare(`
    SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM agent_runs WHERE project_id = ? AND started_at >= ? GROUP BY day
  `).all(projectId, dates[0]) as any[];

  const runsCompletedRows = db.prepare(`
    SELECT substr(stopped_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM agent_runs WHERE project_id = ? AND status IN ('stopped','error') AND stopped_at >= ? GROUP BY day
  `).all(projectId, dates[0]) as any[];

  const taskMap = Object.fromEntries((taskRows || []).map((r: any) => [r.day, r.cnt]));
  const rsMap = Object.fromEntries((runsStartedRows || []).map((r: any) => [r.day, r.cnt]));
  const rcMap = Object.fromEntries((runsCompletedRows || []).map((r: any) => [r.day, r.cnt]));

  return dates.map((date) => ({
    date, tasksCompleted: taskMap[date] ?? 0,
    runsStarted: rsMap[date] ?? 0, runsCompleted: rcMap[date] ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Token Usage & Cost Tracking
// ---------------------------------------------------------------------------

import type { TokenUsage, ProjectCostSummary, CostBreakdownEntry } from './types.js';

export function recordTokenUsage(data: {
  projectId: string;
  taskId: string;
  agentId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}): TokenUsage {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO token_usage (id, project_id, task_id, agent_id, model, provider, input_tokens, output_tokens, total_tokens, cost_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.projectId, data.taskId, data.agentId, data.model, data.provider, data.inputTokens, data.outputTokens, data.totalTokens, data.costUsd, now);

  return {
    id,
    projectId: data.projectId,
    taskId: data.taskId,
    agentId: data.agentId,
    model: data.model,
    provider: data.provider,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    totalTokens: data.totalTokens,
    costUsd: data.costUsd,
    createdAt: now,
  };
}

export function getProjectCostSummary(projectId: string): ProjectCostSummary {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS task_count
    FROM token_usage
    WHERE project_id = ?
  `).get(projectId) as any;

  return {
    totalCostUsd: row.total_cost_usd,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalTokens: row.total_tokens,
    taskCount: row.task_count,
  };
}

export function getProjectCostBreakdown(projectId: string): CostBreakdownEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      tu.agent_id,
      pa.name AS agent_name,
      tu.model,
      COUNT(*) AS task_count,
      SUM(tu.input_tokens) AS input_tokens,
      SUM(tu.output_tokens) AS output_tokens,
      SUM(tu.total_tokens) AS total_tokens,
      SUM(tu.cost_usd) AS cost_usd
    FROM token_usage tu
    LEFT JOIN project_agents pa ON pa.id = tu.agent_id
    WHERE tu.project_id = ?
    GROUP BY tu.agent_id, tu.model
    ORDER BY cost_usd DESC
  `).all(projectId) as any[];

  return rows.map((r: any) => ({
    agentId: r.agent_id,
    agentName: r.agent_name ?? undefined,
    model: r.model,
    taskCount: r.task_count,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    totalTokens: r.total_tokens,
    costUsd: r.cost_usd,
  }));
}

export function listTokenUsage(projectId: string): TokenUsage[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM token_usage WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    taskId: r.task_id,
    agentId: r.agent_id,
    model: r.model,
    provider: r.provider,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    totalTokens: r.total_tokens,
    costUsd: r.cost_usd,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Project Settings — key-value store per project, per category
// ---------------------------------------------------------------------------

export interface ProjectSetting {
  id: string;
  projectId: string;
  category: string;
  key: string;
  value: string;
  updatedAt: string;
}

/** Get all settings for a project, optionally filtered by category. */
export function getProjectSettings(projectId: string, category?: string): ProjectSetting[] {
  const db = getDb();
  const sql = category
    ? 'SELECT * FROM project_settings WHERE project_id = ? AND category = ? ORDER BY category, key'
    : 'SELECT * FROM project_settings WHERE project_id = ? ORDER BY category, key';
  const params = category ? [projectId, category] : [projectId];
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    category: r.category,
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at,
  }));
}

/** Get a single setting value. Returns undefined if not set. */
export function getProjectSetting(projectId: string, category: string, key: string): string | undefined {
  const db = getDb();
  const row = db.prepare(
    'SELECT value FROM project_settings WHERE project_id = ? AND category = ? AND key = ?',
  ).get(projectId, category, key) as any;
  return row?.value;
}

/** Upsert a single setting. */
export function setProjectSetting(projectId: string, category: string, key: string, value: string): void {
  const db = getDb();
  const ts = now();
  const id = `${projectId}:${category}:${key}`;
  db.prepare(`
    INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(id, projectId, category, key, value, ts);
}

/** Bulk upsert settings for a category. */
export function setProjectSettings(projectId: string, category: string, entries: Record<string, string>): void {
  const db = getDb();
  const ts = now();
  const stmt = db.prepare(`
    INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(entries)) {
      const id = `${projectId}:${category}:${k}`;
      stmt.run(id, projectId, category, k, v, ts);
    }
  });
  tx();
}

/** Get all settings as a nested object { category: { key: value } }. */
export function getProjectSettingsMap(projectId: string): Record<string, Record<string, string>> {
  const settings = getProjectSettings(projectId);
  const map: Record<string, Record<string, string>> = {};
  for (const s of settings) {
    if (!map[s.category]) map[s.category] = {};
    map[s.category][s.key] = s.value;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Agent Dependencies (v2 org structure)
// ---------------------------------------------------------------------------

function rowToDependency(row: any): AgentDependency {
  return {
    id: row.id,
    projectId: row.project_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    type: row.type as DependencyType,
    createdAt: row.created_at,
  };
}

export function createAgentDependency(
  projectId: string,
  fromAgentId: string,
  toAgentId: string,
  type: DependencyType = 'workflow',
): AgentDependency {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO agent_dependencies (id, project_id, from_agent_id, to_agent_id, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, fromAgentId, toAgentId, type, now);
  return { id, projectId, fromAgentId, toAgentId, type, createdAt: now };
}

export function listAgentDependencies(projectId: string, type?: DependencyType): AgentDependency[] {
  const db = getDb();
  if (type) {
    return (db.prepare('SELECT * FROM agent_dependencies WHERE project_id = ? AND type = ?').all(projectId, type) as any[]).map(rowToDependency);
  }
  return (db.prepare('SELECT * FROM agent_dependencies WHERE project_id = ?').all(projectId) as any[]).map(rowToDependency);
}

export function deleteAgentDependency(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM agent_dependencies WHERE id = ?').run(id).changes > 0;
}

export function deleteAllDependencies(projectId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM agent_dependencies WHERE project_id = ?').run(projectId);
}

export function bulkCreateDependencies(
  projectId: string,
  deps: { fromAgentId: string; toAgentId: string; type: DependencyType }[],
): AgentDependency[] {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO agent_dependencies (id, project_id, from_agent_id, to_agent_id, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const results: AgentDependency[] = [];
  const tx = db.transaction(() => {
    for (const dep of deps) {
      const id = randomUUID();
      stmt.run(id, projectId, dep.fromAgentId, dep.toAgentId, dep.type, now);
      results.push({ id, projectId, fromAgentId: dep.fromAgentId, toAgentId: dep.toAgentId, type: dep.type, createdAt: now });
    }
  });
  tx();
  return results;
}

// ---------------------------------------------------------------------------
// Agent Capabilities (file scope restrictions)
// ---------------------------------------------------------------------------

function rowToCapability(row: any): AgentCapability {
  return {
    id: row.id,
    agentId: row.agent_id,
    projectId: row.project_id,
    scopeType: row.scope_type as CapabilityScopeType,
    pattern: row.pattern,
    permission: row.permission as CapabilityPermission,
  };
}

export function createAgentCapability(
  agentId: string,
  projectId: string,
  pattern: string,
  scopeType: CapabilityScopeType = 'path',
  permission: CapabilityPermission = 'readwrite',
): AgentCapability {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO agent_capabilities (id, agent_id, project_id, scope_type, pattern, permission) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, agentId, projectId, scopeType, pattern, permission);
  return { id, agentId, projectId, scopeType, pattern, permission };
}

export function listAgentCapabilities(projectId: string, agentId?: string): AgentCapability[] {
  const db = getDb();
  if (agentId) {
    return (db.prepare('SELECT * FROM agent_capabilities WHERE project_id = ? AND agent_id = ?').all(projectId, agentId) as any[]).map(rowToCapability);
  }
  return (db.prepare('SELECT * FROM agent_capabilities WHERE project_id = ?').all(projectId) as any[]).map(rowToCapability);
}

export function deleteAgentCapability(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM agent_capabilities WHERE id = ?').run(id).changes > 0;
}

export function deleteAllCapabilities(projectId: string, agentId?: string): void {
  const db = getDb();
  if (agentId) {
    db.prepare('DELETE FROM agent_capabilities WHERE project_id = ? AND agent_id = ?').run(projectId, agentId);
  } else {
    db.prepare('DELETE FROM agent_capabilities WHERE project_id = ?').run(projectId);
  }
}
