// ---------------------------------------------------------------------------
// Observability Routes — Memory API + Logs + Studio Events + Trace Viewer
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { getDb } from './studio/db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryConversation {
  id: string;
  resource_id: string;
  user_id: string;
  title: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message_at?: string | null;
}

interface MemoryMessage {
  conversation_id: string;
  message_id: string;
  user_id: string;
  role: string;
  parts: string;
  metadata: string | null;
  format_version: number;
  created_at: string;
}

interface MemoryStep {
  id: string;
  conversation_id: string;
  user_id: string;
  agent_id: string;
  agent_name: string | null;
  operation_id: string | null;
  step_index: number;
  type: string;
  role: string;
  content: string | null;
  arguments: string | null;
  result: string | null;
  usage: string | null;
  sub_agent_id: string | null;
  sub_agent_name: string | null;
  created_at: string;
}

interface WorkflowState {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  input: string | null;
  context: string | null;
  workflow_state: string | null;
  suspension: string | null;
  events: string | null;
  output: string | null;
  cancellation: string | null;
  user_id: string | null;
  conversation_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getMemoryDb(readonly = true): Database.Database {
  const dbPath = resolve(process.cwd(), '.voltagent/memory.db');
  return new Database(dbPath, { readonly });
}

function safeClose(db: Database.Database): void {
  try {
    db.close();
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const observabilityRoutes = new Hono();

// GET /api/observability/memory/stats
observabilityRoutes.get('/memory/stats', (c) => {
  const db = getMemoryDb();
  try {
    const totalConversations = (
      db.prepare('SELECT COUNT(*) as n FROM voltagent_memory_conversations').get() as { n: number }
    ).n;

    const totalMessages = (
      db.prepare('SELECT COUNT(*) as n FROM voltagent_memory_messages').get() as { n: number }
    ).n;

    const totalSteps = (
      db.prepare('SELECT COUNT(*) as n FROM voltagent_memory_steps').get() as { n: number }
    ).n;

    const totalWorkflows = (
      db.prepare('SELECT COUNT(*) as n FROM voltagent_memory_workflow_states').get() as {
        n: number;
      }
    ).n;

    const byAgent = db
      .prepare(
        `SELECT
          c.resource_id as name,
          COUNT(DISTINCT c.id) as conversations,
          COUNT(m.message_id) as messages
        FROM voltagent_memory_conversations c
        LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
        GROUP BY c.resource_id
        ORDER BY conversations DESC`,
      )
      .all() as Array<{ name: string; conversations: number; messages: number }>;

    return c.json({ totalConversations, totalMessages, totalSteps, byAgent, totalWorkflows });
  } finally {
    safeClose(db);
  }
});

// GET /api/observability/memory/conversations
observabilityRoutes.get('/memory/conversations', (c) => {
  const db = getMemoryDb();
  try {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const agent = c.req.query('agent');

    const where = agent ? `WHERE c.resource_id = ?` : '';
    const params: (string | number)[] = agent
      ? [agent, limit, offset]
      : [limit, offset];

    const rows = db
      .prepare(
        `SELECT
          c.*,
          COUNT(m.message_id) as message_count,
          MAX(m.created_at) as last_message_at
        FROM voltagent_memory_conversations c
        LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
        ${where}
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?`,
      )
      .all(...params) as MemoryConversation[];

    const countParams: string[] = agent ? [agent] : [];
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) as n FROM voltagent_memory_conversations c ${where}`,
        )
        .get(...countParams) as { n: number }
    ).n;

    const conversations = rows.map((r) => ({
      ...r,
      metadata: safeParseJSON(r.metadata),
    }));

    return c.json({ conversations, total });
  } finally {
    safeClose(db);
  }
});

// GET /api/observability/memory/conversations/:id
observabilityRoutes.get('/memory/conversations/:id', (c) => {
  const db = getMemoryDb();
  try {
    const id = c.req.param('id');

    const conversation = db
      .prepare('SELECT * FROM voltagent_memory_conversations WHERE id = ?')
      .get(id) as MemoryConversation | undefined;

    if (!conversation) {
      return c.json({ error: 'Not found' }, 404);
    }

    const messages = db
      .prepare(
        'SELECT * FROM voltagent_memory_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      )
      .all(id) as MemoryMessage[];

    const steps = db
      .prepare(
        'SELECT * FROM voltagent_memory_steps WHERE conversation_id = ? ORDER BY step_index ASC, created_at ASC',
      )
      .all(id) as MemoryStep[];

    return c.json({
      conversation: {
        ...conversation,
        metadata: safeParseJSON(conversation.metadata),
      },
      messages: messages.map((m) => ({
        ...m,
        parts: safeParseJSON(m.parts),
        metadata: m.metadata ? safeParseJSON(m.metadata) : null,
      })),
      steps: steps.map((s) => ({
        ...s,
        arguments: s.arguments ? safeParseJSON(s.arguments) : null,
        result: s.result ? safeParseJSON(s.result) : null,
        usage: s.usage ? safeParseJSON(s.usage) : null,
      })),
    });
  } finally {
    safeClose(db);
  }
});

// GET /api/observability/memory/conversations/:id/messages
observabilityRoutes.get('/memory/conversations/:id/messages', (c) => {
  const db = getMemoryDb();
  try {
    const id = c.req.param('id');

    const messages = db
      .prepare(
        'SELECT * FROM voltagent_memory_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      )
      .all(id) as MemoryMessage[];

    return c.json({
      messages: messages.map((m) => ({
        ...m,
        parts: safeParseJSON(m.parts),
        metadata: m.metadata ? safeParseJSON(m.metadata) : null,
      })),
    });
  } finally {
    safeClose(db);
  }
});

// GET /api/observability/memory/workflows
observabilityRoutes.get('/memory/workflows', (c) => {
  const db = getMemoryDb();
  try {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const status = c.req.query('status');

    const where = status ? 'WHERE status = ?' : '';
    const params: (string | number)[] = status
      ? [status, limit, offset]
      : [limit, offset];

    const rows = db
      .prepare(
        `SELECT * FROM voltagent_memory_workflow_states ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params) as WorkflowState[];

    const countParams: string[] = status ? [status] : [];
    const total = (
      db
        .prepare(`SELECT COUNT(*) as n FROM voltagent_memory_workflow_states ${where}`)
        .get(...countParams) as { n: number }
    ).n;

    const workflows = rows.map((w) => ({
      ...w,
      input: w.input ? safeParseJSON(w.input) : null,
      output: w.output ? safeParseJSON(w.output) : null,
      events: w.events ? safeParseJSON(w.events) : null,
      context: w.context ? safeParseJSON(w.context) : null,
      metadata: w.metadata ? safeParseJSON(w.metadata) : null,
    }));

    return c.json({ workflows, total });
  } finally {
    safeClose(db);
  }
});

// DELETE /api/observability/memory/conversations/:id
observabilityRoutes.delete('/memory/conversations/:id', (c) => {
  const db = getMemoryDb(false); // read-write
  try {
    const id = c.req.param('id');

    const existing = db
      .prepare('SELECT id FROM voltagent_memory_conversations WHERE id = ?')
      .get(id);

    if (!existing) {
      return c.json({ error: 'Not found' }, 404);
    }

    // Cascade delete steps and messages manually in case FK pragma is off
    db.prepare('DELETE FROM voltagent_memory_steps WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM voltagent_memory_messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM voltagent_memory_conversations WHERE id = ?').run(id);

    return c.json({ success: true });
  } finally {
    safeClose(db);
  }
});

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function safeParseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// Observability DB (READ-ONLY)
// ---------------------------------------------------------------------------

let _obsDb: Database.Database | null = null;

function getObsDb(): Database.Database {
  if (!_obsDb) {
    const dbPath = resolve(process.cwd(), '.voltagent/observability.db');
    _obsDb = new Database(dbPath, { readonly: true });
  }
  return _obsDb;
}

// ---------------------------------------------------------------------------
// Observability Logs Types
// ---------------------------------------------------------------------------

interface ObservabilityLog {
  id: number;
  timestamp: string;
  trace_id: string | null;
  span_id: string | null;
  trace_flags: number | null;
  severity_number: number | null;
  severity_text: string | null;
  body: string;
  attributes: string | null;
  resource: string | null;
  instrumentation_scope: string | null;
  created_at: string | null;
}

interface StudioEventRow {
  id: string;
  project_id: string;
  type: string;
  payload: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/observability/logs
// ---------------------------------------------------------------------------

observabilityRoutes.get('/logs', (c) => {
  const db = getObsDb();

  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const severity = c.req.query('severity');
  const traceId = c.req.query('trace_id');
  const search = c.req.query('search');
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (severity) {
    conditions.push('severity_text = ?');
    params.push(severity.toUpperCase());
  }
  if (traceId) {
    conditions.push('trace_id = ?');
    params.push(traceId);
  }
  if (search) {
    conditions.push('body LIKE ?');
    params.push(`%${search}%`);
  }
  if (from) {
    conditions.push('timestamp >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('timestamp <= ?');
    params.push(to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM observability_logs ${where}`)
    .get(...params) as { cnt: number };

  const rows = db
    .prepare(
      `SELECT * FROM observability_logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ObservabilityLog[];

  const logs = rows.map((row) => ({
    ...row,
    attributes: row.attributes ? (safeParseJSON(row.attributes) as Record<string, unknown>) : null,
  }));

  return c.json({ logs, total: countRow.cnt });
});

// ---------------------------------------------------------------------------
// GET /api/observability/logs/stats
// ---------------------------------------------------------------------------

observabilityRoutes.get('/logs/stats', (c) => {
  const db = getObsDb();

  const totalRow = db
    .prepare('SELECT COUNT(*) as cnt FROM observability_logs')
    .get() as { cnt: number };

  const severityRows = db
    .prepare(
      `SELECT severity_text, COUNT(*) as cnt
       FROM observability_logs
       GROUP BY severity_text`,
    )
    .all() as Array<{ severity_text: string | null; cnt: number }>;

  const bySeverity: Record<string, number> = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 };
  for (const row of severityRows) {
    const key = (row.severity_text ?? 'DEBUG').toUpperCase();
    bySeverity[key] = (bySeverity[key] ?? 0) + row.cnt;
  }

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM observability_logs WHERE timestamp >= ?`)
    .get(since) as { cnt: number };

  return c.json({ total: totalRow.cnt, bySeverity, recentRate: recentRow.cnt });
});

// ---------------------------------------------------------------------------
// GET /api/observability/events  (studio.db)
// ---------------------------------------------------------------------------

observabilityRoutes.get('/events', (c) => {
  const db = getDb();

  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const type = c.req.query('type');
  const projectId = c.req.query('project_id');

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (projectId) {
    conditions.push('project_id = ?');
    params.push(projectId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM events ${where}`)
    .get(...params) as { cnt: number };

  const rows = db
    .prepare(`SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as StudioEventRow[];

  const events = rows.map((row) => ({
    ...row,
    payload: safeParseJSON(row.payload) as Record<string, unknown>,
  }));

  return c.json({ events, total: countRow.cnt });
});

// ---------------------------------------------------------------------------
// Studio Traces — tasks, pipeline_runs, agent_runs (studio.db)
// ---------------------------------------------------------------------------

observabilityRoutes.get('/studio/traces', (c) => {
  const db = getDb();

  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const agent = c.req.query('agent');
  const status = c.req.query('status');

  // Pipeline runs as top-level traces
  const pipelineRuns = db
    .prepare('SELECT * FROM pipeline_runs ORDER BY started_at DESC')
    .all() as Array<{
      id: string; project_id: string; status: string; stages_json: string;
      started_at: string | null; completed_at: string | null; created_at: string;
    }>;

  // Task-level traces (each task = a span-like trace entry)
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (agent) {
    conditions.push('t.assigned_agent = ?');
    params.push(agent);
  }
  if (status) {
    conditions.push('t.status = ?');
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) as n FROM tasks t ${where}`)
    .get(...params) as { n: number };

  const tasks = db
    .prepare(
      `SELECT t.*, pp.project_id FROM tasks t
       JOIN phases ph ON ph.id = t.phase_id
       JOIN project_plans pp ON pp.id = ph.plan_id
       ${where}
       ORDER BY COALESCE(t.started_at, t.completed_at, ph.id) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<{
      id: string; title: string; description: string; assigned_agent: string;
      status: string; complexity: string; branch: string; output: string | null;
      error: string | null; task_type: string; started_at: string | null;
      completed_at: string | null; project_id: string; phase_id: string;
    }>;

  // Agent runs — each run is a sub-span
  const agentRuns = db
    .prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 200')
    .all() as Array<{
      id: string; project_id: string; agent_id: string; cli_tool: string;
      status: string; task_prompt: string | null; output_summary: string | null;
      pid: number | null; exit_code: number | null;
      started_at: string | null; stopped_at: string | null; created_at: string;
    }>;

  // Unique agent names for filter dropdown
  const agentNames = db
    .prepare("SELECT DISTINCT assigned_agent FROM tasks WHERE assigned_agent != '' ORDER BY assigned_agent")
    .all() as Array<{ assigned_agent: string }>;

  // Format tasks as trace-like objects
  const studioTraces = tasks.map((t) => {
    const durationMs =
      t.started_at && t.completed_at
        ? new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()
        : null;

    const traceStatus: 'success' | 'error' | 'running' =
      t.status === 'done' ? 'success' :
      t.status === 'failed' ? 'error' :
      (t.status === 'in_progress' || t.status === 'running') ? 'running' : 'success';

    // Find agent_runs associated with this task's agent
    const relatedRuns = agentRuns.filter(
      (r) => r.project_id === t.project_id && r.agent_id === t.assigned_agent,
    );

    return {
      trace_id: t.id,
      entity_id: t.assigned_agent || 'unassigned',
      entity_type: 'studio-task',
      title: t.title,
      start_time: t.started_at ?? t.completed_at ?? new Date().toISOString(),
      end_time: t.completed_at,
      status: traceStatus,
      duration_ms: durationMs,
      complexity: t.complexity,
      task_type: t.task_type,
      branch: t.branch,
      output: t.output ? (t.output.length > 500 ? t.output.slice(0, 500) + '...' : t.output) : null,
      error: t.error,
      span_count: 1 + relatedRuns.length,
      spans: relatedRuns.map((r) => ({
        span_id: r.id,
        name: r.cli_tool,
        status: r.status,
        start_time: r.started_at,
        end_time: r.stopped_at,
        duration_ms:
          r.started_at && r.stopped_at
            ? new Date(r.stopped_at).getTime() - new Date(r.started_at).getTime()
            : null,
        exit_code: r.exit_code,
        output_summary: r.output_summary,
      })),
    };
  });

  return c.json({
    traces: studioTraces,
    pipelines: pipelineRuns.map((p) => ({
      id: p.id,
      project_id: p.project_id,
      status: p.status,
      started_at: p.started_at,
      completed_at: p.completed_at,
      stages: safeParseJSON(p.stages_json),
    })),
    total: totalRow.n,
    agents: agentNames.map((a) => a.assigned_agent),
    limit,
    offset,
  });
});

// GET /api/observability/studio/traces/stats
observabilityRoutes.get('/studio/traces/stats', (c) => {
  const db = getDb();

  const totalTasks = (db.prepare('SELECT COUNT(*) as n FROM tasks').get() as { n: number }).n;
  const doneTasks = (db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status = 'done'").get() as { n: number }).n;
  const failedTasks = (db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status = 'failed'").get() as { n: number }).n;
  const inProgress = (db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status IN ('in_progress','running')").get() as { n: number }).n;

  // Avg duration of completed tasks
  const completedRows = db
    .prepare("SELECT started_at, completed_at FROM tasks WHERE started_at IS NOT NULL AND completed_at IS NOT NULL")
    .all() as Array<{ started_at: string; completed_at: string }>;

  let totalDuration = 0;
  for (const r of completedRows) {
    totalDuration += new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
  }
  const avgDurationMs = completedRows.length > 0 ? totalDuration / completedRows.length : null;

  const errorRate = totalTasks > 0 ? Math.round((failedTasks / totalTasks) * 1000) / 10 : 0;

  const topAgents = db
    .prepare(
      "SELECT assigned_agent as name, COUNT(*) as count FROM tasks WHERE assigned_agent != '' GROUP BY assigned_agent ORDER BY count DESC LIMIT 10",
    )
    .all() as { name: string; count: number }[];

  return c.json({
    totalTraces: totalTasks,
    avgDurationMs,
    errorRate,
    totalTokens: 0,
    doneTasks,
    failedTasks,
    inProgress,
    topAgents,
  });
});

// GET /api/observability/studio/traces/:taskId
observabilityRoutes.get('/studio/traces/:taskId', (c) => {
  const db = getDb();
  const taskId = c.req.param('taskId');

  const task = db.prepare('SELECT t.*, pp.project_id FROM tasks t JOIN phases ph ON ph.id = t.phase_id JOIN project_plans pp ON pp.id = ph.plan_id WHERE t.id = ?').get(taskId) as {
    id: string; title: string; description: string; assigned_agent: string;
    status: string; complexity: string; branch: string; output: string | null;
    error: string | null; task_type: string; started_at: string | null;
    completed_at: string | null; project_id: string; phase_id: string;
  } | undefined;

  if (!task) return c.json({ error: 'Task not found' }, 404);

  const durationMs =
    task.started_at && task.completed_at
      ? new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()
      : null;

  const traceStatus: 'success' | 'error' | 'running' =
    task.status === 'done' ? 'success' :
    task.status === 'failed' ? 'error' :
    (task.status === 'in_progress' || task.status === 'running') ? 'running' : 'success';

  const agentRuns = db
    .prepare('SELECT * FROM agent_runs WHERE project_id = ? AND agent_id = ? ORDER BY started_at ASC')
    .all(task.project_id, task.assigned_agent) as Array<{
      id: string; cli_tool: string; status: string; task_prompt: string | null;
      output_summary: string | null; exit_code: number | null;
      started_at: string | null; stopped_at: string | null;
    }>;

  return c.json({
    trace: {
      trace_id: task.id,
      entity_id: task.assigned_agent || 'unassigned',
      entity_type: 'studio-task',
      title: task.title,
      start_time: task.started_at ?? task.completed_at ?? new Date().toISOString(),
      end_time: task.completed_at,
      status: traceStatus,
      duration_ms: durationMs,
      span_count: 1 + agentRuns.length,
      total_tokens: null,
    },
    spans: [
      // The task itself as the root span
      {
        span_id: task.id,
        trace_id: task.id,
        parent_span_id: null,
        entity_id: task.assigned_agent,
        name: task.title,
        start_time: task.started_at ?? task.completed_at ?? new Date().toISOString(),
        end_time: task.completed_at,
        duration_ms: durationMs,
        status_code: task.status === 'failed' ? 2 : 0,
        status_message: task.error,
        span_type: 'agent' as const,
        llm_model: null,
        tool_name: null,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        input: task.description,
        output: task.output,
        attributes: { complexity: task.complexity, branch: task.branch, task_type: task.task_type },
      },
      // Agent runs as child spans
      ...agentRuns.map((r) => ({
        span_id: r.id,
        trace_id: task.id,
        parent_span_id: task.id,
        entity_id: task.assigned_agent,
        name: r.cli_tool,
        start_time: r.started_at ?? task.started_at ?? new Date().toISOString(),
        end_time: r.stopped_at,
        duration_ms:
          r.started_at && r.stopped_at
            ? new Date(r.stopped_at).getTime() - new Date(r.started_at).getTime()
            : null,
        status_code: r.exit_code !== null && r.exit_code !== 0 ? 2 : 0,
        status_message: r.exit_code !== null && r.exit_code !== 0 ? `Exit code: ${r.exit_code}` : null,
        span_type: 'tool' as const,
        llm_model: null,
        tool_name: r.cli_tool,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        input: r.task_prompt,
        output: r.output_summary,
        attributes: { exit_code: r.exit_code },
      })),
    ],
  });
});

// ---------------------------------------------------------------------------
// Traces (observability.db) — Tipler
// ---------------------------------------------------------------------------

interface RawTrace {
  trace_id: string;
  root_span_id: string | null;
  entity_id: string | null;
  entity_type: string | null;
  start_time: string;
  end_time: string | null;
  span_count: number;
  created_at: string;
  updated_at: string;
}

interface RawSpan {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  entity_id: string | null;
  entity_type: string | null;
  name: string;
  kind: number;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  status_code: number;
  status_message: string | null;
  attributes: string | null;
  events: string | null;
  created_at: string;
  updated_at: string;
}

interface ParsedAttributes {
  'span.type'?: string;
  'llm.model'?: string;
  'llm.usage.prompt_tokens'?: number;
  'llm.usage.completion_tokens'?: number;
  'llm.usage.total_tokens'?: number;
  'tool.name'?: string;
  'entity.name'?: string;
  input?: string;
  output?: string;
  'agent.state'?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Traces yardımcıları
// ---------------------------------------------------------------------------

function parseAttrs(raw: string | null): ParsedAttributes {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ParsedAttributes;
  } catch {
    return {};
  }
}

function calcDurationMs(start: string, end: string | null): number | null {
  if (!end) return null;
  return new Date(end).getTime() - new Date(start).getTime();
}

function deriveTraceStatus(spans: RawSpan[], endTime: string | null): 'success' | 'error' | 'running' {
  if (!endTime) return 'running';
  const hasError = spans.some((s) => s.status_code === 2);
  return hasError ? 'error' : 'success';
}

function deriveSpanType(span: RawSpan): 'agent' | 'llm' | 'tool' {
  const attrs = parseAttrs(span.attributes);
  const spanType = attrs['span.type'];
  if (spanType === 'llm') return 'llm';
  if (spanType === 'tool') return 'tool';
  return 'agent';
}

function formatTrace(trace: RawTrace, spans: RawSpan[]) {
  const durationMs = calcDurationMs(trace.start_time, trace.end_time);
  const status = deriveTraceStatus(spans, trace.end_time);

  // Token toplamı — LLM span'larından hesapla
  let totalTokens = 0;
  for (const span of spans) {
    const attrs = parseAttrs(span.attributes);
    const tokens = attrs['llm.usage.total_tokens'];
    if (typeof tokens === 'number') totalTokens += tokens;
  }

  return {
    trace_id: trace.trace_id,
    root_span_id: trace.root_span_id,
    entity_id: trace.entity_id,
    entity_type: trace.entity_type,
    start_time: trace.start_time,
    end_time: trace.end_time,
    span_count: trace.span_count,
    duration_ms: durationMs,
    status,
    total_tokens: totalTokens > 0 ? totalTokens : null,
  };
}

function formatSpan(span: RawSpan) {
  const attrs = parseAttrs(span.attributes);
  return {
    span_id: span.span_id,
    trace_id: span.trace_id,
    parent_span_id: span.parent_span_id,
    entity_id: span.entity_id,
    entity_type: span.entity_type,
    name: span.name,
    kind: span.kind,
    start_time: span.start_time,
    end_time: span.end_time,
    duration_ms: span.duration ?? calcDurationMs(span.start_time, span.end_time),
    status_code: span.status_code,
    status_message: span.status_message,
    span_type: deriveSpanType(span),
    llm_model: attrs['llm.model'] ?? null,
    tool_name: attrs['tool.name'] ?? null,
    prompt_tokens: attrs['llm.usage.prompt_tokens'] ?? null,
    completion_tokens: attrs['llm.usage.completion_tokens'] ?? null,
    total_tokens: attrs['llm.usage.total_tokens'] ?? null,
    // İnput/output — max 2000 karakter ile kırp
    input: typeof attrs['input'] === 'string' ? attrs['input'].slice(0, 2000) : null,
    output: typeof attrs['output'] === 'string' ? attrs['output'].slice(0, 2000) : null,
    attributes: attrs,
  };
}

// ---------------------------------------------------------------------------
// GET /api/observability/traces/stats
// ÖNEMLI: /:traceId'den ÖNCE tanımlanmalı
// ---------------------------------------------------------------------------

observabilityRoutes.get('/traces/stats', (c) => {
  const db = getObsDb();

  const totalTraces = (
    db.prepare('SELECT COUNT(*) as n FROM observability_traces').get() as { n: number }
  ).n;

  // Tamamlanmış trace'lerde ortalama süre
  const completedTraces = db
    .prepare("SELECT start_time, end_time FROM observability_traces WHERE end_time IS NOT NULL")
    .all() as RawTrace[];

  let totalDurationMs = 0;
  let durationCount = 0;
  for (const row of completedTraces) {
    const d = calcDurationMs(row.start_time, row.end_time);
    if (d !== null) {
      totalDurationMs += d;
      durationCount++;
    }
  }
  const avgDurationMs = durationCount > 0 ? totalDurationMs / durationCount : null;

  // Hata oranı — status_code=2 olan span'ı olan trace sayısı
  const errorTraceCount = (
    db
      .prepare("SELECT COUNT(DISTINCT trace_id) as n FROM observability_spans WHERE status_code = 2")
      .get() as { n: number }
  ).n;
  const errorRate = totalTraces > 0 ? Math.round((errorTraceCount / totalTraces) * 1000) / 10 : 0;

  // Toplam token (LLM span'larından)
  const tokenResult = db
    .prepare("SELECT SUM(CAST(json_extract(attributes, '$.\"llm.usage.total_tokens\"') AS INTEGER)) as total FROM observability_spans")
    .get() as { total: number | null };
  const totalTokens = tokenResult?.total ?? 0;

  // En aktif agent'lar
  const topAgents = db
    .prepare(
      "SELECT entity_id as name, COUNT(*) as count FROM observability_traces WHERE entity_id IS NOT NULL GROUP BY entity_id ORDER BY count DESC LIMIT 10",
    )
    .all() as { name: string; count: number }[];

  return c.json({
    totalTraces,
    avgDurationMs,
    errorRate,
    totalTokens,
    topAgents,
  });
});

// ---------------------------------------------------------------------------
// GET /api/observability/traces — liste + sayfalama + filtreler
// ---------------------------------------------------------------------------

observabilityRoutes.get('/traces', (c) => {
  const db = getObsDb();

  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const entityId = c.req.query('entity_id');
  const statusFilter = c.req.query('status'); // 'success' | 'error' | 'running'
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (entityId) {
    conditions.push('t.entity_id = ?');
    params.push(entityId);
  }
  if (from) {
    conditions.push('t.start_time >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('t.start_time <= ?');
    params.push(to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalResult = db
    .prepare(`SELECT COUNT(*) as n FROM observability_traces t ${whereClause}`)
    .get(...params) as { n: number };

  const rawTraces = db
    .prepare(
      `SELECT t.* FROM observability_traces t ${whereClause} ORDER BY t.start_time DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as RawTrace[];

  // Her trace için span'ları çek ve formatla
  const traces = rawTraces.map((trace) => {
    const spans = db
      .prepare('SELECT * FROM observability_spans WHERE trace_id = ?')
      .all(trace.trace_id) as RawSpan[];
    return formatTrace(trace, spans);
  });

  // Status filtresi — DB'de sütun yok, client-side uygula
  const filtered = statusFilter ? traces.filter((t) => t.status === statusFilter) : traces;

  return c.json({
    traces: filtered,
    total: totalResult.n,
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// GET /api/observability/traces/:traceId — tek trace + tüm span'lar
// ---------------------------------------------------------------------------

observabilityRoutes.get('/traces/:traceId', (c) => {
  const db = getObsDb();
  const { traceId } = c.req.param();

  const trace = db
    .prepare('SELECT * FROM observability_traces WHERE trace_id = ?')
    .get(traceId) as RawTrace | undefined;

  if (!trace) {
    return c.json({ error: 'Trace not found' }, 404);
  }

  const rawSpans = db
    .prepare('SELECT * FROM observability_spans WHERE trace_id = ? ORDER BY start_time ASC')
    .all(traceId) as RawSpan[];

  const spans = rawSpans.map(formatSpan);
  const formattedTrace = formatTrace(trace, rawSpans);

  return c.json({
    trace: formattedTrace,
    spans,
  });
});
