// ---------------------------------------------------------------------------
// Observability Routes — Memory API + Logs + Studio Events + Trace Viewer + Prompts
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { query, queryOne, execute } from './studio/pg.js';

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

/**
 * Build a numbered PostgreSQL placeholder string for an array of values.
 * startAt lets callers offset the counter when they are appending to an
 * existing params array.
 *
 * Example: numberedPlaceholders(3, 1) → '$1, $2, $3'
 */
function numberedPlaceholders(count: number, startAt = 1): string {
  return Array.from({ length: count }, (_, i) => `$${startAt + i}`).join(', ');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const observabilityRoutes = new Hono();

// GET /api/observability/memory/stats
observabilityRoutes.get('/memory/stats', async (c) => {
  const [convRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM voltagent_memory_conversations',
  );
  const totalConversations = Number(convRow?.n ?? 0);

  const [msgRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM voltagent_memory_messages',
  );
  const totalMessages = Number(msgRow?.n ?? 0);

  const [stepRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM voltagent_memory_steps',
  );
  const totalSteps = Number(stepRow?.n ?? 0);

  const [wfRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM voltagent_memory_workflow_states',
  );
  const totalWorkflows = Number(wfRow?.n ?? 0);

  const byAgent = await query<{ name: string; conversations: number; messages: number }>(
    `SELECT
      c.resource_id as name,
      COUNT(DISTINCT c.id) as conversations,
      COUNT(m.message_id) as messages
    FROM voltagent_memory_conversations c
    LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
    GROUP BY c.resource_id
    ORDER BY conversations DESC`,
  );

  return c.json({ totalConversations, totalMessages, totalSteps, byAgent, totalWorkflows });
});

// GET /api/observability/memory/conversations
observabilityRoutes.get('/memory/conversations', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const agent = c.req.query('agent');

  let rowSql: string;
  let countSql: string;
  let rowParams: unknown[];
  let countParams: unknown[];

  if (agent) {
    rowSql = `SELECT
      c.*,
      COUNT(m.message_id) as message_count,
      MAX(m.created_at) as last_message_at
    FROM voltagent_memory_conversations c
    LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
    WHERE c.resource_id = $1
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT $2 OFFSET $3`;
    rowParams = [agent, limit, offset];

    countSql = 'SELECT COUNT(*) as n FROM voltagent_memory_conversations c WHERE c.resource_id = $1';
    countParams = [agent];
  } else {
    rowSql = `SELECT
      c.*,
      COUNT(m.message_id) as message_count,
      MAX(m.created_at) as last_message_at
    FROM voltagent_memory_conversations c
    LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT $1 OFFSET $2`;
    rowParams = [limit, offset];

    countSql = 'SELECT COUNT(*) as n FROM voltagent_memory_conversations c';
    countParams = [];
  }

  const rows = await query<MemoryConversation>(rowSql, rowParams);
  const [countRow] = await query<{ n: string }>(countSql, countParams);
  const total = Number(countRow?.n ?? 0);

  const conversations = rows.map((r) => ({
    ...r,
    metadata: safeParseJSON(r.metadata),
  }));

  return c.json({ conversations, total });
});

// GET /api/observability/memory/conversations/:id
observabilityRoutes.get('/memory/conversations/:id', async (c) => {
  const id = c.req.param('id');

  const conversation = await queryOne<MemoryConversation>(
    'SELECT * FROM voltagent_memory_conversations WHERE id = $1',
    [id],
  );

  if (!conversation) {
    return c.json({ error: 'Not found' }, 404);
  }

  const messages = await query<MemoryMessage>(
    'SELECT * FROM voltagent_memory_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [id],
  );

  const steps = await query<MemoryStep>(
    'SELECT * FROM voltagent_memory_steps WHERE conversation_id = $1 ORDER BY step_index ASC, created_at ASC',
    [id],
  );

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
});

// GET /api/observability/memory/conversations/:id/messages
observabilityRoutes.get('/memory/conversations/:id/messages', async (c) => {
  const id = c.req.param('id');

  const messages = await query<MemoryMessage>(
    'SELECT * FROM voltagent_memory_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [id],
  );

  return c.json({
    messages: messages.map((m) => ({
      ...m,
      parts: safeParseJSON(m.parts),
      metadata: m.metadata ? safeParseJSON(m.metadata) : null,
    })),
  });
});

// GET /api/observability/memory/workflows
observabilityRoutes.get('/memory/workflows', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const status = c.req.query('status');

  let rowSql: string;
  let countSql: string;
  let rowParams: unknown[];
  let countParams: unknown[];

  if (status) {
    rowSql =
      'SELECT * FROM voltagent_memory_workflow_states WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    rowParams = [status, limit, offset];
    countSql =
      'SELECT COUNT(*) as n FROM voltagent_memory_workflow_states WHERE status = $1';
    countParams = [status];
  } else {
    rowSql =
      'SELECT * FROM voltagent_memory_workflow_states ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    rowParams = [limit, offset];
    countSql = 'SELECT COUNT(*) as n FROM voltagent_memory_workflow_states';
    countParams = [];
  }

  const rows = await query<WorkflowState>(rowSql, rowParams);
  const [countRow] = await query<{ n: string }>(countSql, countParams);
  const total = Number(countRow?.n ?? 0);

  const workflows = rows.map((w) => ({
    ...w,
    input: w.input ? safeParseJSON(w.input) : null,
    output: w.output ? safeParseJSON(w.output) : null,
    events: w.events ? safeParseJSON(w.events) : null,
    context: w.context ? safeParseJSON(w.context) : null,
    metadata: w.metadata ? safeParseJSON(w.metadata) : null,
  }));

  return c.json({ workflows, total });
});

// DELETE /api/observability/memory/conversations/:id
observabilityRoutes.delete('/memory/conversations/:id', async (c) => {
  const id = c.req.param('id');

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM voltagent_memory_conversations WHERE id = $1',
    [id],
  );

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Cascade delete steps and messages manually in case FK is not enforced
  await execute('DELETE FROM voltagent_memory_steps WHERE conversation_id = $1', [id]);
  await execute('DELETE FROM voltagent_memory_messages WHERE conversation_id = $1', [id]);
  await execute('DELETE FROM voltagent_memory_conversations WHERE id = $1', [id]);

  return c.json({ success: true });
});

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

observabilityRoutes.get('/logs', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const severity = c.req.query('severity');
  const traceId = c.req.query('trace_id');
  const search = c.req.query('search');
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (severity) {
    conditions.push(`severity_text = $${params.length + 1}`);
    params.push(severity.toUpperCase());
  }
  if (traceId) {
    conditions.push(`trace_id = $${params.length + 1}`);
    params.push(traceId);
  }
  if (search) {
    conditions.push(`body ILIKE $${params.length + 1}`);
    params.push(`%${search}%`);
  }
  if (from) {
    conditions.push(`timestamp >= $${params.length + 1}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`timestamp <= $${params.length + 1}`);
    params.push(to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow] = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM observability_logs ${where}`,
    params,
  );

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<ObservabilityLog>(
    `SELECT * FROM observability_logs ${where} ORDER BY timestamp DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  const logs = rows.map((row) => ({
    ...row,
    attributes: row.attributes ? (safeParseJSON(row.attributes) as Record<string, unknown>) : null,
  }));

  return c.json({ logs, total: Number(countRow?.cnt ?? 0) });
});

// ---------------------------------------------------------------------------
// GET /api/observability/logs/stats
// ---------------------------------------------------------------------------

observabilityRoutes.get('/logs/stats', async (c) => {
  const [totalRow] = await query<{ cnt: string }>(
    'SELECT COUNT(*) as cnt FROM observability_logs',
  );

  const severityRows = await query<{ severity_text: string | null; cnt: string }>(
    `SELECT severity_text, COUNT(*) as cnt
     FROM observability_logs
     GROUP BY severity_text`,
  );

  const bySeverity: Record<string, number> = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 };
  for (const row of severityRows) {
    const key = (row.severity_text ?? 'DEBUG').toUpperCase();
    bySeverity[key] = (bySeverity[key] ?? 0) + Number(row.cnt);
  }

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const [recentRow] = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM observability_logs WHERE timestamp >= $1`,
    [since],
  );

  return c.json({
    total: Number(totalRow?.cnt ?? 0),
    bySeverity,
    recentRate: Number(recentRow?.cnt ?? 0),
  });
});

// ---------------------------------------------------------------------------
// GET /api/observability/events  (studio DB)
// ---------------------------------------------------------------------------

observabilityRoutes.get('/events', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const type = c.req.query('type');
  const projectId = c.req.query('project_id');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (type) {
    conditions.push(`type = $${params.length + 1}`);
    params.push(type);
  }
  if (projectId) {
    conditions.push(`project_id = $${params.length + 1}`);
    params.push(projectId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow] = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM events ${where}`,
    params,
  );

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<StudioEventRow>(
    `SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  const events = rows.map((row) => ({
    ...row,
    payload: safeParseJSON(row.payload) as Record<string, unknown>,
  }));

  return c.json({ events, total: Number(countRow?.cnt ?? 0) });
});

// ---------------------------------------------------------------------------
// Studio Traces — tasks, pipeline_runs, agent_runs
// ---------------------------------------------------------------------------

observabilityRoutes.get('/studio/traces', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const agent = c.req.query('agent');
  const status = c.req.query('status');

  // Pipeline runs as top-level traces
  const pipelineRuns = await query<{
    id: string; project_id: string; status: string; stages_json: string;
    started_at: string | null; completed_at: string | null; created_at: string;
  }>('SELECT * FROM pipeline_runs ORDER BY started_at DESC');

  // Task-level traces
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (agent) {
    conditions.push(`t.assigned_agent = $${params.length + 1}`);
    params.push(agent);
  }
  if (status) {
    conditions.push(`t.status = $${params.length + 1}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [totalRow] = await query<{ n: string }>(
    `SELECT COUNT(*) as n FROM tasks t ${where}`,
    params,
  );

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const tasks = await query<{
    id: string; title: string; description: string; assigned_agent: string;
    status: string; complexity: string; branch: string; output: string | null;
    error: string | null; task_type: string; started_at: string | null;
    completed_at: string | null; project_id: string; phase_id: string;
  }>(
    `SELECT t.*, pp.project_id FROM tasks t
     JOIN phases ph ON ph.id = t.phase_id
     JOIN project_plans pp ON pp.id = ph.plan_id
     ${where}
     ORDER BY COALESCE(t.started_at, t.completed_at, ph.id::text) DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  // Agent runs — each run is a sub-span
  const agentRuns = await query<{
    id: string; project_id: string; agent_id: string; cli_tool: string;
    status: string; task_prompt: string | null; output_summary: string | null;
    pid: number | null; exit_code: number | null;
    started_at: string | null; stopped_at: string | null; created_at: string;
  }>('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 200');

  // Unique agent names for filter dropdown
  const agentNames = await query<{ assigned_agent: string }>(
    "SELECT DISTINCT assigned_agent FROM tasks WHERE assigned_agent != '' ORDER BY assigned_agent",
  );

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
    total: Number(totalRow?.n ?? 0),
    agents: agentNames.map((a) => a.assigned_agent),
    limit,
    offset,
  });
});

// GET /api/observability/studio/traces/stats
observabilityRoutes.get('/studio/traces/stats', async (c) => {
  const [totalRow] = await query<{ n: string }>('SELECT COUNT(*) as n FROM tasks');
  const totalTasks = Number(totalRow?.n ?? 0);

  const [doneRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'done'");
  const doneTasks = Number(doneRow?.n ?? 0);

  const [failedRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'failed'");
  const failedTasks = Number(failedRow?.n ?? 0);

  const [inProgressRow] = await query<{ n: string }>(
    "SELECT COUNT(*) as n FROM tasks WHERE status IN ('in_progress','running')",
  );
  const inProgress = Number(inProgressRow?.n ?? 0);

  // Avg duration of completed tasks
  const completedRows = await query<{ started_at: string; completed_at: string }>(
    'SELECT started_at, completed_at FROM tasks WHERE started_at IS NOT NULL AND completed_at IS NOT NULL',
  );

  let totalDuration = 0;
  for (const r of completedRows) {
    totalDuration += new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
  }
  const avgDurationMs = completedRows.length > 0 ? totalDuration / completedRows.length : null;

  const errorRate = totalTasks > 0 ? Math.round((failedTasks / totalTasks) * 1000) / 10 : 0;

  const topAgents = await query<{ name: string; count: string }>(
    "SELECT assigned_agent as name, COUNT(*) as count FROM tasks WHERE assigned_agent != '' GROUP BY assigned_agent ORDER BY count DESC LIMIT 10",
  );

  return c.json({
    totalTraces: totalTasks,
    avgDurationMs,
    errorRate,
    totalTokens: 0,
    doneTasks,
    failedTasks,
    inProgress,
    topAgents: topAgents.map((r) => ({ name: r.name, count: Number(r.count) })),
  });
});

// GET /api/observability/studio/traces/:taskId
observabilityRoutes.get('/studio/traces/:taskId', async (c) => {
  const taskId = c.req.param('taskId');

  const task = await queryOne<{
    id: string; title: string; description: string; assigned_agent: string;
    status: string; complexity: string; branch: string; output: string | null;
    error: string | null; task_type: string; started_at: string | null;
    completed_at: string | null; project_id: string; phase_id: string;
  }>(
    'SELECT t.*, pp.project_id FROM tasks t JOIN phases ph ON ph.id = t.phase_id JOIN project_plans pp ON pp.id = ph.plan_id WHERE t.id = $1',
    [taskId],
  );

  if (!task) return c.json({ error: 'Task not found' }, 404);

  const durationMs =
    task.started_at && task.completed_at
      ? new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()
      : null;

  const traceStatus: 'success' | 'error' | 'running' =
    task.status === 'done' ? 'success' :
    task.status === 'failed' ? 'error' :
    (task.status === 'in_progress' || task.status === 'running') ? 'running' : 'success';

  const agentRuns = await query<{
    id: string; cli_tool: string; status: string; task_prompt: string | null;
    output_summary: string | null; exit_code: number | null;
    started_at: string | null; stopped_at: string | null;
  }>(
    'SELECT * FROM agent_runs WHERE project_id = $1 AND agent_id = $2 ORDER BY started_at ASC',
    [task.project_id, task.assigned_agent],
  );

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
// Traces (observability tables) — Types
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
// Traces helpers
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
    input: typeof attrs['input'] === 'string' ? attrs['input'].slice(0, 2000) : null,
    output: typeof attrs['output'] === 'string' ? attrs['output'].slice(0, 2000) : null,
    attributes: attrs,
  };
}

// ---------------------------------------------------------------------------
// GET /api/observability/traces/stats
// IMPORTANT: must be registered before /:traceId
// ---------------------------------------------------------------------------

observabilityRoutes.get('/traces/stats', async (c) => {
  const [totalRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM observability_traces',
  );
  const totalTraces = Number(totalRow?.n ?? 0);

  const completedTraces = await query<{ start_time: string; end_time: string }>(
    'SELECT start_time, end_time FROM observability_traces WHERE end_time IS NOT NULL',
  );

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

  const [errorCountRow] = await query<{ n: string }>(
    "SELECT COUNT(DISTINCT trace_id) as n FROM observability_spans WHERE status_code = 2",
  );
  const errorTraceCount = Number(errorCountRow?.n ?? 0);
  const errorRate = totalTraces > 0 ? Math.round((errorTraceCount / totalTraces) * 1000) / 10 : 0;

  // PostgreSQL JSON operator: attributes->>'llm.usage.total_tokens'
  const [tokenRow] = await query<{ total: string | null }>(
    `SELECT SUM((attributes->>'llm.usage.total_tokens')::numeric) as total FROM observability_spans`,
  );
  const totalTokens = tokenRow?.total != null ? Number(tokenRow.total) : 0;

  const topAgents = await query<{ name: string; count: string }>(
    "SELECT entity_id as name, COUNT(*) as count FROM observability_traces WHERE entity_id IS NOT NULL GROUP BY entity_id ORDER BY count DESC LIMIT 10",
  );

  return c.json({
    totalTraces,
    avgDurationMs,
    errorRate,
    totalTokens,
    topAgents: topAgents.map((r) => ({ name: r.name, count: Number(r.count) })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/observability/traces — list + pagination + filters
// ---------------------------------------------------------------------------

observabilityRoutes.get('/traces', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const entityId = c.req.query('entity_id');
  const statusFilter = c.req.query('status'); // 'success' | 'error' | 'running'
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (entityId) {
    conditions.push(`t.entity_id = $${params.length + 1}`);
    params.push(entityId);
  }
  if (from) {
    conditions.push(`t.start_time >= $${params.length + 1}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`t.start_time <= $${params.length + 1}`);
    params.push(to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [totalResult] = await query<{ n: string }>(
    `SELECT COUNT(*) as n FROM observability_traces t ${whereClause}`,
    params,
  );

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rawTraces = await query<RawTrace>(
    `SELECT t.* FROM observability_traces t ${whereClause} ORDER BY t.start_time DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  // Fetch spans for each trace and format
  const traces = await Promise.all(
    rawTraces.map(async (trace) => {
      const spans = await query<RawSpan>(
        'SELECT * FROM observability_spans WHERE trace_id = $1',
        [trace.trace_id],
      );
      return formatTrace(trace, spans);
    }),
  );

  // Status filter — column not in DB, apply in-process
  const filtered = statusFilter ? traces.filter((t) => t.status === statusFilter) : traces;

  return c.json({
    traces: filtered,
    total: Number(totalResult?.n ?? 0),
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// GET /api/observability/traces/:traceId — single trace + all spans
// ---------------------------------------------------------------------------

observabilityRoutes.get('/traces/:traceId', async (c) => {
  const { traceId } = c.req.param();

  const trace = await queryOne<RawTrace>(
    'SELECT * FROM observability_traces WHERE trace_id = $1',
    [traceId],
  );

  if (!trace) {
    return c.json({ error: 'Trace not found' }, 404);
  }

  const rawSpans = await query<RawSpan>(
    'SELECT * FROM observability_spans WHERE trace_id = $1 ORDER BY start_time ASC',
    [traceId],
  );

  const spans = rawSpans.map(formatSpan);
  const formattedTrace = formatTrace(trace, rawSpans);

  return c.json({
    trace: formattedTrace,
    spans,
  });
});

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  variables: string;
  tags: string;
  version: number;
  parent_id: string | null;
  is_active: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

function parsePromptTemplate(row: PromptTemplate) {
  return {
    ...row,
    variables: safeParseJSON(row.variables) as string[],
    tags: safeParseJSON(row.tags) as string[],
    is_active: Boolean(row.is_active),
  };
}

// GET /api/observability/prompts/stats
observabilityRoutes.get('/prompts/stats', async (c) => {
  const [activeRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM prompt_templates WHERE is_active = 1',
  );
  const totalTemplates = Number(activeRow?.n ?? 0);

  const [allRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM prompt_templates',
  );
  const totalVersions = Number(allRow?.n ?? 0);

  const categoryRows = await query<{ category: string; n: string }>(
    'SELECT category, COUNT(*) as n FROM prompt_templates WHERE is_active = 1 GROUP BY category',
  );

  const byCategory: Record<string, number> = {
    system: 0, user: 0, agent: 0, tool: 0, general: 0,
  };
  for (const row of categoryRows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + Number(row.n);
  }

  const mostUsed = await query<{ id: string; name: string; usage_count: number }>(
    'SELECT id, name, usage_count FROM prompt_templates WHERE is_active = 1 ORDER BY usage_count DESC LIMIT 5',
  );

  const recentlyUpdated = await query<{ id: string; name: string; updated_at: string }>(
    'SELECT id, name, updated_at FROM prompt_templates WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 5',
  );

  return c.json({ totalTemplates, byCategory, totalVersions, mostUsed, recentlyUpdated });
});

// GET /api/observability/prompts
observabilityRoutes.get('/prompts', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const category = c.req.query('category');
  const tag = c.req.query('tag');
  const search = c.req.query('search');
  const activeOnly = c.req.query('active_only') !== 'false';
  const sort = c.req.query('sort') ?? 'recent'; // most_used | recent | alpha

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (activeOnly) {
    conditions.push('is_active = 1');
  }
  if (category && category !== 'all') {
    conditions.push(`category = $${params.length + 1}`);
    params.push(category);
  }
  if (tag) {
    conditions.push(`tags ILIKE $${params.length + 1}`);
    params.push(`%${tag}%`);
  }
  if (search) {
    conditions.push(`(name ILIKE $${params.length + 1} OR content ILIKE $${params.length + 2})`);
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderBy =
    sort === 'most_used' ? 'ORDER BY usage_count DESC, updated_at DESC' :
    sort === 'alpha' ? 'ORDER BY name ASC' :
    'ORDER BY updated_at DESC';

  const [countRow] = await query<{ n: string }>(
    `SELECT COUNT(*) as n FROM prompt_templates ${where}`,
    params,
  );
  const total = Number(countRow?.n ?? 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<PromptTemplate>(
    `SELECT * FROM prompt_templates ${where} ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  return c.json({
    templates: rows.map(parsePromptTemplate),
    total,
    limit,
    offset,
  });
});

// POST /api/observability/prompts
observabilityRoutes.post('/prompts', async (c) => {
  const body = await c.req.json() as {
    name: string;
    description?: string;
    category?: string;
    content: string;
    variables?: string[];
    tags?: string[];
  };

  if (!body.name || !body.content) {
    return c.json({ error: 'name and content are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO prompt_templates (id, name, description, category, content, variables, tags, version, parent_id, is_active, usage_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NULL, 1, 0, $8, $9)`,
    [
      id,
      body.name,
      body.description ?? '',
      body.category ?? 'general',
      body.content,
      JSON.stringify(body.variables ?? []),
      JSON.stringify(body.tags ?? []),
      now,
      now,
    ],
  );

  const created = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [id],
  );
  return c.json({ template: parsePromptTemplate(created!) }, 201);
});

// GET /api/observability/prompts/:id
observabilityRoutes.get('/prompts/:id', async (c) => {
  const id = c.req.param('id');

  const template = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [id],
  );

  if (!template) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Build version history chain by walking parent_id backwards
  const history: PromptTemplate[] = [];
  let current: PromptTemplate | undefined = template;
  while (current?.parent_id) {
    const parentId: string = current.parent_id;
    const parent: PromptTemplate | undefined = await queryOne<PromptTemplate>(
      'SELECT * FROM prompt_templates WHERE id = $1',
      [parentId],
    );
    if (parent) {
      history.push(parent);
      current = parent;
    } else {
      break;
    }
  }

  return c.json({
    template: parsePromptTemplate(template),
    history: history.map(parsePromptTemplate),
  });
});

// PUT /api/observability/prompts/:id
observabilityRoutes.put('/prompts/:id', async (c) => {
  const id = c.req.param('id');

  const existing = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [id],
  );

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const body = await c.req.json() as {
    name?: string;
    description?: string;
    category?: string;
    content?: string;
    variables?: string[];
    tags?: string[];
  };

  // Create new version: new row with parent_id pointing to current id
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO prompt_templates (id, name, description, category, content, variables, tags, version, parent_id, is_active, usage_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 0, $10, $11)`,
    [
      newId,
      body.name ?? existing.name,
      body.description ?? existing.description,
      body.category ?? existing.category,
      body.content ?? existing.content,
      JSON.stringify(body.variables ?? (safeParseJSON(existing.variables) as string[])),
      JSON.stringify(body.tags ?? (safeParseJSON(existing.tags) as string[])),
      existing.version + 1,
      id, // parent_id = old id
      existing.created_at, // keep original created_at
      now,
    ],
  );

  // Soft-deactivate old version
  await execute('UPDATE prompt_templates SET is_active = 0 WHERE id = $1', [id]);

  const updated = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [newId],
  );
  return c.json({ template: parsePromptTemplate(updated!) });
});

// DELETE /api/observability/prompts/:id
observabilityRoutes.delete('/prompts/:id', async (c) => {
  const id = c.req.param('id');

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM prompt_templates WHERE id = $1',
    [id],
  );

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  await execute(
    'UPDATE prompt_templates SET is_active = 0, updated_at = $1 WHERE id = $2',
    [new Date().toISOString(), id],
  );

  return c.json({ success: true });
});

// POST /api/observability/prompts/:id/duplicate
observabilityRoutes.post('/prompts/:id/duplicate', async (c) => {
  const id = c.req.param('id');

  const existing = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [id],
  );

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO prompt_templates (id, name, description, category, content, variables, tags, version, parent_id, is_active, usage_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NULL, 1, 0, $8, $9)`,
    [
      newId,
      `${existing.name} (Copy)`,
      existing.description,
      existing.category,
      existing.content,
      existing.variables,
      existing.tags,
      now,
      now,
    ],
  );

  const created = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [newId],
  );
  return c.json({ template: parsePromptTemplate(created!) }, 201);
});

// POST /api/observability/prompts/:id/use
observabilityRoutes.post('/prompts/:id/use', async (c) => {
  const id = c.req.param('id');

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM prompt_templates WHERE id = $1',
    [id],
  );

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  await execute(
    'UPDATE prompt_templates SET usage_count = usage_count + 1 WHERE id = $1',
    [id],
  );

  const updated = await queryOne<{ usage_count: number }>(
    'SELECT usage_count FROM prompt_templates WHERE id = $1',
    [id],
  );
  return c.json({ usage_count: updated!.usage_count });
});

// ---------------------------------------------------------------------------
// Alerts — alert_rules and alert_history tables
// ---------------------------------------------------------------------------

interface AlertRule {
  id: string;
  name: string;
  description: string;
  type: string;
  condition: string;
  channels: string;
  enabled: number;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertHistoryRow {
  id: string;
  rule_id: string;
  status: string;
  message: string;
  context: string | null;
  triggered_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

function formatAlertRule(r: AlertRule) {
  return {
    ...r,
    enabled: Boolean(r.enabled),
    condition: safeParseJSON(r.condition),
    channels: safeParseJSON(r.channels),
  };
}

function formatAlertHistory(h: AlertHistoryRow) {
  return {
    ...h,
    context: h.context ? safeParseJSON(h.context) : null,
  };
}

// GET /api/observability/alerts
observabilityRoutes.get('/alerts', async (c) => {
  const rows = await query<AlertRule>('SELECT * FROM alert_rules ORDER BY created_at DESC');
  return c.json({ rules: rows.map(formatAlertRule) });
});

// GET /api/observability/alerts/stats
// IMPORTANT: must be registered before /alerts/:id
observabilityRoutes.get('/alerts/stats', async (c) => {
  const [totalRow] = await query<{ n: string }>('SELECT COUNT(*) as n FROM alert_rules');
  const totalRules = Number(totalRow?.n ?? 0);

  const [activeRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM alert_rules WHERE enabled = 1',
  );
  const activeRules = Number(activeRow?.n ?? 0);

  const [totalAlertsRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM alert_history',
  );
  const totalAlerts = Number(totalAlertsRow?.n ?? 0);

  const [unresolvedRow] = await query<{ n: string }>(
    "SELECT COUNT(*) as n FROM alert_history WHERE status = 'triggered'",
  );
  const unresolvedAlerts = Number(unresolvedRow?.n ?? 0);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [recentRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM alert_history WHERE triggered_at >= $1',
    [since24h],
  );
  const recentAlerts = Number(recentRow?.n ?? 0);

  return c.json({ totalRules, activeRules, totalAlerts, unresolvedAlerts, recentAlerts });
});

// GET /api/observability/alerts/history
// IMPORTANT: must be registered before /alerts/:id
observabilityRoutes.get('/alerts/history', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const ruleId = c.req.query('rule_id');
  const status = c.req.query('status');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (ruleId) {
    conditions.push(`rule_id = $${params.length + 1}`);
    params.push(ruleId);
  }
  if (status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow] = await query<{ n: string }>(
    `SELECT COUNT(*) as n FROM alert_history ${where}`,
    params,
  );
  const total = Number(countRow?.n ?? 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<AlertHistoryRow>(
    `SELECT * FROM alert_history ${where} ORDER BY triggered_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  const allRules = await query<{ id: string; name: string }>(
    'SELECT id, name FROM alert_rules',
  );
  const ruleNames: Record<string, string> = {};
  for (const r of allRules) ruleNames[r.id] = r.name;

  return c.json({
    history: rows.map((h) => ({ ...formatAlertHistory(h), rule_name: ruleNames[h.rule_id] ?? null })),
    total,
  });
});

// PUT /api/observability/alerts/history/:id/acknowledge
observabilityRoutes.put('/alerts/history/:id/acknowledge', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<AlertHistoryRow>(
    'SELECT * FROM alert_history WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json().catch(() => ({})) as { acknowledged_by?: string };
  const now = new Date().toISOString();

  await execute(
    "UPDATE alert_history SET status = 'acknowledged', acknowledged_at = $1, acknowledged_by = $2 WHERE id = $3",
    [now, body.acknowledged_by ?? 'user', id],
  );

  const updated = await queryOne<AlertHistoryRow>(
    'SELECT * FROM alert_history WHERE id = $1',
    [id],
  );
  return c.json({ history: formatAlertHistory(updated!) });
});

// POST /api/observability/alerts
observabilityRoutes.post('/alerts', async (c) => {
  const body = await c.req.json() as {
    name: string;
    description?: string;
    type: string;
    condition: unknown;
    channels?: unknown[];
    enabled?: boolean;
    cooldown_minutes?: number;
  };

  if (!body.name || !body.type || !body.condition) {
    return c.json({ error: 'name, type ve condition zorunludur' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO alert_rules (id, name, description, type, condition, channels, enabled, cooldown_minutes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      body.name,
      body.description ?? '',
      body.type,
      JSON.stringify(body.condition),
      JSON.stringify(body.channels ?? []),
      body.enabled !== false ? 1 : 0,
      body.cooldown_minutes ?? 15,
      now,
      now,
    ],
  );

  const rule = await queryOne<AlertRule>('SELECT * FROM alert_rules WHERE id = $1', [id]);
  return c.json({ rule: formatAlertRule(rule!) }, 201);
});

// PUT /api/observability/alerts/:id/toggle
observabilityRoutes.put('/alerts/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<AlertRule>(
    'SELECT * FROM alert_rules WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const newEnabled = existing.enabled === 1 ? 0 : 1;
  await execute(
    'UPDATE alert_rules SET enabled = $1, updated_at = $2 WHERE id = $3',
    [newEnabled, new Date().toISOString(), id],
  );

  const rule = await queryOne<AlertRule>('SELECT * FROM alert_rules WHERE id = $1', [id]);
  return c.json({ rule: formatAlertRule(rule!) });
});

// PUT /api/observability/alerts/:id
observabilityRoutes.put('/alerts/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<AlertRule>(
    'SELECT * FROM alert_rules WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Partial<{
    name: string;
    description: string;
    type: string;
    condition: unknown;
    channels: unknown[];
    enabled: boolean;
    cooldown_minutes: number;
  }>;

  const now = new Date().toISOString();

  await execute(
    `UPDATE alert_rules SET
      name = $1,
      description = $2,
      type = $3,
      condition = $4,
      channels = $5,
      enabled = $6,
      cooldown_minutes = $7,
      updated_at = $8
    WHERE id = $9`,
    [
      body.name ?? existing.name,
      body.description ?? existing.description,
      body.type ?? existing.type,
      body.condition !== undefined ? JSON.stringify(body.condition) : existing.condition,
      body.channels !== undefined ? JSON.stringify(body.channels) : existing.channels,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.cooldown_minutes ?? existing.cooldown_minutes,
      now,
      id,
    ],
  );

  const rule = await queryOne<AlertRule>('SELECT * FROM alert_rules WHERE id = $1', [id]);
  return c.json({ rule: formatAlertRule(rule!) });
});

// DELETE /api/observability/alerts/:id
observabilityRoutes.delete('/alerts/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM alert_rules WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Cascade: delete history first
  await execute('DELETE FROM alert_history WHERE rule_id = $1', [id]);
  await execute('DELETE FROM alert_rules WHERE id = $1', [id]);
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Feedbacks table
// ---------------------------------------------------------------------------

type FeedbackRow = {
  id: string;
  trace_id: string | null;
  span_id: string | null;
  agent_id: string | null;
  rating: number;
  rating_type: string;
  comment: string;
  tags: string;
  user_id: string;
  created_at: string;
};

function parseFeedbackRow(row: FeedbackRow) {
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(row.tags) as string[];
  } catch {
    // ignore
  }
  return { ...row, tags: parsedTags };
}

// GET /api/observability/feedbacks/stats — registered before /:id to avoid param clash
observabilityRoutes.get('/feedbacks/stats', async (c) => {
  const [totalRow] = await query<{ n: string }>('SELECT COUNT(*) as n FROM feedbacks');
  const totalFeedbacks = Number(totalRow?.n ?? 0);

  const [avgRow] = await query<{ avg: number | null }>(
    "SELECT AVG(CAST(rating AS REAL)) as avg FROM feedbacks WHERE rating_type = 'stars'",
  );
  const avgRating = avgRow?.avg != null ? Math.round(avgRow.avg * 100) / 100 : null;

  const distRows = await query<{ rating: number; cnt: string }>(
    "SELECT rating, COUNT(*) as cnt FROM feedbacks WHERE rating_type = 'stars' GROUP BY rating",
  );
  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of distRows) {
    ratingDistribution[row.rating] = Number(row.cnt);
  }

  const byAgentRows = await query<{ name: string; avgRating: number; count: string }>(
    `SELECT agent_id as name,
            AVG(CAST(rating AS REAL)) as "avgRating",
            COUNT(*) as count
     FROM feedbacks
     WHERE agent_id IS NOT NULL AND agent_id != '' AND rating_type = 'stars'
     GROUP BY agent_id
     ORDER BY count DESC`,
  );
  const byAgent = byAgentRows.map((r) => ({
    name: r.name,
    avgRating: Math.round(r.avgRating * 100) / 100,
    count: Number(r.count),
  }));

  const allTagsRows = await query<{ tags: string }>('SELECT tags FROM feedbacks');
  const tagCounts: Record<string, number> = {};
  for (const row of allTagsRows) {
    try {
      const tags = JSON.parse(row.tags) as string[];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    } catch {
      // ignore
    }
  }
  const topTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const recentTrendRows = await query<{ day: string; cnt: string }>(
    `SELECT DATE(created_at) as day, COUNT(*) as cnt
     FROM feedbacks
     WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
     GROUP BY day
     ORDER BY day ASC`,
  );
  const recentTrend = recentTrendRows.map((r) => ({ day: r.day, count: Number(r.cnt) }));

  return c.json({ totalFeedbacks, avgRating, ratingDistribution, byAgent, topTags, recentTrend });
});

// GET /api/observability/feedbacks
observabilityRoutes.get('/feedbacks', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const agentId = c.req.query('agent_id');
  const ratingType = c.req.query('rating_type');
  const minRating = c.req.query('min_rating');
  const tag = c.req.query('tag');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (agentId) {
    conditions.push(`agent_id = $${params.length + 1}`);
    params.push(agentId);
  }
  if (ratingType) {
    conditions.push(`rating_type = $${params.length + 1}`);
    params.push(ratingType);
  }
  if (minRating) {
    conditions.push(`rating >= $${params.length + 1}`);
    params.push(parseInt(minRating, 10));
  }
  if (tag) {
    conditions.push(`tags ILIKE $${params.length + 1}`);
    params.push(`%${tag}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow] = await query<{ n: string }>(
    `SELECT COUNT(*) as n FROM feedbacks ${where}`,
    params,
  );
  const total = Number(countRow?.n ?? 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<FeedbackRow>(
    `SELECT * FROM feedbacks ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  return c.json({ feedbacks: rows.map(parseFeedbackRow), total, limit, offset });
});

// POST /api/observability/feedbacks
observabilityRoutes.post('/feedbacks', async (c) => {
  const body = await c.req.json() as {
    trace_id?: string;
    span_id?: string;
    agent_id?: string;
    rating: number;
    rating_type?: string;
    comment?: string;
    tags?: string[];
    user_id?: string;
  };

  if (body.rating === undefined || body.rating === null) {
    return c.json({ error: 'rating is required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO feedbacks (id, trace_id, span_id, agent_id, rating, rating_type, comment, tags, user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      body.trace_id ?? null,
      body.span_id ?? null,
      body.agent_id ?? null,
      body.rating,
      body.rating_type ?? 'stars',
      body.comment ?? '',
      JSON.stringify(body.tags ?? []),
      body.user_id ?? 'anonymous',
      now,
    ],
  );

  const feedback = await queryOne<FeedbackRow>(
    'SELECT * FROM feedbacks WHERE id = $1',
    [id],
  );
  return c.json(parseFeedbackRow(feedback!), 201);
});

// GET /api/observability/feedbacks/:id
observabilityRoutes.get('/feedbacks/:id', async (c) => {
  const row = await queryOne<FeedbackRow>(
    'SELECT * FROM feedbacks WHERE id = $1',
    [c.req.param('id')],
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(parseFeedbackRow(row));
});

// DELETE /api/observability/feedbacks/:id
observabilityRoutes.delete('/feedbacks/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM feedbacks WHERE id = $1',
    [id],
  );
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }
  await execute('DELETE FROM feedbacks WHERE id = $1', [id]);
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

interface TriggerRow {
  id: string;
  name: string;
  description: string;
  type: string;
  config: string;
  action: string;
  enabled: number;
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
  updated_at: string;
}

interface TriggerLogRow {
  id: string;
  trigger_id: string;
  status: string;
  input: string | null;
  output: string | null;
  duration_ms: number | null;
  fired_at: string;
}

function parseTriggerRow(row: TriggerRow) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    config: (() => { try { return JSON.parse(row.config); } catch { return {}; } })(),
    action: (() => { try { return JSON.parse(row.action); } catch { return {}; } })(),
  };
}

function parseTriggerLogRow(row: TriggerLogRow) {
  return {
    ...row,
    input: row.input ? (() => { try { return JSON.parse(row.input!); } catch { return row.input; } })() : null,
    output: row.output ? (() => { try { return JSON.parse(row.output!); } catch { return row.output; } })() : null,
  };
}

// GET /api/observability/triggers/stats — must be registered before /:id
observabilityRoutes.get('/triggers/stats', async (c) => {
  const [totalRow] = await query<{ n: string }>('SELECT COUNT(*) as n FROM triggers');
  const total = Number(totalRow?.n ?? 0);

  const [activeRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM triggers WHERE enabled = 1',
  );
  const active = Number(activeRow?.n ?? 0);

  const [firesRow] = await query<{ n: string }>(
    'SELECT COALESCE(SUM(fire_count), 0) as n FROM triggers',
  );
  const totalFires = Number(firesRow?.n ?? 0);

  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [recentRow] = await query<{ n: string }>(
    'SELECT COUNT(*) as n FROM trigger_logs WHERE fired_at >= $1',
    [recentCutoff],
  );
  const recentFires24h = Number(recentRow?.n ?? 0);

  const byTypeRows = await query<{ type: string; cnt: string }>(
    'SELECT type, COUNT(*) as cnt FROM triggers GROUP BY type',
  );
  const byType: Record<string, number> = { webhook: 0, schedule: 0, event: 0, condition: 0 };
  for (const r of byTypeRows) byType[r.type] = Number(r.cnt);

  return c.json({ total, active, totalFires, recentFires24h, byType });
});

// GET /api/observability/triggers
observabilityRoutes.get('/triggers', async (c) => {
  const rows = await query<TriggerRow>('SELECT * FROM triggers ORDER BY created_at DESC');
  return c.json({ triggers: rows.map(parseTriggerRow) });
});

// POST /api/observability/triggers
observabilityRoutes.post('/triggers', async (c) => {
  const body = await c.req.json() as {
    name: string;
    description?: string;
    type: string;
    config: Record<string, unknown>;
    action: Record<string, unknown>;
    enabled?: boolean;
  };

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  if (!body.type) return c.json({ error: 'type is required' }, 400);
  if (!body.config) return c.json({ error: 'config is required' }, 400);
  if (!body.action) return c.json({ error: 'action is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO triggers (id, name, description, type, config, action, enabled, last_fired_at, fire_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 0, $8, $9)`,
    [
      id,
      body.name.trim(),
      body.description?.trim() ?? '',
      body.type,
      JSON.stringify(body.config),
      JSON.stringify(body.action),
      body.enabled !== false ? 1 : 0,
      now,
      now,
    ],
  );

  const row = await queryOne<TriggerRow>('SELECT * FROM triggers WHERE id = $1', [id]);
  return c.json(parseTriggerRow(row!), 201);
});

// GET /api/observability/triggers/:id
observabilityRoutes.get('/triggers/:id', async (c) => {
  const row = await queryOne<TriggerRow>(
    'SELECT * FROM triggers WHERE id = $1',
    [c.req.param('id')],
  );
  if (!row) return c.json({ error: 'Not found' }, 404);

  const recentLogs = await query<TriggerLogRow>(
    'SELECT * FROM trigger_logs WHERE trigger_id = $1 ORDER BY fired_at DESC LIMIT 10',
    [row.id],
  );

  return c.json({ ...parseTriggerRow(row), recentLogs: recentLogs.map(parseTriggerLogRow) });
});

// PUT /api/observability/triggers/:id
observabilityRoutes.put('/triggers/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM triggers WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as {
    name?: string;
    description?: string;
    type?: string;
    config?: Record<string, unknown>;
    action?: Record<string, unknown>;
    enabled?: boolean;
  };

  const now = new Date().toISOString();
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (body.name !== undefined) { setClauses.push(`name = $${params.length + 1}`); params.push(body.name.trim()); }
  if (body.description !== undefined) { setClauses.push(`description = $${params.length + 1}`); params.push(body.description.trim()); }
  if (body.type !== undefined) { setClauses.push(`type = $${params.length + 1}`); params.push(body.type); }
  if (body.config !== undefined) { setClauses.push(`config = $${params.length + 1}`); params.push(JSON.stringify(body.config)); }
  if (body.action !== undefined) { setClauses.push(`action = $${params.length + 1}`); params.push(JSON.stringify(body.action)); }
  if (body.enabled !== undefined) { setClauses.push(`enabled = $${params.length + 1}`); params.push(body.enabled ? 1 : 0); }

  setClauses.push(`updated_at = $${params.length + 1}`);
  params.push(now);
  params.push(id); // WHERE id = $N

  await execute(
    `UPDATE triggers SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
    params,
  );

  const row = await queryOne<TriggerRow>('SELECT * FROM triggers WHERE id = $1', [id]);
  return c.json(parseTriggerRow(row!));
});

// DELETE /api/observability/triggers/:id
observabilityRoutes.delete('/triggers/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM triggers WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await execute('DELETE FROM trigger_logs WHERE trigger_id = $1', [id]);
  await execute('DELETE FROM triggers WHERE id = $1', [id]);
  return c.json({ success: true });
});

// PUT /api/observability/triggers/:id/toggle
observabilityRoutes.put('/triggers/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const row = await queryOne<{ id: string; enabled: number }>(
    'SELECT id, enabled FROM triggers WHERE id = $1',
    [id],
  );
  if (!row) return c.json({ error: 'Not found' }, 404);

  const newEnabled = row.enabled === 1 ? 0 : 1;
  const now = new Date().toISOString();
  await execute(
    'UPDATE triggers SET enabled = $1, updated_at = $2 WHERE id = $3',
    [newEnabled, now, id],
  );

  const updated = await queryOne<TriggerRow>('SELECT * FROM triggers WHERE id = $1', [id]);
  return c.json(parseTriggerRow(updated!));
});

// POST /api/observability/triggers/:id/test
observabilityRoutes.post('/triggers/:id/test', async (c) => {
  const id = c.req.param('id');
  const trigger = await queryOne<TriggerRow>(
    'SELECT * FROM triggers WHERE id = $1',
    [id],
  );
  if (!trigger) return c.json({ error: 'Not found' }, 404);

  const logId = crypto.randomUUID();
  const now = new Date().toISOString();
  const durationMs = Math.floor(Math.random() * 50) + 10;

  await execute(
    `INSERT INTO trigger_logs (id, trigger_id, status, input, output, duration_ms, fired_at)
     VALUES ($1, $2, 'success', $3, $4, $5, $6)`,
    [
      logId,
      id,
      JSON.stringify({ source: 'manual_test' }),
      JSON.stringify({ result: 'Test fired successfully' }),
      durationMs,
      now,
    ],
  );

  await execute(
    'UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = $1, updated_at = $2 WHERE id = $3',
    [now, now, id],
  );

  const logRow = await queryOne<TriggerLogRow>(
    'SELECT * FROM trigger_logs WHERE id = $1',
    [logId],
  );
  return c.json({ success: true, log: parseTriggerLogRow(logRow!) });
});

// GET /api/observability/triggers/:id/logs
observabilityRoutes.get('/triggers/:id/logs', async (c) => {
  const id = c.req.param('id');
  const triggerExists = await queryOne<{ id: string }>(
    'SELECT id FROM triggers WHERE id = $1',
    [id],
  );
  if (!triggerExists) return c.json({ error: 'Not found' }, 404);

  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const status = c.req.query('status');

  const params: unknown[] = [id];
  const conditions = [`trigger_id = $1`];

  if (status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(status);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRow] = await query<{ n: string }>(
    `SELECT COUNT(*) as n FROM trigger_logs ${where}`,
    params,
  );
  const total = Number(countRow?.n ?? 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<TriggerLogRow>(
    `SELECT * FROM trigger_logs ${where} ORDER BY fired_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  return c.json({ logs: rows.map(parseTriggerLogRow), total, limit, offset });
});

// ---------------------------------------------------------------------------
// RAG (Retrieval Augmented Generation) Routes
// ---------------------------------------------------------------------------

interface RagKnowledgeBase {
  id: string;
  name: string;
  description: string;
  type: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  status: string;
  document_count: number;
  total_chunks: number;
  last_indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RagDocument {
  id: string;
  kb_id: string;
  name: string;
  source: string;
  content_preview: string;
  chunk_count: number;
  size_bytes: number;
  status: string;
  metadata: string;
  created_at: string;
}

interface RagQuery {
  id: string;
  kb_id: string | null;
  query: string;
  results_count: number;
  latency_ms: number | null;
  agent_id: string | null;
  created_at: string;
}

// GET /api/observability/rag/knowledge-bases/stats — MUST be before /:id
observabilityRoutes.get('/rag/knowledge-bases/stats', async (c) => {
  const [kbRow] = await query<{ n: string }>('SELECT COUNT(*) as n FROM rag_knowledge_bases');
  const totalKBs = Number(kbRow?.n ?? 0);

  const [docRow] = await query<{ n: string }>(
    'SELECT COALESCE(SUM(document_count),0) as n FROM rag_knowledge_bases',
  );
  const totalDocuments = Number(docRow?.n ?? 0);

  const [chunkRow] = await query<{ n: string }>(
    'SELECT COALESCE(SUM(total_chunks),0) as n FROM rag_knowledge_bases',
  );
  const totalChunks = Number(chunkRow?.n ?? 0);

  const [queryCountRow] = await query<{ n: string }>('SELECT COUNT(*) as n FROM rag_queries');
  const totalQueries = Number(queryCountRow?.n ?? 0);

  const [latencyRow] = await query<{ avg: number | null }>(
    'SELECT AVG(latency_ms) as avg FROM rag_queries WHERE latency_ms IS NOT NULL',
  );
  const avgLatency = latencyRow?.avg ? Math.round(latencyRow.avg) : 0;

  const typeRows = await query<{ type: string; cnt: string }>(
    'SELECT type, COUNT(*) as cnt FROM rag_knowledge_bases GROUP BY type',
  );
  const byType: Record<string, number> = { text: 0, pdf: 0, web: 0, code: 0, csv: 0 };
  for (const row of typeRows) {
    byType[row.type] = Number(row.cnt);
  }

  return c.json({ totalKBs, totalDocuments, totalChunks, totalQueries, avgLatency, byType });
});

// GET /api/observability/rag/knowledge-bases
observabilityRoutes.get('/rag/knowledge-bases', async (c) => {
  const rows = await query<RagKnowledgeBase>(
    'SELECT * FROM rag_knowledge_bases ORDER BY created_at DESC',
  );
  return c.json({ knowledgeBases: rows });
});

// POST /api/observability/rag/knowledge-bases
observabilityRoutes.post('/rag/knowledge-bases', async (c) => {
  const body = await c.req.json() as {
    name: string;
    description?: string;
    type?: string;
    embedding_model?: string;
    chunk_size?: number;
    chunk_overlap?: number;
  };

  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO rag_knowledge_bases (id, name, description, type, embedding_model, chunk_size, chunk_overlap, status, document_count, total_chunks, last_indexed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 0, 0, NULL, $8, $9)`,
    [
      id,
      body.name,
      body.description ?? '',
      body.type ?? 'text',
      body.embedding_model ?? 'text-embedding-3-small',
      body.chunk_size ?? 512,
      body.chunk_overlap ?? 50,
      now,
      now,
    ],
  );

  const kb = await queryOne<RagKnowledgeBase>(
    'SELECT * FROM rag_knowledge_bases WHERE id = $1',
    [id],
  );
  return c.json(kb!, 201);
});

// GET /api/observability/rag/knowledge-bases/:id
observabilityRoutes.get('/rag/knowledge-bases/:id', async (c) => {
  const id = c.req.param('id');
  const kb = await queryOne<RagKnowledgeBase>(
    'SELECT * FROM rag_knowledge_bases WHERE id = $1',
    [id],
  );
  if (!kb) return c.json({ error: 'Not found' }, 404);

  const documents = await query<RagDocument>(
    'SELECT * FROM rag_documents WHERE kb_id = $1 ORDER BY created_at DESC',
    [id],
  );
  return c.json({ ...kb, documents });
});

// PUT /api/observability/rag/knowledge-bases/:id
observabilityRoutes.put('/rag/knowledge-bases/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<RagKnowledgeBase>(
    'SELECT * FROM rag_knowledge_bases WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as Partial<RagKnowledgeBase>;
  const now = new Date().toISOString();

  await execute(
    `UPDATE rag_knowledge_bases SET
      name = $1,
      description = $2,
      type = $3,
      embedding_model = $4,
      chunk_size = $5,
      chunk_overlap = $6,
      status = $7,
      updated_at = $8
    WHERE id = $9`,
    [
      body.name ?? existing.name,
      body.description ?? existing.description,
      body.type ?? existing.type,
      body.embedding_model ?? existing.embedding_model,
      body.chunk_size ?? existing.chunk_size,
      body.chunk_overlap ?? existing.chunk_overlap,
      body.status ?? existing.status,
      now,
      id,
    ],
  );

  const updated = await queryOne<RagKnowledgeBase>(
    'SELECT * FROM rag_knowledge_bases WHERE id = $1',
    [id],
  );
  return c.json(updated!);
});

// DELETE /api/observability/rag/knowledge-bases/:id
observabilityRoutes.delete('/rag/knowledge-bases/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM rag_knowledge_bases WHERE id = $1',
    [id],
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await execute('DELETE FROM rag_documents WHERE kb_id = $1', [id]);
  await execute('DELETE FROM rag_knowledge_bases WHERE id = $1', [id]);
  return c.json({ success: true });
});

// POST /api/observability/rag/knowledge-bases/:id/documents
observabilityRoutes.post('/rag/knowledge-bases/:id/documents', async (c) => {
  const kbId = c.req.param('id');
  const kb = await queryOne<RagKnowledgeBase>(
    'SELECT * FROM rag_knowledge_bases WHERE id = $1',
    [kbId],
  );
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  const body = await c.req.json() as {
    name: string;
    source?: string;
    content?: string;
    chunk_count?: number;
    size_bytes?: number;
    metadata?: Record<string, unknown>;
  };

  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const contentPreview = body.content ? body.content.slice(0, 500) : '';
  const chunkCount = body.chunk_count ?? 0;
  const sizeBytes = body.size_bytes ?? (body.content ? new TextEncoder().encode(body.content).length : 0);

  await execute(
    `INSERT INTO rag_documents (id, kb_id, name, source, content_preview, chunk_count, size_bytes, status, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'indexed', $8, $9)`,
    [
      id,
      kbId,
      body.name,
      body.source ?? '',
      contentPreview,
      chunkCount,
      sizeBytes,
      JSON.stringify(body.metadata ?? {}),
      now,
    ],
  );

  await execute(
    `UPDATE rag_knowledge_bases SET
      document_count = document_count + 1,
      total_chunks = total_chunks + $1,
      last_indexed_at = $2,
      updated_at = $3
    WHERE id = $4`,
    [chunkCount, now, now, kbId],
  );

  const doc = await queryOne<RagDocument>(
    'SELECT * FROM rag_documents WHERE id = $1',
    [id],
  );
  return c.json(doc!, 201);
});

// DELETE /api/observability/rag/knowledge-bases/:id/documents/:docId
observabilityRoutes.delete('/rag/knowledge-bases/:id/documents/:docId', async (c) => {
  const kbId = c.req.param('id');
  const docId = c.req.param('docId');

  const doc = await queryOne<RagDocument>(
    'SELECT * FROM rag_documents WHERE id = $1 AND kb_id = $2',
    [docId, kbId],
  );
  if (!doc) return c.json({ error: 'Not found' }, 404);

  await execute('DELETE FROM rag_documents WHERE id = $1', [docId]);
  await execute(
    `UPDATE rag_knowledge_bases SET
      document_count = GREATEST(0, document_count - 1),
      total_chunks = GREATEST(0, total_chunks - $1),
      updated_at = $2
    WHERE id = $3`,
    [doc.chunk_count, new Date().toISOString(), kbId],
  );

  return c.json({ success: true });
});

// GET /api/observability/rag/queries
observabilityRoutes.get('/rag/queries', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const kbId = c.req.query('kb_id');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (kbId) {
    conditions.push(`q.kb_id = $${params.length + 1}`);
    params.push(kbId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow] = await query<{ n: string }>(
    `SELECT COUNT(*) as n FROM rag_queries q ${where}`,
    params,
  );
  const total = Number(countRow?.n ?? 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<RagQuery & { kb_name: string | null }>(
    `SELECT q.*, kb.name as kb_name
     FROM rag_queries q
     LEFT JOIN rag_knowledge_bases kb ON kb.id = q.kb_id
     ${where}
     ORDER BY q.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  return c.json({ queries: rows, total, limit, offset });
});

// POST /api/observability/rag/queries
observabilityRoutes.post('/rag/queries', async (c) => {
  const body = await c.req.json() as {
    kb_id?: string;
    query: string;
    results_count?: number;
    latency_ms?: number;
    agent_id?: string;
  };

  if (!body.query) return c.json({ error: 'query is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO rag_queries (id, kb_id, query, results_count, latency_ms, agent_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      body.kb_id ?? null,
      body.query,
      body.results_count ?? 0,
      body.latency_ms ?? null,
      body.agent_id ?? null,
      now,
    ],
  );

  const q = await queryOne<RagQuery>('SELECT * FROM rag_queries WHERE id = $1', [id]);
  return c.json(q!, 201);
});

// ---------------------------------------------------------------------------
// RAG — Codebase indexing & search routes
// ---------------------------------------------------------------------------

// POST /api/observability/rag/knowledge-bases/:id/index-codebase
observabilityRoutes.post('/rag/knowledge-bases/:id/index-codebase', async (c) => {
  const kbId = c.req.param('id');

  const kb = await queryOne<{ id: string }>(
    'SELECT id FROM rag_knowledge_bases WHERE id = $1',
    [kbId],
  );
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  const body = await c.req.json() as {
    projectPath: string;
    extensions?: string[];
    excludeDirs?: string[];
    maxFileSize?: number;
    chunkSize?: number;
    chunkOverlap?: number;
  };

  if (!body.projectPath) return c.json({ error: 'projectPath is required' }, 400);

  const { documentIndexer } = await import('./studio/document-indexer.js');

  try {
    const result = await documentIndexer.indexCodebase({
      projectPath: body.projectPath,
      kbId,
      extensions: body.extensions,
      excludeDirs: body.excludeDirs,
      maxFileSize: body.maxFileSize,
      chunkSize: body.chunkSize,
      chunkOverlap: body.chunkOverlap,
    });

    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Indexing failed' }, 500);
  }
});

// POST /api/observability/rag/knowledge-bases/:id/reindex
observabilityRoutes.post('/rag/knowledge-bases/:id/reindex', async (c) => {
  const kbId = c.req.param('id');

  const kb = await queryOne<{ id: string }>(
    'SELECT id FROM rag_knowledge_bases WHERE id = $1',
    [kbId],
  );
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  const body = await c.req.json() as {
    projectPath: string;
    sinceCommit?: string;
  };

  if (!body.projectPath) return c.json({ error: 'projectPath is required' }, 400);

  const { documentIndexer } = await import('./studio/document-indexer.js');

  try {
    const result = await documentIndexer.reindexChanged(
      body.projectPath,
      kbId,
      body.sinceCommit,
    );

    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Re-index failed' }, 500);
  }
});

// POST /api/observability/rag/search
observabilityRoutes.post('/rag/search', async (c) => {
  const body = await c.req.json() as {
    kbId: string;
    query: string;
    topK?: number;
    model?: string;
  };

  if (!body.kbId) return c.json({ error: 'kbId is required' }, 400);
  if (!body.query) return c.json({ error: 'query is required' }, 400);

  const kb = await queryOne<{ id: string }>(
    'SELECT id FROM rag_knowledge_bases WHERE id = $1',
    [body.kbId],
  );
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  const { vectorStore } = await import('./studio/vector-store.js');

  const startMs = Date.now();
  let results: unknown[] = [];

  try {
    results = await vectorStore.searchSimilar(body.kbId, body.query, body.topK, body.model);
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Search failed' }, 500);
  }

  const latencyMs = Date.now() - startMs;

  // Log query to rag_queries table (best-effort — do not fail the response)
  try {
    const queryId = crypto.randomUUID();
    const now = new Date().toISOString();
    await execute(
      `INSERT INTO rag_queries (id, kb_id, query, results_count, latency_ms, agent_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
      [queryId, body.kbId, body.query, results.length, latencyMs, now],
    );
  } catch {
    // best-effort logging
  }

  return c.json({ results, latencyMs });
});
