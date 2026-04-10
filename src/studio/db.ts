// ---------------------------------------------------------------------------
// AI Dev Studio — PostgreSQL Database (pg)
//
// IMPORTANT: All DB functions are now async and return Promise<...>.
// ALL callers must be updated to use `await`. This file has been migrated
// from better-sqlite3 to PostgreSQL (pg). Caller files are updated separately.
// ---------------------------------------------------------------------------

import { query, queryOne, execute, getPool, closePool } from './pg.js';
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
// Reset (used by tests)
// ---------------------------------------------------------------------------

/** Reset DB connection pool (used by tests). */
export async function resetDb(): Promise<void> {
  await closePool();
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

export async function createProject(data: Pick<Project, 'name' | 'description' | 'techStack' | 'repoPath'>): Promise<Project> {
  const id = randomUUID();
  const ts = now();
  await execute(`
    INSERT INTO projects (id, name, description, status, tech_stack, repo_path, created_at, updated_at)
    VALUES ($1, $2, $3, 'planning', $4, $5, $6, $7)
  `, [id, data.name, data.description, JSON.stringify(data.techStack), data.repoPath, ts, ts]);
  return (await getProject(id))!;
}

export async function getProject(id: string): Promise<Project | undefined> {
  const row = await queryOne<any>('SELECT * FROM projects WHERE id = $1', [id]);
  return row ? rowToProject(row) : undefined;
}

export async function listProjects(): Promise<Project[]> {
  const rows = await query<any>('SELECT * FROM projects ORDER BY created_at DESC');
  return rows.map(rowToProject);
}

export async function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'description' | 'status' | 'techStack' | 'repoPath'>>): Promise<Project | undefined> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
  if (data.techStack !== undefined) { fields.push(`tech_stack = $${idx++}`); values.push(JSON.stringify(data.techStack)); }
  if (data.repoPath !== undefined) { fields.push(`repo_path = $${idx++}`); values.push(data.repoPath); }

  if (fields.length === 0) return getProject(id);

  fields.push(`updated_at = $${idx++}`);
  values.push(now());
  values.push(id);

  await execute(`UPDATE projects SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  return getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM projects WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
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

export async function createPlan(projectId: string): Promise<ProjectPlan> {
  const id = randomUUID();
  const maxRow = await queryOne<any>('SELECT MAX(version) as v FROM project_plans WHERE project_id = $1', [projectId]);
  const version = (maxRow?.v ?? 0) + 1;
  const ts = now();

  await execute(`
    INSERT INTO project_plans (id, project_id, version, status, created_at)
    VALUES ($1, $2, $3, 'draft', $4)
  `, [id, projectId, version, ts]);

  return { id, projectId, version, status: 'draft', phases: [], createdAt: ts };
}

export async function getPlan(id: string): Promise<ProjectPlan | undefined> {
  const row = await queryOne<any>('SELECT * FROM project_plans WHERE id = $1', [id]);
  if (!row) return undefined;
  const phases = await listPhases(id);
  return { id: row.id, projectId: row.project_id, version: row.version, status: row.status as PlanStatus, phases, createdAt: row.created_at };
}

export async function getLatestPlan(projectId: string): Promise<ProjectPlan | undefined> {
  const row = await queryOne<any>('SELECT * FROM project_plans WHERE project_id = $1 ORDER BY version DESC LIMIT 1', [projectId]);
  if (!row) return undefined;
  return getPlan(row.id);
}

export async function updatePlanStatus(id: string, status: PlanStatus): Promise<void> {
  await execute('UPDATE project_plans SET status = $1 WHERE id = $2', [status, id]);
}

// ---------------------------------------------------------------------------
// Phases CRUD
// ---------------------------------------------------------------------------

export async function createPhase(data: Pick<Phase, 'planId' | 'name' | 'order' | 'dependsOn'>): Promise<Phase> {
  const id = randomUUID();
  await execute(`
    INSERT INTO phases (id, plan_id, name, "order", status, depends_on)
    VALUES ($1, $2, $3, $4, 'pending', $5)
  `, [id, data.planId, data.name, data.order, JSON.stringify(data.dependsOn)]);
  return { id, planId: data.planId, name: data.name, order: data.order, status: 'pending', tasks: [], dependsOn: data.dependsOn };
}

export async function listPhases(planId: string): Promise<Phase[]> {
  const rows = await query<any>('SELECT * FROM phases WHERE plan_id = $1 ORDER BY "order"', [planId]);
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    planId: row.plan_id,
    name: row.name,
    order: row.order,
    status: row.status as PhaseStatus,
    tasks: await listTasks(row.id),
    dependsOn: JSON.parse(row.depends_on),
  })));
}

export async function updatePhaseStatus(id: string, status: PhaseStatus): Promise<void> {
  await execute('UPDATE phases SET status = $1 WHERE id = $2', [status, id]);
}

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

export async function createTask(data: Pick<Task, 'phaseId' | 'title' | 'description' | 'assignedAgent' | 'complexity' | 'dependsOn' | 'branch'> & { taskType?: Task['taskType']; requiresApproval?: boolean }): Promise<Task> {
  const id = randomUUID();
  const taskType = data.taskType ?? 'ai';
  const requiresApproval = data.requiresApproval ?? false;
  await execute(`
    INSERT INTO tasks (id, phase_id, title, description, assigned_agent, status, complexity, depends_on, branch, retry_count, task_type, requires_approval)
    VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8, 0, $9, $10)
  `, [id, data.phaseId, data.title, data.description, data.assignedAgent, data.complexity, JSON.stringify(data.dependsOn), data.branch, taskType, requiresApproval ? 1 : 0]);

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
    requiresApproval,
  };
}

export async function getTask(id: string): Promise<Task | undefined> {
  const row = await queryOne<any>('SELECT * FROM tasks WHERE id = $1', [id]);
  return row ? rowToTask(row) : undefined;
}

export async function listTasks(phaseId: string): Promise<Task[]> {
  const rows = await query<any>('SELECT * FROM tasks WHERE phase_id = $1', [phaseId]);
  return rows.map(rowToTask);
}

export async function listProjectTasks(projectId: string): Promise<Task[]> {
  const rows = await query<any>(`
    SELECT t.* FROM tasks t
    JOIN phases p ON t.phase_id = p.id
    JOIN project_plans pp ON p.plan_id = pp.id
    WHERE pp.project_id = $1
    ORDER BY p."order", t.id
  `, [projectId]);
  return rows.map(rowToTask);
}

export async function updateTask(
  id: string,
  data: Partial<Pick<Task,
    | 'status'
    | 'assignedAgent'
    | 'output'
    | 'retryCount'
    | 'error'
    | 'startedAt'
    | 'completedAt'
    | 'reviewStatus'
    | 'reviewerAgentId'
    | 'revisionCount'
    | 'assignedAgentId'
    | 'requiresApproval'
    | 'approvalStatus'
    | 'approvalRejectionReason'
  >>,
): Promise<Task | undefined> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
  if (data.assignedAgent !== undefined) { fields.push(`assigned_agent = $${idx++}`); values.push(data.assignedAgent); }
  if (data.output !== undefined) { fields.push(`output = $${idx++}`); values.push(JSON.stringify(data.output)); }
  if (data.retryCount !== undefined) { fields.push(`retry_count = $${idx++}`); values.push(data.retryCount); }
  if (data.startedAt !== undefined) { fields.push(`started_at = $${idx++}`); values.push(data.startedAt); }
  if (data.completedAt !== undefined) { fields.push(`completed_at = $${idx++}`); values.push(data.completedAt); }
  if (data.error !== undefined) { fields.push(`error = $${idx++}`); values.push(data.error); }
  if (data.reviewStatus !== undefined) { fields.push(`review_status = $${idx++}`); values.push(data.reviewStatus); }
  if (data.reviewerAgentId !== undefined) { fields.push(`reviewer_agent_id = $${idx++}`); values.push(data.reviewerAgentId); }
  if (data.revisionCount !== undefined) { fields.push(`revision_count = $${idx++}`); values.push(data.revisionCount); }
  if (data.assignedAgentId !== undefined) { fields.push(`assigned_agent_id = $${idx++}`); values.push(data.assignedAgentId); }
  // Human-in-the-Loop onay alanları
  if (data.requiresApproval !== undefined) { fields.push(`requires_approval = $${idx++}`); values.push(data.requiresApproval ? 1 : 0); }
  if (data.approvalStatus !== undefined) { fields.push(`approval_status = $${idx++}`); values.push(data.approvalStatus); }
  if (data.approvalRejectionReason !== undefined) { fields.push(`approval_rejection_reason = $${idx++}`); values.push(data.approvalRejectionReason); }

  if (fields.length === 0) return getTask(id);

  values.push(id);
  await execute(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx}`, values as any[]);
  return getTask(id);
}

/**
 * Bekleyen onay gerektiren task'ları listeler.
 * approval_status = 'pending' olan tüm waiting_approval task'ları döner.
 */
export async function listPendingApprovals(projectId: string): Promise<Task[]> {
  const rows = await query<any>(`
    SELECT t.* FROM tasks t
    JOIN phases p ON t.phase_id = p.id
    JOIN project_plans pp ON p.plan_id = pp.id
    WHERE pp.project_id = $1
      AND t.status = 'waiting_approval'
      AND (t.approval_status = 'pending' OR t.approval_status IS NULL)
    ORDER BY p."order", t.id
  `, [projectId]);
  return rows.map(rowToTask);
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
    // Human-in-the-Loop onay alanları
    requiresApproval: Boolean(row.requires_approval),
    approvalStatus: (row.approval_status as Task['approvalStatus']) ?? undefined,
    approvalRejectionReason: row.approval_rejection_reason ?? undefined,
  };
}

/**
 * Append log lines to a task's output.logs without replacing other output fields.
 * Safe to call from streaming contexts — reads current state then writes atomically.
 */
export async function appendTaskLogs(taskId: string, logs: string[]): Promise<void> {
  if (logs.length === 0) return;
  const task = await getTask(taskId);
  if (!task) return;

  const currentOutput: TaskOutput = task.output ?? { filesCreated: [], filesModified: [], logs: [] };
  currentOutput.logs.push(...logs);

  await execute('UPDATE tasks SET output = $1 WHERE id = $2', [JSON.stringify(currentOutput), taskId]);
}

// ---------------------------------------------------------------------------
// Agent Configs CRUD
// ---------------------------------------------------------------------------

export async function createAgentConfig(data: Omit<AgentConfig, 'id'>): Promise<AgentConfig> {
  const id = randomUUID();
  await execute(`
    INSERT INTO agent_configs (id, name, role, avatar, gender, personality, model, cli_tool, skills, system_prompt, is_preset)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [id, data.name, data.role, data.avatar, data.gender ?? 'male', data.personality, data.model, data.cliTool, JSON.stringify(data.skills), data.systemPrompt, data.isPreset ? 1 : 0]);
  return { id, ...data };
}

export async function getAgentConfig(id: string): Promise<AgentConfig | undefined> {
  const row = await queryOne<any>('SELECT * FROM agent_configs WHERE id = $1', [id]);
  return row ? rowToAgentConfig(row) : undefined;
}

export async function listAgentConfigs(): Promise<AgentConfig[]> {
  const rows = await query<any>('SELECT * FROM agent_configs ORDER BY name');
  return rows.map(rowToAgentConfig);
}

export async function listPresetAgents(): Promise<AgentConfig[]> {
  const rows = await query<any>('SELECT * FROM agent_configs WHERE is_preset = 1 ORDER BY name');
  return rows.map(rowToAgentConfig);
}

export async function updateAgentConfig(id: string, data: Partial<Omit<AgentConfig, 'id'>>): Promise<AgentConfig | undefined> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.role !== undefined) { fields.push(`role = $${idx++}`); values.push(data.role); }
  if (data.avatar !== undefined) { fields.push(`avatar = $${idx++}`); values.push(data.avatar); }
  if (data.gender !== undefined) { fields.push(`gender = $${idx++}`); values.push(data.gender); }
  if (data.personality !== undefined) { fields.push(`personality = $${idx++}`); values.push(data.personality); }
  if (data.model !== undefined) { fields.push(`model = $${idx++}`); values.push(data.model); }
  if (data.cliTool !== undefined) { fields.push(`cli_tool = $${idx++}`); values.push(data.cliTool); }
  if (data.skills !== undefined) { fields.push(`skills = $${idx++}`); values.push(JSON.stringify(data.skills)); }
  if (data.systemPrompt !== undefined) { fields.push(`system_prompt = $${idx++}`); values.push(data.systemPrompt); }
  if (data.isPreset !== undefined) { fields.push(`is_preset = $${idx++}`); values.push(data.isPreset ? 1 : 0); }

  if (fields.length === 0) return getAgentConfig(id);

  values.push(id);
  await execute(`UPDATE agent_configs SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  return getAgentConfig(id);
}

export async function deleteAgentConfig(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM agent_configs WHERE id = $1 AND is_preset = 0', [id]);
  return (result.rowCount ?? 0) > 0;
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
    isPreset: Boolean(row.is_preset),
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function insertEvent(data: Omit<StudioEvent, 'id' | 'timestamp'>): Promise<StudioEvent> {
  const id = randomUUID();
  const timestamp = now();
  await execute(`
    INSERT INTO events (id, project_id, type, agent_id, task_id, payload, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, data.projectId, data.type, data.agentId ?? null, data.taskId ?? null, JSON.stringify(data.payload), timestamp]);
  return { id, ...data, timestamp };
}

export async function listEvents(projectId: string, limit = 100): Promise<StudioEvent[]> {
  const rows = await query<any>('SELECT * FROM events WHERE project_id = $1 ORDER BY timestamp DESC LIMIT $2', [projectId, limit]);
  return rows.map(rowToEvent);
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

export async function insertChatMessage(data: Pick<ChatMessage, 'projectId' | 'role' | 'content'>): Promise<ChatMessage> {
  const id = randomUUID();
  const ts = now();
  await execute(`
    INSERT INTO chat_messages (id, project_id, role, content, created_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, data.projectId, data.role, data.content, ts]);
  return { id, ...data, createdAt: ts };
}

export async function listChatMessages(projectId: string): Promise<ChatMessage[]> {
  const rows = await query<any>('SELECT * FROM chat_messages WHERE project_id = $1 ORDER BY created_at', [projectId]);
  return rows.map((row) => ({
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
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    // fallback_order kolonu sonradan migration ile eklendi; null gelebilir
    fallbackOrder: row.fallback_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProvider(
  data: Pick<AIProvider, 'name' | 'type' | 'apiKey' | 'baseUrl' | 'model' | 'isActive'>,
): Promise<AIProvider> {
  const id = randomUUID();
  const ts = now();

  // Auto-set as default if it is the very first provider
  const countRow = await queryOne<any>('SELECT COUNT(*) as c FROM ai_providers');
  const existingCount = parseInt(countRow?.c ?? '0', 10);
  const isDefault = existingCount === 0 ? 1 : 0;

  await execute(`
    INSERT INTO ai_providers (id, name, type, api_key, base_url, model, is_default, is_active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
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
  ]);

  return (await getProvider(id))!;
}

export async function getProvider(id: string): Promise<AIProvider | undefined> {
  const row = await queryOne<any>('SELECT * FROM ai_providers WHERE id = $1', [id]);
  return row ? rowToProvider(row, true) : undefined;
}

export async function listProviders(): Promise<AIProvider[]> {
  const rows = await query<any>('SELECT * FROM ai_providers ORDER BY created_at ASC');
  return rows.map((r) => rowToProvider(r, true));
}

export async function updateProvider(
  id: string,
  data: Partial<Pick<AIProvider, 'name' | 'type' | 'apiKey' | 'baseUrl' | 'model' | 'isActive'>>,
): Promise<AIProvider | undefined> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.type !== undefined) { fields.push(`type = $${idx++}`); values.push(data.type); }
  if (data.apiKey !== undefined) { fields.push(`api_key = $${idx++}`); values.push(data.apiKey); }
  if (data.baseUrl !== undefined) { fields.push(`base_url = $${idx++}`); values.push(data.baseUrl); }
  if (data.model !== undefined) { fields.push(`model = $${idx++}`); values.push(data.model); }
  if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive ? 1 : 0); }

  if (fields.length === 0) return getProvider(id);

  fields.push(`updated_at = $${idx++}`);
  values.push(now());
  values.push(id);

  await execute(`UPDATE ai_providers SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  return getProvider(id);
}

export async function deleteProvider(id: string): Promise<{ success: boolean; error?: string }> {
  const row = await queryOne<any>('SELECT * FROM ai_providers WHERE id = $1', [id]);
  if (!row) return { success: false, error: 'Provider not found' };
  if (Boolean(row.is_default)) {
    return { success: false, error: 'Cannot delete the default provider. Set another provider as default first.' };
  }
  await execute('DELETE FROM ai_providers WHERE id = $1', [id]);
  return { success: true };
}

export async function setDefaultProvider(id: string): Promise<AIProvider | undefined> {
  const row = await queryOne<any>('SELECT * FROM ai_providers WHERE id = $1', [id]);
  if (!row) return undefined;

  // Use a transaction to swap default atomically
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE ai_providers SET is_default = 0, updated_at = $1', [now()]);
    await client.query('UPDATE ai_providers SET is_default = 1, updated_at = $1 WHERE id = $2', [now(), id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getProvider(id);
}

export async function getDefaultProvider(): Promise<AIProvider | undefined> {
  const row = await queryOne<any>('SELECT * FROM ai_providers WHERE is_default = 1 LIMIT 1');
  // Return with unmasked key — for backend usage
  return row ? rowToProvider(row, false) : undefined;
}

/** Returns the raw (unmasked) API key for a provider — for internal backend use only. */
export async function getRawProviderApiKey(id: string): Promise<string> {
  const row = await queryOne<any>('SELECT api_key FROM ai_providers WHERE id = $1', [id]);
  return row?.api_key ?? '';
}

// ---------------------------------------------------------------------------
// Fallback Chain — provider sıralaması
// ---------------------------------------------------------------------------

/**
 * Aktif provider'ları fallback_order alanına göre sıralı olarak döndürür.
 * Default provider her zaman başta yer alır (birincil), ardından sıradaki
 * aktif provider'lar gelir. Pasif provider'lar zincire dahil edilmez.
 */
export async function getFallbackChain(): Promise<AIProvider[]> {
  const rows = await query<any>(
    `SELECT * FROM ai_providers
     WHERE is_active = 1
     ORDER BY is_default DESC, fallback_order ASC, created_at ASC`,
  );
  return rows.map((r) => rowToProvider(r, true));
}

/**
 * Fallback sıralamasını toplu olarak günceller.
 * @param orderedIds — Provider ID'leri, istenen fallback sırasına göre dizili.
 *                     Birinci eleman en önce denenir (fallback_order = 0).
 */
export async function updateFallbackOrder(orderedIds: string[]): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      await client.query('UPDATE ai_providers SET fallback_order = $1, updated_at = $2 WHERE id = $3', [index, now(), id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Seed preset agents
// ---------------------------------------------------------------------------

export async function seedPresetAgents(): Promise<void> {
  // Mevcut preset rollerini al — sadece eksik olanları ekle (additive)
  const rows = await query<{ role: string }>('SELECT role FROM agent_configs WHERE is_preset = 1');
  const existingRoles = new Set(rows.map((r) => r.role));

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
      await createAgentConfig(preset);
    }
  }
}

// ---------------------------------------------------------------------------
// Seed team templates (hazır takım şablonlarını veritabanına ekle)
// ---------------------------------------------------------------------------

export async function seedTeamTemplates(): Promise<void> {
  // Mevcut şablonları sil ve güncellenmiş halleri ile yeniden oluştur
  await execute('DELETE FROM team_templates');

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
    await execute(
      'INSERT INTO team_templates (id, name, description, agent_ids, created_at) VALUES ($1, $2, $3, $4, $5)',
      [
        randomUUID(),
        t.name,
        t.description,
        // agent_ids sütunu aslında rolleri saklar — preset agent eşlemesi role üzerinden yapılır
        JSON.stringify(t.roles),
        now(),
      ],
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

export async function listTeamTemplates(): Promise<TeamTemplate[]> {
  const rows = await query<any>('SELECT * FROM team_templates ORDER BY name');
  return rows.map(rowToTeamTemplate);
}

export async function getTeamTemplate(id: string): Promise<TeamTemplate | undefined> {
  const row = await queryOne<any>('SELECT * FROM team_templates WHERE id = $1', [id]);
  return row ? rowToTeamTemplate(row) : undefined;
}

// ---------------------------------------------------------------------------
// Custom Team Templates — kullanıcının oluşturduğu ekipler
// ---------------------------------------------------------------------------

export interface CustomTeamTemplate {
  id: string;
  name: string;
  description: string;
  roles: string[];
  dependencies: { from: string; to: string; type: string }[];
  createdAt: string;
}

function rowToCustomTeamTemplate(row: any): CustomTeamTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    roles: JSON.parse(row.roles),
    dependencies: JSON.parse(row.dependencies),
    createdAt: row.created_at,
  };
}

export async function listCustomTeamTemplates(): Promise<CustomTeamTemplate[]> {
  const rows = await query<any>('SELECT * FROM custom_team_templates ORDER BY created_at DESC');
  return rows.map(rowToCustomTeamTemplate);
}

export async function getCustomTeamTemplate(id: string): Promise<CustomTeamTemplate | undefined> {
  const row = await queryOne<any>('SELECT * FROM custom_team_templates WHERE id = $1', [id]);
  return row ? rowToCustomTeamTemplate(row) : undefined;
}

export async function createCustomTeamTemplate(data: { name: string; description?: string; roles: string[]; dependencies: { from: string; to: string; type: string }[] }): Promise<CustomTeamTemplate> {
  const id = randomUUID();
  const createdAt = now();
  await execute(
    'INSERT INTO custom_team_templates (id, name, description, roles, dependencies, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, data.name, data.description ?? '', JSON.stringify(data.roles), JSON.stringify(data.dependencies), createdAt],
  );
  return { id, name: data.name, description: data.description ?? '', roles: data.roles, dependencies: data.dependencies, createdAt };
}

export async function updateCustomTeamTemplate(id: string, data: { name?: string; description?: string; roles?: string[]; dependencies?: { from: string; to: string; type: string }[] }): Promise<CustomTeamTemplate | undefined> {
  const existing = await getCustomTeamTemplate(id);
  if (!existing) return undefined;
  const name = data.name ?? existing.name;
  const description = data.description ?? existing.description;
  const roles = data.roles ?? existing.roles;
  const dependencies = data.dependencies ?? existing.dependencies;
  await execute(
    'UPDATE custom_team_templates SET name = $1, description = $2, roles = $3, dependencies = $4 WHERE id = $5',
    [name, description, JSON.stringify(roles), JSON.stringify(dependencies), id],
  );
  return { ...existing, name, description, roles, dependencies };
}

export async function deleteCustomTeamTemplate(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM custom_team_templates WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
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

export async function createProjectAgent(data: {
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
}): Promise<ProjectAgent> {
  const id = randomUUID();
  const ts = now();
  await execute(
    `INSERT INTO project_agents
      (id, project_id, source_agent_id, name, role, avatar, gender, personality, model, cli_tool, skills, system_prompt, created_at, reports_to, color, pipeline_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
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
    ],
  );
  return (await getProjectAgent(id))!;
}

export async function getProjectAgent(id: string): Promise<ProjectAgent | undefined> {
  const row = await queryOne<any>('SELECT * FROM project_agents WHERE id = $1', [id]);
  return row ? rowToProjectAgent(row) : undefined;
}

export async function listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  const rows = await query<any>('SELECT * FROM project_agents WHERE project_id = $1 ORDER BY created_at', [projectId]);
  return rows.map(rowToProjectAgent);
}

export async function updateProjectAgent(
  id: string,
  data: Partial<Omit<ProjectAgent, 'id' | 'projectId' | 'createdAt'>>,
): Promise<ProjectAgent | undefined> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.role !== undefined) { fields.push(`role = $${idx++}`); values.push(data.role); }
  if (data.avatar !== undefined) { fields.push(`avatar = $${idx++}`); values.push(data.avatar); }
  if (data.gender !== undefined) { fields.push(`gender = $${idx++}`); values.push(data.gender); }
  if (data.personality !== undefined) { fields.push(`personality = $${idx++}`); values.push(data.personality); }
  if (data.model !== undefined) { fields.push(`model = $${idx++}`); values.push(data.model); }
  if (data.cliTool !== undefined) { fields.push(`cli_tool = $${idx++}`); values.push(data.cliTool); }
  if (data.skills !== undefined) { fields.push(`skills = $${idx++}`); values.push(JSON.stringify(data.skills)); }
  if (data.systemPrompt !== undefined) { fields.push(`system_prompt = $${idx++}`); values.push(data.systemPrompt); }
  if (data.sourceAgentId !== undefined) { fields.push(`source_agent_id = $${idx++}`); values.push(data.sourceAgentId); }
  if (data.reportsTo !== undefined) { fields.push(`reports_to = $${idx++}`); values.push(data.reportsTo || null); }
  if (data.color !== undefined) { fields.push(`color = $${idx++}`); values.push(data.color); }
  if (data.pipelineOrder !== undefined) { fields.push(`pipeline_order = $${idx++}`); values.push(data.pipelineOrder); }

  if (fields.length === 0) return getProjectAgent(id);

  values.push(id);
  await execute(`UPDATE project_agents SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  return getProjectAgent(id);
}

export async function deleteProjectAgent(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM project_agents WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Belirli bir beceriye sahip proje agentlarını döner (büyük/küçük harf duyarsız).
 */
export async function getProjectAgentsBySkill(projectId: string, skill: string): Promise<ProjectAgent[]> {
  const agents = await listProjectAgents(projectId);
  const lowerSkill = skill.toLowerCase();
  return agents.filter((a) =>
    a.skills.some((s: string) => s.toLowerCase().includes(lowerSkill)),
  );
}

/**
 * Bir projedeki tüm agentları beceri listesiyle birlikte döner.
 * PM ajanının akıllı görev atama kararları için kullanılır.
 */
export async function getProjectAgentsWithSkills(projectId: string): Promise<Array<{
  id: string;
  name: string;
  role: string;
  skills: string[];
}>> {
  const rows = await query<any>(
    'SELECT id, name, role, skills FROM project_agents WHERE project_id = $1 ORDER BY pipeline_order, created_at',
    [projectId],
  );
  return rows.map((row) => ({
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
export async function copyAgentsToProject(projectId: string, roles: string[]): Promise<ProjectAgent[]> {
  const presets = await listPresetAgents();
  const created: ProjectAgent[] = [];

  const colorMap: Record<string, string> = {
    // v2 roles
    'product-owner': '#f59e0b',
    'scrum-master': '#06b6d4',
    'tech-lead': '#3b82f6',
    'business-analyst': '#8b5cf6',
    'design-lead': '#f472b6',
    'frontend-dev': '#ec4899',
    'backend-dev': '#22c55e',
    'frontend-qa': '#a855f7',
    'backend-qa': '#a855f7',
    'frontend-reviewer': '#ef4444',
    'backend-reviewer': '#ef4444',
    'devops': '#0ea5e9',
    // legacy
    pm: '#f59e0b', designer: '#f472b6', architect: '#3b82f6',
    frontend: '#ec4899', backend: '#22c55e', coder: '#06b6d4',
    qa: '#a855f7', reviewer: '#ef4444',
  };

  const pipelineMap: Record<string, number> = {
    // v2 roles — wave-based order
    'product-owner': 0, 'scrum-master': 0,
    'tech-lead': 1, 'business-analyst': 1, 'design-lead': 1,
    'frontend-dev': 2, 'backend-dev': 2,
    'frontend-qa': 3, 'backend-qa': 3,
    'frontend-reviewer': 4, 'backend-reviewer': 4,
    'devops': 5,
    // legacy
    pm: 0, designer: 1, architect: 2,
    frontend: 3, backend: 3, coder: 3,
    qa: 4, reviewer: 5,
  };

  for (const role of roles) {
    const preset = presets.find((p) => p.role === role);
    if (preset) {
      const agent = await createProjectAgent({
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

  // Set up hierarchy (v2 + legacy compat)
  const po = created.find((a) => a.role === 'product-owner') ?? created.find((a) => a.role === 'pm');
  const techLead = created.find((a) => a.role === 'tech-lead') ?? created.find((a) => a.role === 'architect');
  const devRoles = new Set(['frontend-dev', 'backend-dev', 'frontend', 'backend', 'coder']);
  const qaRoles = new Set(['frontend-qa', 'backend-qa', 'qa']);
  const reviewRoles = new Set(['frontend-reviewer', 'backend-reviewer', 'reviewer']);

  if (po) {
    for (const agent of created) {
      if (agent.id === po.id) continue;
      if ((devRoles.has(agent.role) || qaRoles.has(agent.role) || reviewRoles.has(agent.role)) && techLead) {
        await updateProjectAgent(agent.id, { reportsTo: techLead.id });
        agent.reportsTo = techLead.id;
      } else {
        await updateProjectAgent(agent.id, { reportsTo: po.id });
        agent.reportsTo = po.id;
      }
    }
  }

  // v2: Seed default agent dependencies for the standard pipeline
  await seedDefaultDependencies(projectId, created);

  return created;
}

/**
 * Standart Scrum takımı için default dependency'leri oluşturur.
 * Workflow: PO/SM → TL/BA/DL → FE-Dev/BE-Dev → FE-QA/BE-QA → FE-Reviewer/BE-Reviewer → DevOps
 * Review: FE-Dev → FE-Reviewer, BE-Dev → BE-Reviewer
 * Gate: FE-Reviewer + BE-Reviewer → DevOps
 */
async function seedDefaultDependencies(projectId: string, agents: ProjectAgent[]): Promise<void> {
  const byRole = new Map<string, ProjectAgent>();
  for (const a of agents) byRole.set(a.role, a);

  const deps: { fromAgentId: string; toAgentId: string; type: DependencyType }[] = [];

  function addDep(fromRole: string, toRole: string, type: DependencyType) {
    const from = byRole.get(fromRole);
    const to = byRole.get(toRole);
    if (from && to) deps.push({ fromAgentId: from.id, toAgentId: to.id, type });
  }

  // Workflow chain
  addDep('product-owner', 'tech-lead', 'workflow');
  addDep('product-owner', 'business-analyst', 'workflow');
  addDep('product-owner', 'design-lead', 'workflow');
  addDep('tech-lead', 'frontend-dev', 'workflow');
  addDep('tech-lead', 'backend-dev', 'workflow');
  addDep('frontend-dev', 'frontend-qa', 'workflow');
  addDep('backend-dev', 'backend-qa', 'workflow');
  addDep('frontend-qa', 'frontend-reviewer', 'workflow');
  addDep('backend-qa', 'backend-reviewer', 'workflow');

  // Review: dev → reviewer
  addDep('frontend-dev', 'frontend-reviewer', 'review');
  addDep('backend-dev', 'backend-reviewer', 'review');

  // Gate: both reviewers → devops
  addDep('frontend-reviewer', 'devops', 'gate');
  addDep('backend-reviewer', 'devops', 'gate');

  // Hierarchy edges (for visual org chart)
  addDep('product-owner', 'scrum-master', 'hierarchy');
  addDep('product-owner', 'tech-lead', 'hierarchy');
  addDep('product-owner', 'business-analyst', 'hierarchy');
  addDep('product-owner', 'design-lead', 'hierarchy');
  addDep('tech-lead', 'frontend-dev', 'hierarchy');
  addDep('tech-lead', 'backend-dev', 'hierarchy');
  addDep('tech-lead', 'devops', 'hierarchy');

  if (deps.length > 0) {
    await bulkCreateDependencies(projectId, deps);
  }
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
export async function createPipelineRun(data: Pick<PipelineRun, 'projectId' | 'status' | 'stagesJson'>): Promise<PipelineRun> {
  const id = randomUUID();
  const ts = now();

  // Projeye ait tek bir pipeline_run kaydı olur; varsa güncelle
  await execute(`
    INSERT INTO pipeline_runs (id, project_id, current_stage, status, stages_json, started_at, completed_at, created_at)
    VALUES ($1, $2, 0, $3, $4, NULL, NULL, $5)
    ON CONFLICT(project_id) DO UPDATE SET
      current_stage = 0,
      status = EXCLUDED.status,
      stages_json = EXCLUDED.stages_json,
      started_at = NULL,
      completed_at = NULL
  `, [id, data.projectId, data.status, data.stagesJson, ts]);

  return (await getPipelineRun(data.projectId))!;
}

/** Projenin mevcut pipeline run kaydını getirir */
export async function getPipelineRun(projectId: string): Promise<PipelineRun | undefined> {
  const row = await queryOne<any>('SELECT * FROM pipeline_runs WHERE project_id = $1', [projectId]);
  return row ? rowToPipelineRun(row) : undefined;
}

/** Pipeline run kaydını günceller */
export async function updatePipelineRun(
  projectId: string,
  data: Partial<Pick<PipelineRun, 'currentStage' | 'status' | 'stagesJson' | 'startedAt' | 'completedAt'>>,
): Promise<PipelineRun | undefined> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.currentStage !== undefined) { fields.push(`current_stage = $${idx++}`); values.push(data.currentStage); }
  if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
  if (data.stagesJson !== undefined) { fields.push(`stages_json = $${idx++}`); values.push(data.stagesJson); }
  if (data.startedAt !== undefined) { fields.push(`started_at = $${idx++}`); values.push(data.startedAt); }
  if (data.completedAt !== undefined) { fields.push(`completed_at = $${idx++}`); values.push(data.completedAt); }

  if (fields.length === 0) return getPipelineRun(projectId);

  values.push(projectId);
  await execute(`UPDATE pipeline_runs SET ${fields.join(', ')} WHERE project_id = $${idx}`, values);
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
export async function createAgentRun(
  data: Pick<AgentRun, 'id' | 'projectId' | 'agentId' | 'cliTool' | 'status'> &
    Partial<Pick<AgentRun, 'taskPrompt' | 'pid' | 'startedAt'>>,
): Promise<AgentRun> {
  const ts = now();
  await execute(`
    INSERT INTO agent_runs
      (id, project_id, agent_id, cli_tool, status, task_prompt, pid, started_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    data.id,
    data.projectId,
    data.agentId,
    data.cliTool,
    data.status,
    data.taskPrompt ?? null,
    data.pid ?? null,
    data.startedAt ?? null,
    ts,
  ]);
  return (await getAgentRun(data.id))!;
}

/** Tek bir agent çalışma kaydını getirir */
export async function getAgentRun(id: string): Promise<AgentRun | undefined> {
  const row = await queryOne<any>('SELECT * FROM agent_runs WHERE id = $1', [id]);
  return row ? rowToAgentRun(row) : undefined;
}

/** Agent çalışma kaydını günceller */
export async function updateAgentRun(
  id: string,
  data: Partial<Pick<AgentRun, 'status' | 'outputSummary' | 'exitCode' | 'stoppedAt'>>,
): Promise<AgentRun | undefined> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
  if (data.outputSummary !== undefined) { fields.push(`output_summary = $${idx++}`); values.push(data.outputSummary); }
  if (data.exitCode !== undefined) { fields.push(`exit_code = $${idx++}`); values.push(data.exitCode); }
  if (data.stoppedAt !== undefined) { fields.push(`stopped_at = $${idx++}`); values.push(data.stoppedAt); }

  if (fields.length === 0) return getAgentRun(id);

  values.push(id);
  await execute(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  return getAgentRun(id);
}

/** Belirli bir agent'ın tüm çalışma geçmişini listeler (en yeniden eskiye) */
export async function listAgentRuns(projectId: string, agentId: string, limit = 50): Promise<AgentRun[]> {
  const rows = await query<any>(`
    SELECT * FROM agent_runs
    WHERE project_id = $1 AND agent_id = $2
    ORDER BY created_at DESC
    LIMIT $3
  `, [projectId, agentId, limit]);
  return rows.map(rowToAgentRun);
}

// ---------------------------------------------------------------------------
// Analytics Queries
// ---------------------------------------------------------------------------

export async function getProjectAnalytics(projectId: string) {
  const taskStats = await queryOne<any>(`
    SELECT
      COUNT(*)                                           AS total,
      SUM(CASE WHEN t.status = 'done'    THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status IN ('running','assigned','review') THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN t.status = 'failed'  THEN 1 ELSE 0 END) AS blocked
    FROM tasks t
    JOIN phases ph ON ph.id = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = $1
  `, [projectId]);

  // Match tasks to project agents by: project_agent ID, source_agent_id, or role
  const agentTaskRows = await query<any>(`
    SELECT
      pa.id AS agent_id, pa.name AS agent_name,
      COUNT(t.id) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed
    FROM tasks t
    JOIN phases ph  ON ph.id  = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    JOIN project_agents pa ON pa.project_id = pp.project_id
      AND (pa.id = t.assigned_agent OR pa.source_agent_id = t.assigned_agent OR pa.role = t.assigned_agent)
    WHERE pp.project_id = $1
    GROUP BY pa.id, pa.name
  `, [projectId]);

  const avgRow = await queryOne<any>(`
    SELECT AVG(
      EXTRACT(EPOCH FROM (t.completed_at::timestamptz - t.started_at::timestamptz)) * 1000
    ) AS avg_ms
    FROM tasks t
    JOIN phases ph ON ph.id = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = $1
      AND t.started_at IS NOT NULL AND t.completed_at IS NOT NULL AND t.status = 'done'
  `, [projectId]);

  const pipelineRow = await queryOne<any>(`
    SELECT COUNT(*) AS run_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successes
    FROM pipeline_runs WHERE project_id = $1
  `, [projectId]);

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

  const runCount = parseInt(pipelineRow?.run_count ?? '0', 10);
  const successes = parseInt(pipelineRow?.successes ?? '0', 10);

  return {
    totalTasks: parseInt(taskStats?.total ?? '0', 10),
    completedTasks: parseInt(taskStats?.completed ?? '0', 10),
    inProgressTasks: parseInt(taskStats?.in_progress ?? '0', 10),
    blockedTasks: parseInt(taskStats?.blocked ?? '0', 10),
    tasksPerAgent,
    avgCompletionTimeMs: avgRow?.avg_ms ? parseFloat(avgRow.avg_ms) : null,
    pipelineRunCount: runCount,
    pipelineSuccessRate: runCount > 0 ? Math.round((successes / runCount) * 100) : 0,
  };
}

export async function getAgentAnalytics(projectId: string) {
  const allAgents = await query<any>('SELECT id, name, role, avatar, color, source_agent_id FROM project_agents WHERE project_id = $1', [projectId]);
  // Deduplicate agents by source_agent_id (keep first occurrence)
  const seen = new Set<string>();
  const agents = allAgents.filter((a: any) => {
    const key = a.source_agent_id || a.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Promise.all(agents.map(async (a: any) => {
    // Match tasks by: project_agent ID, source (agent_config) ID, or role name
    const matchIds = [a.id, a.source_agent_id, a.role].filter(Boolean);
    const placeholders = matchIds.map((_: any, i: number) => `$${i + 2}`).join(',');

    const taskStats = await queryOne<any>(`
      SELECT COUNT(*) AS assigned,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM tasks t JOIN phases ph ON ph.id = t.phase_id
      JOIN project_plans pp ON pp.id = ph.plan_id
      WHERE pp.project_id = $1 AND t.assigned_agent IN (${placeholders})
    `, [projectId, ...matchIds]);

    const runStats = await queryOne<any>(`
      SELECT COUNT(*) AS run_count,
        SUM(CASE WHEN started_at IS NOT NULL AND stopped_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (stopped_at::timestamptz - started_at::timestamptz)) * 1000 ELSE 0 END) AS total_runtime_ms
      FROM agent_runs WHERE project_id = $1 AND agent_id = $2
    `, [projectId, a.id]);

    const msgSentRow = await queryOne<any>('SELECT COUNT(*) AS cnt FROM agent_messages WHERE project_id = $1 AND from_agent_id = $2', [projectId, a.id]);
    const msgReceivedRow = await queryOne<any>('SELECT COUNT(*) AS cnt FROM agent_messages WHERE project_id = $1 AND to_agent_id = $2', [projectId, a.id]);
    const lastRun = await queryOne<any>('SELECT status FROM agent_runs WHERE project_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT 1', [projectId, a.id]);

    const msgSent = parseInt(msgSentRow?.cnt ?? '0', 10);
    const msgReceived = parseInt(msgReceivedRow?.cnt ?? '0', 10);

    return {
      agentId: a.id, agentName: a.name, role: a.role, avatar: a.avatar ?? '', color: a.color,
      tasksAssigned: parseInt(taskStats?.assigned ?? '0', 10),
      tasksCompleted: parseInt(taskStats?.completed ?? '0', 10),
      tasksFailed: parseInt(taskStats?.failed ?? '0', 10),
      runCount: parseInt(runStats?.run_count ?? '0', 10),
      totalRuntimeMs: Math.round(parseFloat(runStats?.total_runtime_ms ?? '0')),
      messagesSent: msgSent, messagesReceived: msgReceived,
      isRunning: lastRun?.status === 'running' || lastRun?.status === 'starting',
    };
  }));
}

export async function getActivityTimeline(projectId: string, days = 7) {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const taskRows = await query<any>(`
    SELECT SUBSTRING(t.completed_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM tasks t JOIN phases ph ON ph.id = t.phase_id JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = $1 AND t.status = 'done' AND t.completed_at >= $2
    GROUP BY day
  `, [projectId, dates[0]]);

  const runsStartedRows = await query<any>(`
    SELECT SUBSTRING(started_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM agent_runs WHERE project_id = $1 AND started_at >= $2 GROUP BY day
  `, [projectId, dates[0]]);

  const runsCompletedRows = await query<any>(`
    SELECT SUBSTRING(stopped_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM agent_runs WHERE project_id = $1 AND status IN ('stopped','error') AND stopped_at >= $2 GROUP BY day
  `, [projectId, dates[0]]);

  const taskMap = Object.fromEntries((taskRows || []).map((r: any) => [r.day, parseInt(r.cnt, 10)]));
  const rsMap = Object.fromEntries((runsStartedRows || []).map((r: any) => [r.day, parseInt(r.cnt, 10)]));
  const rcMap = Object.fromEntries((runsCompletedRows || []).map((r: any) => [r.day, parseInt(r.cnt, 10)]));

  return dates.map((date) => ({
    date, tasksCompleted: taskMap[date] ?? 0,
    runsStarted: rsMap[date] ?? 0, runsCompleted: rcMap[date] ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Token Usage & Cost Tracking
// ---------------------------------------------------------------------------

import type { TokenUsage, ProjectCostSummary, CostBreakdownEntry } from './types.js';

export async function recordTokenUsage(data: {
  projectId: string;
  taskId: string;
  agentId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}): Promise<TokenUsage> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await execute(`
    INSERT INTO token_usage (id, project_id, task_id, agent_id, model, provider, input_tokens, output_tokens, total_tokens, cost_usd, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [id, data.projectId, data.taskId, data.agentId, data.model, data.provider, data.inputTokens, data.outputTokens, data.totalTokens, data.costUsd, createdAt]);

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
    createdAt,
  };
}

export async function getProjectCostSummary(projectId: string): Promise<ProjectCostSummary> {
  const row = await queryOne<any>(`
    SELECT
      COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS task_count
    FROM token_usage
    WHERE project_id = $1
  `, [projectId]);

  return {
    totalCostUsd: parseFloat(row.total_cost_usd),
    totalInputTokens: parseInt(row.total_input_tokens, 10),
    totalOutputTokens: parseInt(row.total_output_tokens, 10),
    totalTokens: parseInt(row.total_tokens, 10),
    taskCount: parseInt(row.task_count, 10),
  };
}

export async function getProjectCostBreakdown(projectId: string): Promise<CostBreakdownEntry[]> {
  const rows = await query<any>(`
    SELECT
      tu.agent_id,
      pa.name AS agent_name,
      pa.avatar AS agent_avatar,
      pa.role AS agent_role,
      tu.model,
      COUNT(*) AS task_count,
      SUM(tu.input_tokens) AS input_tokens,
      SUM(tu.output_tokens) AS output_tokens,
      SUM(tu.total_tokens) AS total_tokens,
      SUM(tu.cost_usd) AS cost_usd
    FROM token_usage tu
    LEFT JOIN project_agents pa ON pa.id = tu.agent_id
    WHERE tu.project_id = $1
    GROUP BY tu.agent_id, tu.model, pa.name, pa.avatar, pa.role
    ORDER BY cost_usd DESC
  `, [projectId]);

  return rows.map((r: any) => ({
    agentId: r.agent_id,
    agentName: r.agent_name ?? undefined,
    agentAvatar: r.agent_avatar ?? '',
    agentRole: r.agent_role ?? '',
    model: r.model,
    taskCount: parseInt(r.task_count, 10),
    inputTokens: parseInt(r.input_tokens, 10),
    outputTokens: parseInt(r.output_tokens, 10),
    totalTokens: parseInt(r.total_tokens, 10),
    costUsd: parseFloat(r.cost_usd),
  }));
}

export async function listTokenUsage(projectId: string): Promise<TokenUsage[]> {
  const rows = await query<any>('SELECT * FROM token_usage WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
  return rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    taskId: r.task_id,
    agentId: r.agent_id,
    model: r.model,
    provider: r.provider,
    inputTokens: parseInt(r.input_tokens, 10),
    outputTokens: parseInt(r.output_tokens, 10),
    totalTokens: parseInt(r.total_tokens, 10),
    costUsd: parseFloat(r.cost_usd),
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
export async function getProjectSettings(projectId: string, category?: string): Promise<ProjectSetting[]> {
  let rows: any[];
  if (category) {
    rows = await query<any>(
      'SELECT * FROM project_settings WHERE project_id = $1 AND category = $2 ORDER BY category, key',
      [projectId, category],
    );
  } else {
    rows = await query<any>(
      'SELECT * FROM project_settings WHERE project_id = $1 ORDER BY category, key',
      [projectId],
    );
  }
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
export async function getProjectSetting(projectId: string, category: string, key: string): Promise<string | undefined> {
  const row = await queryOne<any>(
    'SELECT value FROM project_settings WHERE project_id = $1 AND category = $2 AND key = $3',
    [projectId, category, key],
  );
  return row?.value;
}

/** Upsert a single setting. */
export async function setProjectSetting(projectId: string, category: string, key: string, value: string): Promise<void> {
  const ts = now();
  const id = `${projectId}:${category}:${key}`;
  await execute(`
    INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (project_id, category, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `, [id, projectId, category, key, value, ts]);
}

/** Bulk upsert settings for a category. */
export async function setProjectSettings(projectId: string, category: string, entries: Record<string, string>): Promise<void> {
  const ts = now();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const [k, v] of Object.entries(entries)) {
      const id = `${projectId}:${category}:${k}`;
      await client.query(`
        INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (project_id, category, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `, [id, projectId, category, k, v, ts]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Get all settings as a nested object { category: { key: value } }. */
export async function getProjectSettingsMap(projectId: string): Promise<Record<string, Record<string, string>>> {
  const settings = await getProjectSettings(projectId);
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

export async function createAgentDependency(
  projectId: string,
  fromAgentId: string,
  toAgentId: string,
  type: DependencyType = 'workflow',
): Promise<AgentDependency> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await execute(
    'INSERT INTO agent_dependencies (id, project_id, from_agent_id, to_agent_id, type, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, projectId, fromAgentId, toAgentId, type, createdAt],
  );
  return { id, projectId, fromAgentId, toAgentId, type, createdAt };
}

export async function listAgentDependencies(projectId: string, type?: DependencyType): Promise<AgentDependency[]> {
  if (type) {
    const rows = await query<any>('SELECT * FROM agent_dependencies WHERE project_id = $1 AND type = $2', [projectId, type]);
    return rows.map(rowToDependency);
  }
  const rows = await query<any>('SELECT * FROM agent_dependencies WHERE project_id = $1', [projectId]);
  return rows.map(rowToDependency);
}

export async function deleteAgentDependency(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM agent_dependencies WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAllDependencies(projectId: string): Promise<void> {
  await execute('DELETE FROM agent_dependencies WHERE project_id = $1', [projectId]);
}

export async function bulkCreateDependencies(
  projectId: string,
  deps: { fromAgentId: string; toAgentId: string; type: DependencyType }[],
): Promise<AgentDependency[]> {
  const createdAt = new Date().toISOString();
  const results: AgentDependency[] = [];
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const dep of deps) {
      const id = randomUUID();
      await client.query(
        'INSERT INTO agent_dependencies (id, project_id, from_agent_id, to_agent_id, type, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, projectId, dep.fromAgentId, dep.toAgentId, dep.type, createdAt],
      );
      results.push({ id, projectId, fromAgentId: dep.fromAgentId, toAgentId: dep.toAgentId, type: dep.type, createdAt });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

export async function createAgentCapability(
  agentId: string,
  projectId: string,
  pattern: string,
  scopeType: CapabilityScopeType = 'path',
  permission: CapabilityPermission = 'readwrite',
): Promise<AgentCapability> {
  const id = randomUUID();
  await execute(
    'INSERT INTO agent_capabilities (id, agent_id, project_id, scope_type, pattern, permission) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, agentId, projectId, scopeType, pattern, permission],
  );
  return { id, agentId, projectId, scopeType, pattern, permission };
}

export async function listAgentCapabilities(projectId: string, agentId?: string): Promise<AgentCapability[]> {
  if (agentId) {
    const rows = await query<any>('SELECT * FROM agent_capabilities WHERE project_id = $1 AND agent_id = $2', [projectId, agentId]);
    return rows.map(rowToCapability);
  }
  const rows = await query<any>('SELECT * FROM agent_capabilities WHERE project_id = $1', [projectId]);
  return rows.map(rowToCapability);
}

export async function deleteAgentCapability(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM agent_capabilities WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAllCapabilities(projectId: string, agentId?: string): Promise<void> {
  if (agentId) {
    await execute('DELETE FROM agent_capabilities WHERE project_id = $1 AND agent_id = $2', [projectId, agentId]);
  } else {
    await execute('DELETE FROM agent_capabilities WHERE project_id = $1', [projectId]);
  }
}

// ---------------------------------------------------------------------------
// Webhooks CRUD
// ---------------------------------------------------------------------------

// Webhook veri yapısı — tip güvenliği için
export interface Webhook {
  id: string;
  projectId: string;
  name: string;
  url: string;
  /** Webhook türü: Slack, Discord veya Generic */
  type: 'slack' | 'discord' | 'generic';
  /** Dinlenen event tipleri: JSON dizisi olarak saklanır */
  events: string[];
  active: boolean;
  /** HMAC imzası için gizli anahtar — opsiyonel */
  secret?: string;
  createdAt: string;
}

/** Webhook teslimat log kaydı */
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  status: 'success' | 'failed';
  statusCode?: number;
  responseBody?: string;
  durationMs: number;
  attempt: number;
  createdAt: string;
}

/** DB satırını Webhook nesnesine dönüştür */
function rowToWebhook(row: any): Webhook {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    type: row.type as Webhook['type'],
    events: JSON.parse(row.events ?? '[]'),
    active: Boolean(row.active),
    secret: row.secret ?? undefined,
    createdAt: row.created_at,
  };
}

/** Yeni webhook oluştur — URL https:// ile başlamalı */
export async function createWebhook(data: {
  projectId: string;
  name: string;
  url: string;
  type: Webhook['type'];
  events: string[];
  secret?: string;
}): Promise<Webhook> {
  const id = randomUUID();
  const ts = now();
  await execute(
    'INSERT INTO webhooks (id, project_id, name, url, type, events, active, secret, created_at) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)',
    [id, data.projectId, data.name, data.url, data.type, JSON.stringify(data.events), data.secret ?? null, ts],
  );
  return (await getWebhook(id))!;
}

/** Projeye ait webhook'ları listele */
export async function listWebhooks(projectId: string): Promise<Webhook[]> {
  const rows = await query<any>('SELECT * FROM webhooks WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
  return rows.map(rowToWebhook);
}

/** Tekil webhook'u getir */
export async function getWebhook(id: string): Promise<Webhook | undefined> {
  const row = await queryOne<any>('SELECT * FROM webhooks WHERE id = $1', [id]);
  return row ? rowToWebhook(row) : undefined;
}

/** Webhook'u güncelle — kısmi güncelleme desteklenir */
export async function updateWebhook(
  id: string,
  data: Partial<Pick<Webhook, 'name' | 'url' | 'type' | 'events' | 'active' | 'secret'>>,
): Promise<Webhook | undefined> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.url !== undefined) { fields.push(`url = $${idx++}`); values.push(data.url); }
  if (data.type !== undefined) { fields.push(`type = $${idx++}`); values.push(data.type); }
  if (data.events !== undefined) { fields.push(`events = $${idx++}`); values.push(JSON.stringify(data.events)); }
  if (data.active !== undefined) { fields.push(`active = $${idx++}`); values.push(data.active ? 1 : 0); }
  if (data.secret !== undefined) { fields.push(`secret = $${idx++}`); values.push(data.secret ?? null); }

  if (fields.length === 0) return getWebhook(id);

  values.push(id);
  await execute(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = $${idx}`, values as any[]);
  return getWebhook(id);
}

/** Webhook'u sil */
export async function deleteWebhook(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM webhooks WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Belirli bir event'i dinleyen aktif webhook'ları getir */
export async function listWebhooksForEvent(projectId: string, eventType: string): Promise<Webhook[]> {
  // Tüm aktif webhook'ları çek ve JavaScript tarafında filtrele
  const all = await query<any>('SELECT * FROM webhooks WHERE project_id = $1 AND active = 1', [projectId]);
  const webhooks = all.map(rowToWebhook);
  // 'test' event türü tüm aktif webhook'lara gönderilir
  if (eventType === 'test') return webhooks;
  return webhooks.filter((w) => w.events.includes(eventType));
}

// ---------------------------------------------------------------------------
// Webhook Deliveries CRUD
// ---------------------------------------------------------------------------

/** DB satırını WebhookDelivery nesnesine dönüştür */
function rowToDelivery(row: any): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    eventType: row.event_type,
    status: row.status as 'success' | 'failed',
    statusCode: row.status_code ?? undefined,
    responseBody: row.response_body ?? undefined,
    durationMs: row.duration_ms,
    attempt: row.attempt,
    createdAt: row.created_at,
  };
}

/** Yeni teslimat kaydı oluştur */
export async function insertWebhookDelivery(data: Omit<WebhookDelivery, 'id' | 'createdAt'>): Promise<WebhookDelivery> {
  const id = randomUUID();
  const ts = now();
  await execute(
    `INSERT INTO webhook_deliveries
       (id, webhook_id, event_type, status, status_code, response_body, duration_ms, attempt, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      data.webhookId,
      data.eventType,
      data.status,
      data.statusCode ?? null,
      data.responseBody ?? null,
      data.durationMs,
      data.attempt,
      ts,
    ],
  );
  return (await queryOne<any>('SELECT * FROM webhook_deliveries WHERE id = $1', [id]).then((r) => r ? rowToDelivery(r) : undefined))!;
}

/** Webhook'a ait son N teslimat kaydını getir */
export async function listWebhookDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
  const rows = await query<any>(
    'SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT $2',
    [webhookId, limit],
  );
  return rows.map(rowToDelivery);
}
