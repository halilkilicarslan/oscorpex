-- ---------------------------------------------------------------------------
-- Oscorpex — PostgreSQL Init Script
-- Schema for studio tables and observability tables
-- ---------------------------------------------------------------------------

-- pgvector extension (pre-installed in pgvector/pgvector:pg16 image)
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Studio Tables (from src/studio/db.ts)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'planning',
  tech_stack    TEXT NOT NULL DEFAULT '[]',
  repo_path     TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS project_plans (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL
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
  id                        TEXT PRIMARY KEY,
  phase_id                  TEXT NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  title                     TEXT NOT NULL,
  description               TEXT NOT NULL DEFAULT '',
  assigned_agent            TEXT NOT NULL DEFAULT '',
  status                    TEXT NOT NULL DEFAULT 'queued',
  complexity                TEXT NOT NULL DEFAULT 'M',
  depends_on                TEXT NOT NULL DEFAULT '[]',
  branch                    TEXT NOT NULL DEFAULT '',
  output                    TEXT,
  retry_count               INTEGER NOT NULL DEFAULT 0,
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  requires_approval         INTEGER NOT NULL DEFAULT 0,
  approval_status           TEXT,
  approval_rejection_reason TEXT,
  error                     TEXT,
  task_type                 TEXT NOT NULL DEFAULT 'ai',
  test_expectation          TEXT,
  review_status             TEXT,
  reviewer_agent_id         TEXT,
  review_task_id            TEXT,
  revision_count            INTEGER NOT NULL DEFAULT 0,
  assigned_agent_id         TEXT,
  policy_snapshot           TEXT NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration: created_at for task tracking
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Migration: policy_snapshot for persisted policy truth
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS policy_snapshot TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS test_expectation TEXT;

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
  is_preset     INTEGER NOT NULL DEFAULT 0,
  gender        TEXT NOT NULL DEFAULT 'male'
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  agent_id    TEXT,
  task_id     TEXT,
  payload     TEXT NOT NULL DEFAULT '{}',
  timestamp   TIMESTAMPTZ NOT NULL
);

-- v12.0 Migration: correlation/causation tracking for event sourcing
ALTER TABLE events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS causation_id TEXT;

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'openai',
  api_key        TEXT NOT NULL DEFAULT '',
  base_url       TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  is_default     INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  fallback_order INTEGER NOT NULL DEFAULT 0,
  cli_tool       TEXT
);

-- Idempotent migration for existing DBs
ALTER TABLE ai_providers ADD COLUMN IF NOT EXISTS cli_tool TEXT;

CREATE TABLE IF NOT EXISTS team_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  agent_ids      TEXT NOT NULL DEFAULT '[]',
  dependencies   TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_team_templates (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  roles         TEXT NOT NULL DEFAULT '[]',
  dependencies  TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);

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
  created_at      TIMESTAMPTZ NOT NULL,
  reports_to      TEXT,
  color           TEXT NOT NULL DEFAULT '#22c55e',
  pipeline_order  INTEGER NOT NULL DEFAULT 0,
  gender          TEXT NOT NULL DEFAULT 'male'
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id),
  from_agent_id     TEXT NOT NULL,
  to_agent_id       TEXT NOT NULL,
  type              TEXT NOT NULL,
  subject           TEXT NOT NULL,
  content           TEXT NOT NULL,
  metadata          TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'unread',
  parent_message_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL,
  read_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  current_stage INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'idle',
  stages_json   TEXT NOT NULL DEFAULT '[]',
  started_at    TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_dependencies (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_agent_id   TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  to_agent_id     TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'workflow',
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_type  TEXT NOT NULL DEFAULT 'path',
  pattern     TEXT NOT NULL,
  permission  TEXT NOT NULL DEFAULT 'readwrite'
);

CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'generic',
  events     TEXT NOT NULL DEFAULT '[]',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  secret     TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  agent_id        TEXT NOT NULL REFERENCES project_agents(id),
  cli_tool        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'idle',
  task_prompt     TEXT,
  output_summary  TEXT,
  pid             INTEGER,
  exit_code       INTEGER,
  started_at      TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS token_usage (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id                TEXT NOT NULL,
  agent_id               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  provider               TEXT NOT NULL DEFAULT '',
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  total_tokens           INTEGER NOT NULL DEFAULT 0,
  cost_usd               REAL NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL
);

-- Migration: add cache token columns to existing token_usage tables
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER DEFAULT 0;
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER DEFAULT 0;

-- Migration: M4 — add provider column to token_usage
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS provider TEXT;

CREATE TABLE IF NOT EXISTS cli_probe_settings (
  provider_id              TEXT PRIMARY KEY,
  enabled                  INTEGER NOT NULL DEFAULT 0,
  allow_auth_file_read     INTEGER NOT NULL DEFAULT 0,
  allow_network_probe      INTEGER NOT NULL DEFAULT 0,
  refresh_interval_sec     INTEGER NOT NULL DEFAULT 300,
  updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cli_usage_snapshots (
  id            TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'unavailable',
  confidence    TEXT NOT NULL DEFAULT 'low'
);

CREATE TABLE IF NOT EXISTS cli_probe_events (
  id          TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  status      TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

-- Migration: add dependencies column to existing team_templates tables
ALTER TABLE team_templates ADD COLUMN IF NOT EXISTS dependencies TEXT NOT NULL DEFAULT '[]';

-- ---------------------------------------------------------------------------
-- v3.0 Migration: Micro-task decomposition fields on tasks
-- ---------------------------------------------------------------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_files TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_lines INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_task_id TEXT;

-- ---------------------------------------------------------------------------
-- v3.1 Migration: Edge type metadata on agent_dependencies
-- ---------------------------------------------------------------------------
ALTER TABLE agent_dependencies ADD COLUMN IF NOT EXISTS metadata TEXT NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- v3.2: Work Items (Backlog)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_items (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type              TEXT NOT NULL DEFAULT 'feature',
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  priority          TEXT NOT NULL DEFAULT 'medium',
  severity          TEXT,
  labels            TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'open',
  source            TEXT NOT NULL DEFAULT 'user',
  source_agent_id   TEXT,
  source_task_id    TEXT,
  planned_task_id   TEXT,
  sprint_id         TEXT,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- v3.4: Memory Architecture tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_context_snapshots (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  summary_json    TEXT NOT NULL DEFAULT '{}',
  source_version  INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_compactions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL,
  last_message_id   TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_facts (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope           TEXT NOT NULL DEFAULT 'project',
  key             TEXT NOT NULL,
  value           TEXT NOT NULL DEFAULT '',
  confidence      REAL NOT NULL DEFAULT 1.0,
  source          TEXT NOT NULL DEFAULT 'system',
  updated_at      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- v3.7 Migration: Audit fields on events
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN IF NOT EXISTS actor TEXT DEFAULT 'system';
ALTER TABLE events ADD COLUMN IF NOT EXISTS action_detail TEXT;

-- ---------------------------------------------------------------------------
-- v3.9: Sprints
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sprints (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  goal            TEXT,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'planned',
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sonar_scans (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  quality_gate    TEXT NOT NULL DEFAULT 'NONE',
  conditions      TEXT NOT NULL DEFAULT '[]',
  scan_output     TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_settings (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            TEXT PRIMARY KEY,
  webhook_id    TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'failed',
  status_code   INTEGER,
  response_body TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  attempt       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Observability Tables (from src/observability-routes.ts)
-- These are read from observability.db in SQLite; mirrored here for PG
-- ---------------------------------------------------------------------------

-- observability_traces — populated by @voltagent/core OTEL exporter
CREATE TABLE IF NOT EXISTS observability_traces (
  trace_id      TEXT PRIMARY KEY,
  root_span_id  TEXT,
  entity_id     TEXT,
  entity_type   TEXT,
  start_time    TEXT NOT NULL,
  end_time      TEXT,
  span_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- observability_spans — individual spans within a trace
CREATE TABLE IF NOT EXISTS observability_spans (
  span_id        TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL REFERENCES observability_traces(trace_id) ON DELETE CASCADE,
  parent_span_id TEXT,
  entity_id      TEXT,
  entity_type    TEXT,
  name           TEXT NOT NULL,
  kind           INTEGER NOT NULL DEFAULT 0,
  start_time     TEXT NOT NULL,
  end_time       TEXT,
  duration       INTEGER,
  status_code    INTEGER NOT NULL DEFAULT 0,
  status_message TEXT,
  attributes     TEXT,
  events         TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- observability_logs — OpenTelemetry log records
CREATE TABLE IF NOT EXISTS observability_logs (
  id                     SERIAL PRIMARY KEY,
  timestamp              TEXT NOT NULL,
  trace_id               TEXT,
  span_id                TEXT,
  trace_flags            INTEGER,
  severity_number        INTEGER,
  severity_text          TEXT,
  body                   TEXT NOT NULL,
  attributes             TEXT,
  resource               TEXT,
  instrumentation_scope  TEXT,
  created_at             TEXT
);

-- ---------------------------------------------------------------------------
-- Prompt Templates (from src/observability-routes.ts — studio.db)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prompt_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'general',
  content     TEXT NOT NULL,
  variables   TEXT NOT NULL DEFAULT '[]',
  tags        TEXT NOT NULL DEFAULT '[]',
  version     INTEGER NOT NULL DEFAULT 1,
  parent_id   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Alert Rules & History (from src/observability-routes.ts — studio.db)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alert_rules (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT DEFAULT '',
  type               TEXT NOT NULL,
  condition          TEXT NOT NULL,
  channels           TEXT NOT NULL DEFAULT '[]',
  enabled            INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes   INTEGER NOT NULL DEFAULT 15,
  last_triggered_at  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_history (
  id                TEXT PRIMARY KEY,
  rule_id           TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  status            TEXT NOT NULL,
  message           TEXT NOT NULL,
  context           TEXT,
  triggered_at      TEXT NOT NULL,
  resolved_at       TEXT,
  acknowledged_at   TEXT,
  acknowledged_by   TEXT
);

-- ---------------------------------------------------------------------------
-- Feedbacks (from src/observability-routes.ts — studio.db)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feedbacks (
  id          TEXT PRIMARY KEY,
  trace_id    TEXT,
  span_id     TEXT,
  agent_id    TEXT,
  rating      INTEGER NOT NULL,
  rating_type TEXT NOT NULL DEFAULT 'stars',
  comment     TEXT DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  user_id     TEXT DEFAULT 'anonymous',
  created_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Triggers & Trigger Logs (from src/observability-routes.ts — studio.db)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS triggers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  type         TEXT NOT NULL,
  config       TEXT NOT NULL,
  action       TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_fired_at TEXT,
  fire_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trigger_logs (
  id          TEXT PRIMARY KEY,
  trigger_id  TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  input       TEXT,
  output      TEXT,
  duration_ms INTEGER,
  fired_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- RAG Tables (from src/observability-routes.ts — studio.db)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rag_knowledge_bases (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT DEFAULT '',
  type             TEXT NOT NULL DEFAULT 'text',
  embedding_model  TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  chunk_size       INTEGER NOT NULL DEFAULT 512,
  chunk_overlap    INTEGER NOT NULL DEFAULT 50,
  status           TEXT NOT NULL DEFAULT 'active',
  document_count   INTEGER NOT NULL DEFAULT 0,
  total_chunks     INTEGER NOT NULL DEFAULT 0,
  last_indexed_at  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_documents (
  id               TEXT PRIMARY KEY,
  kb_id            TEXT NOT NULL REFERENCES rag_knowledge_bases(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  source           TEXT DEFAULT '',
  content_preview  TEXT DEFAULT '',
  chunk_count      INTEGER NOT NULL DEFAULT 0,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_queries (
  id             TEXT PRIMARY KEY,
  kb_id          TEXT,
  query          TEXT NOT NULL,
  results_count  INTEGER NOT NULL DEFAULT 0,
  latency_ms     INTEGER,
  agent_id       TEXT,
  created_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- RAG Embeddings — pgvector (from src/studio/vector-store.ts)
-- SQLite used BLOB; PostgreSQL uses native vector(1536) type
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rag_embeddings (
  id           TEXT PRIMARY KEY,
  kb_id        TEXT NOT NULL,
  doc_id       TEXT NOT NULL,
  chunk_index  INTEGER NOT NULL,
  content      TEXT NOT NULL,
  metadata     JSONB,
  vector       vector(1536),
  created_at   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- VoltAgent Memory Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS voltagent_memory_conversations (
  id          TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL DEFAULT '',
  user_id     TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voltagent_memory_messages (
  conversation_id TEXT NOT NULL REFERENCES voltagent_memory_conversations(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,
  user_id         TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL DEFAULT '',
  parts           TEXT NOT NULL DEFAULT '[]',
  metadata        TEXT,
  format_version  INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (conversation_id, message_id)
);

CREATE TABLE IF NOT EXISTS voltagent_memory_steps (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES voltagent_memory_conversations(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL DEFAULT '',
  agent_id         TEXT NOT NULL DEFAULT '',
  agent_name       TEXT,
  operation_id     TEXT,
  step_index       INTEGER NOT NULL DEFAULT 0,
  type             TEXT NOT NULL DEFAULT '',
  role             TEXT NOT NULL DEFAULT '',
  content          TEXT,
  arguments        TEXT,
  result           TEXT,
  usage            TEXT,
  sub_agent_id     TEXT,
  sub_agent_name   TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voltagent_memory_workflow_states (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL DEFAULT '',
  workflow_name    TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT '',
  input            TEXT,
  context          TEXT,
  workflow_state   TEXT,
  suspension       TEXT,
  events           TEXT,
  output           TEXT,
  cancellation     TEXT,
  user_id          TEXT,
  conversation_id  TEXT,
  metadata         TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Indexes — Studio Tables
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_plans_project          ON project_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_phases_plan            ON phases(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_phase            ON tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_events_project         ON events(project_id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_project           ON chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_agent             ON chat_messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_project_agents_project ON project_agents(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_project   ON agent_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_to_agent  ON agent_messages(to_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from_agent ON agent_messages(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_parent    ON agent_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project  ON pipeline_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_deps_project     ON agent_dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_deps_from        ON agent_dependencies(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_deps_to          ON agent_dependencies(to_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_caps_agent       ON agent_capabilities(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_caps_project     ON agent_capabilities(project_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_project       ON webhooks(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project     ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent       ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_project    ON token_usage(project_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_task       ON token_usage(task_id);
CREATE INDEX IF NOT EXISTS idx_cli_usage_snapshots_provider ON cli_usage_snapshots(provider_id);
CREATE INDEX IF NOT EXISTS idx_cli_usage_snapshots_captured ON cli_usage_snapshots(captured_at);
CREATE INDEX IF NOT EXISTS idx_cli_probe_events_provider    ON cli_probe_events(provider_id);
CREATE INDEX IF NOT EXISTS idx_sonar_scans_project    ON sonar_scans(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_settings_unique ON project_settings(project_id, category, key);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at);

-- v3.0: Sub-task parent index
CREATE INDEX IF NOT EXISTS idx_tasks_parent             ON tasks(parent_task_id);

-- v4.2: Performance indexes — high-frequency query columns
CREATE INDEX IF NOT EXISTS idx_tasks_status             ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent     ON tasks(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_events_type              ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_project_type      ON events(project_id, type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp         ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_token_usage_agent        ON token_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status        ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_ctx_events_project_task  ON context_events(project_id, task_id);

-- v3.2: Work items indexes
CREATE INDEX IF NOT EXISTS idx_work_items_project       ON work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status        ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_sprint        ON work_items(sprint_id);

-- v3.4: Memory indexes
CREATE INDEX IF NOT EXISTS idx_ctx_snapshots_project    ON project_context_snapshots(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_snapshots_kind ON project_context_snapshots(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_conv_compactions_project ON conversation_compactions(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_compactions_channel ON conversation_compactions(project_id, channel);
CREATE INDEX IF NOT EXISTS idx_memory_facts_project     ON memory_facts(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_key  ON memory_facts(project_id, scope, key);
-- v3.9: Sprint indexes
CREATE INDEX IF NOT EXISTS idx_sprints_project          ON sprints(project_id);

-- ---------------------------------------------------------------------------
-- Indexes — Observability Tables
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_obs_spans_trace        ON observability_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_obs_logs_trace         ON observability_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_obs_logs_timestamp     ON observability_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(category);
CREATE INDEX IF NOT EXISTS idx_feedbacks_trace        ON feedbacks(trace_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_agent        ON feedbacks(agent_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_trigger   ON trigger_logs(trigger_id);
CREATE INDEX IF NOT EXISTS idx_rag_docs_kb            ON rag_documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_rag_queries_kb         ON rag_queries(kb_id);

-- ---------------------------------------------------------------------------
-- Indexes — Memory Tables
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_mem_msg_conv    ON voltagent_memory_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_mem_steps_conv  ON voltagent_memory_steps(conversation_id);
CREATE INDEX IF NOT EXISTS idx_mem_wf_status   ON voltagent_memory_workflow_states(status);

-- ---------------------------------------------------------------------------
-- M5: Plugin SDK Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS registered_plugins (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT UNIQUE NOT NULL,
  version       TEXT NOT NULL DEFAULT '0.0.1',
  description   TEXT DEFAULT '',
  author        TEXT DEFAULT '',
  enabled       BOOLEAN DEFAULT true,
  hooks         TEXT[] DEFAULT '{}',
  permissions   TEXT[] DEFAULT '{}',
  config_json   JSONB DEFAULT '{}',
  manifest_json JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_executions (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plugin_name TEXT NOT NULL,
  hook        TEXT NOT NULL,
  project_id  TEXT,
  duration_ms INTEGER DEFAULT 0,
  success     BOOLEAN DEFAULT true,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plugin_executions_plugin  ON plugin_executions(plugin_name);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_created ON plugin_executions(created_at);

-- ---------------------------------------------------------------------------
-- Indexes — RAG Embeddings (pgvector)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_rag_emb_kb     ON rag_embeddings(kb_id);
CREATE INDEX IF NOT EXISTS idx_rag_emb_doc    ON rag_embeddings(doc_id);
CREATE INDEX IF NOT EXISTS idx_rag_emb_vector ON rag_embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);

-- ---------------------------------------------------------------------------
-- v3.0 B1 — Interactive Planner: intake questions
-- ---------------------------------------------------------------------------
-- Planner asks clarifying questions before producing a plan. Questions are
-- persisted here; user answers via REST API. Planner reads answered questions
-- back from this table as context on the next turn.

CREATE TABLE IF NOT EXISTS intake_questions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  options       TEXT NOT NULL DEFAULT '[]',        -- JSON array of suggested answers
  category      TEXT NOT NULL DEFAULT 'general',   -- scope|functional|nonfunctional|priority|technical|general
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending|answered|skipped
  answer        TEXT,
  plan_version  INTEGER,                            -- which plan iteration asked it
  created_at    TIMESTAMPTZ NOT NULL,
  answered_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_intake_project ON intake_questions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_intake_created ON intake_questions(project_id, created_at);

-- ---------------------------------------------------------------------------
-- v4.0: Context Store — FTS engine (tsvector + optional pg_trgm)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS context_sources (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  code_chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at      TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_sources_project_label ON context_sources(project_id, label);
CREATE INDEX IF NOT EXISTS idx_ctx_sources_project ON context_sources(project_id);

CREATE TABLE IF NOT EXISTS context_chunks (
  id              SERIAL PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  content_type    TEXT NOT NULL DEFAULT 'prose',
  tsv             tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_ctx_chunks_fts ON context_chunks USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_ctx_chunks_source ON context_chunks(source_id);

-- pg_trgm trigram index (optional — graceful fallback if extension unavailable)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_ctx_chunks_trgm ON context_chunks USING GIN(content gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm not available — trigram search disabled, tsvector-only mode';
END $$;

-- ---------------------------------------------------------------------------
-- v4.0: Context Session Events — crash recovery + session tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS context_events (
  id              SERIAL PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id         TEXT,
  agent_id        TEXT,
  session_key     TEXT NOT NULL,
  type            TEXT NOT NULL,
  category        TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 2,
  data            TEXT NOT NULL,
  data_hash       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ctx_events_session ON context_events(session_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctx_events_dedup ON context_events(session_key, type, data_hash);

-- v4.0: Context search tracking
CREATE TABLE IF NOT EXISTS context_search_stats (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id),
  search_calls    INTEGER NOT NULL DEFAULT 0,
  search_hits     INTEGER NOT NULL DEFAULT 0
);

-- v4.1: Task file diffs (DiffViewer)
CREATE TABLE IF NOT EXISTS task_diffs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  diff_content    TEXT NOT NULL,
  diff_type       TEXT NOT NULL CHECK (diff_type IN ('created', 'modified', 'deleted')),
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_diffs_task ON task_diffs(task_id);

-- v4.1: Context search log (RAG Observability)
CREATE TABLE IF NOT EXISTS context_search_log (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query_text      TEXT NOT NULL,
  result_count    INTEGER NOT NULL DEFAULT 0,
  top_rank        REAL,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  source_filter   TEXT,
  content_type    TEXT,
  created_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ctx_search_log_project ON context_search_log(project_id, created_at DESC);

-- v4.1: Agent daily stats (Agent Dashboard v2 heat map)
CREATE TABLE IF NOT EXISTS agent_daily_stats (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  stat_date       TEXT NOT NULL,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed    INTEGER NOT NULL DEFAULT 0,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  avg_task_time_ms INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL,
  UNIQUE(project_id, agent_id, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_agent_daily_stats_lookup ON agent_daily_stats(project_id, stat_date);

-- v4.2: Add project_id to tasks for direct lookup (eliminates JOIN chain)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT NULL;

-- Backfill existing tasks that don't yet have project_id set
UPDATE tasks SET project_id = pp.project_id
FROM phases p JOIN project_plans pp ON p.plan_id = pp.id
WHERE tasks.phase_id = p.id AND tasks.project_id IS NULL;

-- v4.1: Fix FK constraints to CASCADE (idempotent migration)
DO $$
BEGIN
  -- task_diffs: ensure ON DELETE CASCADE
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_diffs_task_id_fkey' AND confdeltype != 'c'
  ) THEN
    ALTER TABLE task_diffs DROP CONSTRAINT task_diffs_task_id_fkey;
    ALTER TABLE task_diffs ADD CONSTRAINT task_diffs_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
  END IF;
  -- context_search_log: ensure ON DELETE CASCADE
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'context_search_log_project_id_fkey' AND confdeltype != 'c'
  ) THEN
    ALTER TABLE context_search_log DROP CONSTRAINT context_search_log_project_id_fkey;
    ALTER TABLE context_search_log ADD CONSTRAINT context_search_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  -- agent_daily_stats: ensure ON DELETE CASCADE
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_daily_stats_project_id_fkey' AND confdeltype != 'c'
  ) THEN
    ALTER TABLE agent_daily_stats DROP CONSTRAINT agent_daily_stats_project_id_fkey;
    ALTER TABLE agent_daily_stats ADD CONSTRAINT agent_daily_stats_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  -- agent_messages: ensure ON DELETE CASCADE
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_messages_project_id_fkey' AND confdeltype != 'c'
  ) THEN
    ALTER TABLE agent_messages DROP CONSTRAINT agent_messages_project_id_fkey;
    ALTER TABLE agent_messages ADD CONSTRAINT agent_messages_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  -- agent_runs: ensure ON DELETE CASCADE
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_project_id_fkey' AND confdeltype != 'c'
  ) THEN
    ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_project_id_fkey;
    ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  -- context_search_stats: ensure ON DELETE CASCADE
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'context_search_stats_project_id_fkey' AND confdeltype != 'c'
  ) THEN
    ALTER TABLE context_search_stats DROP CONSTRAINT context_search_stats_project_id_fkey;
    ALTER TABLE context_search_stats ADD CONSTRAINT context_search_stats_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Migration: TEXT -> TIMESTAMPTZ for date columns
-- Converts all existing TEXT date columns to TIMESTAMPTZ on existing databases.
-- New installations get correct types from CREATE TABLE definitions above.
-- Safe to run multiple times: checks data_type = 'text' before altering.
-- ISO 8601 strings (new Date().toISOString()) cast cleanly to TIMESTAMPTZ.
-- ---------------------------------------------------------------------------
DO $$ BEGIN

  -- projects
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE projects ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'updated_at' AND data_type = 'text') THEN
    ALTER TABLE projects ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
  END IF;

  -- project_plans
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_plans' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE project_plans ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- tasks (nullable: NULLIF guards against empty strings)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'started_at' AND data_type = 'text') THEN
    ALTER TABLE tasks ALTER COLUMN started_at TYPE TIMESTAMPTZ USING NULLIF(started_at, '')::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'completed_at' AND data_type = 'text') THEN
    ALTER TABLE tasks ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING NULLIF(completed_at, '')::timestamptz;
  END IF;

  -- events
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'timestamp' AND data_type = 'text') THEN
    ALTER TABLE events ALTER COLUMN timestamp TYPE TIMESTAMPTZ USING timestamp::timestamptz;
  END IF;

  -- project_agents
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_agents' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE project_agents ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- agent_messages
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_messages' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE agent_messages ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_messages' AND column_name = 'read_at' AND data_type = 'text') THEN
    ALTER TABLE agent_messages ALTER COLUMN read_at TYPE TIMESTAMPTZ USING NULLIF(read_at, '')::timestamptz;
  END IF;

  -- agent_dependencies
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_dependencies' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE agent_dependencies ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- intake_questions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_questions' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE intake_questions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_questions' AND column_name = 'answered_at' AND data_type = 'text') THEN
    ALTER TABLE intake_questions ALTER COLUMN answered_at TYPE TIMESTAMPTZ USING NULLIF(answered_at, '')::timestamptz;
  END IF;

  -- project_settings
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_settings' AND column_name = 'updated_at' AND data_type = 'text') THEN
    ALTER TABLE project_settings ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
  END IF;

  -- work_items
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_items' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE work_items ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_items' AND column_name = 'updated_at' AND data_type = 'text') THEN
    ALTER TABLE work_items ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
  END IF;

  -- sprints
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sprints' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE sprints ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- token_usage
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'token_usage' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE token_usage ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- agent_runs (nullable started_at / stopped_at)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_runs' AND column_name = 'started_at' AND data_type = 'text') THEN
    ALTER TABLE agent_runs ALTER COLUMN started_at TYPE TIMESTAMPTZ USING NULLIF(started_at, '')::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_runs' AND column_name = 'stopped_at' AND data_type = 'text') THEN
    ALTER TABLE agent_runs ALTER COLUMN stopped_at TYPE TIMESTAMPTZ USING NULLIF(stopped_at, '')::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_runs' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE agent_runs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- context_sources
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'context_sources' AND column_name = 'indexed_at' AND data_type = 'text') THEN
    ALTER TABLE context_sources ALTER COLUMN indexed_at TYPE TIMESTAMPTZ USING indexed_at::timestamptz;
  END IF;

  -- context_events
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'context_events' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE context_events ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- task_diffs
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'task_diffs' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE task_diffs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- agent_daily_stats
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_daily_stats' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE agent_daily_stats ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

  -- context_search_log
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'context_search_log' AND column_name = 'created_at' AND data_type = 'text') THEN
    ALTER TABLE context_search_log ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
  END IF;

END $$;

-- ---------------------------------------------------------------------------
-- M6: Multi-Tenant Identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  plan       TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT DEFAULT '',
  tenant_id     TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner','admin','developer','viewer','billing')),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id    TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL,
  name         TEXT NOT NULL,
  scopes       TEXT[] DEFAULT '{}',
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

-- projects tablosuna tenant_id ve owner_id ekle (nullable, backward compat)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id  TEXT REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- M6.2: Tenant Scoping — indexes for row-level filtering
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_tenant   ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner    ON projects(owner_id);

-- ---------------------------------------------------------------------------
-- M6.4: Row Level Security Policies (policy tanımları — şimdilik ENABLE EDİLMEDİ)
-- NOT: ALTER TABLE ... ENABLE ROW LEVEL SECURITY komutları kasıtlı olarak
-- dahil edilmedi. Testler app.current_tenant_id set etmediğinden RLS etkinleştirilmesi
-- mevcut test suite'ini bozar. Bu policy'ler gelecekte ayrı bir migration'da
-- etkinleştirilecek.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_policies
		WHERE policyname = 'projects_tenant_isolation' AND tablename = 'projects'
	) THEN
		CREATE POLICY projects_tenant_isolation ON projects
			USING (
				tenant_id IS NULL
				OR tenant_id = current_setting('app.current_tenant_id', true)
			);
	END IF;
END $$;

-- ---------------------------------------------------------------------------
-- V6 M1: In-App Notification System
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id  TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT DEFAULT '',
  read       BOOLEAN DEFAULT false,
  data       JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_project ON notifications(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- ---------------------------------------------------------------------------
-- V6 M2: Automated Test Results
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS test_results (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  framework   TEXT NOT NULL DEFAULT 'unknown',
  passed      INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  coverage    REAL,
  duration_ms INTEGER,
  raw_output  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_results_project ON test_results(project_id);
CREATE INDEX IF NOT EXISTS idx_test_results_task    ON test_results(task_id);

-- ---------------------------------------------------------------------------
-- V6 M3: Project Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'fullstack',
  tech_stack   JSONB DEFAULT '[]',
  agent_config JSONB DEFAULT '{}',
  phases       JSONB DEFAULT '[]',
  is_public    BOOLEAN DEFAULT true,
  author_id    TEXT,
  usage_count  INTEGER DEFAULT 0,
  rating       REAL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_templates_category ON project_templates(category);
CREATE INDEX IF NOT EXISTS idx_project_templates_usage    ON project_templates(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_project_templates_public   ON project_templates(is_public);

-- ---------------------------------------------------------------------------
-- V6 M3: CI Tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ci_trackings (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'github',
  pr_id        TEXT NOT NULL,
  pr_url       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  details      JSONB DEFAULT '{}',
  pipeline_url TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ci_trackings_project ON ci_trackings(project_id);

-- ---------------------------------------------------------------------------
-- V6 M4: Durable Job Queue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  queue       TEXT NOT NULL DEFAULT 'task-execution',
  data        JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'created',
  output      JSONB,
  error       TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status       ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created      ON jobs(created_at);

-- ---------------------------------------------------------------------------
-- V6 M6 F6: Agent Marketplace
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_items (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL DEFAULT 'agent',
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  author       TEXT DEFAULT 'Anonymous',
  author_id    TEXT,
  category     TEXT DEFAULT 'general',
  tags         JSONB DEFAULT '[]',
  config       JSONB NOT NULL DEFAULT '{}',
  downloads    INTEGER DEFAULT 0,
  rating       REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  is_verified  BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_type      ON marketplace_items(type);
CREATE INDEX IF NOT EXISTS idx_marketplace_category  ON marketplace_items(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_downloads ON marketplace_items(downloads DESC);

-- ---------------------------------------------------------------------------
-- v7.0 Phase 1: Stabilization & Production Hardening
-- ---------------------------------------------------------------------------

-- 1.1 Pipeline state consistency — version column for optimistic locking
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- 1.2 Distributed task dispatch — claim fields
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dispatch_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks(status, claimed_by) WHERE status = 'queued';

-- 1.3 Output verification results
CREATE TABLE IF NOT EXISTS verification_results (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  verification_type TEXT NOT NULL,
  status            TEXT NOT NULL,
  details           JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_task ON verification_results(task_id);

-- 1.5 Cost circuit breaker — project-level budget settings (uses existing project_settings)
-- No new table needed; budget_max_usd stored in project_settings category='budget'

-- 1.6 RLS enablement for tenant-scoped tables
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id TEXT;

-- Enable RLS on core tenant-scoped tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies: allow access when tenant matches OR when no tenant context set (backward compat)
DO $$ BEGIN
  -- projects
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_projects') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_projects ON projects
      USING (tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true))';
  END IF;
  -- project_plans (via project join)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_project_plans') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_project_plans ON project_plans
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- tasks (via phase → plan → project)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_tasks') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_tasks ON tasks
      USING (project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- phases
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_phases') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_phases ON phases
      USING (plan_id IN (SELECT id FROM project_plans WHERE project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true))))';
  END IF;
  -- events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_events') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_events ON events
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- project_agents
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_project_agents') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_project_agents ON project_agents
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- agent_dependencies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_agent_deps') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_agent_deps ON agent_dependencies
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- pipeline_runs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_pipeline_runs') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_pipeline_runs ON pipeline_runs
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- token_usage
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_token_usage') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_token_usage ON token_usage
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- work_items
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_work_items') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_work_items ON work_items
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- sprints
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_sprints') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_sprints ON sprints
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- notifications
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_notifications') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_notifications ON notifications
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- agent_messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_agent_messages') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_agent_messages ON agent_messages
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
  -- chat_messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_chat_messages') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_chat_messages ON chat_messages
      USING (project_id IN (SELECT id FROM projects WHERE tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)))';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- v8.0: Provider State Persistence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_state (
  adapter               TEXT PRIMARY KEY,
  rate_limited          BOOLEAN NOT NULL DEFAULT false,
  cooldown_until        TIMESTAMPTZ,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_success          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- v7.0 Phase 2: Agentic Core — Agent Runtime Tables
-- ---------------------------------------------------------------------------

-- 2.1 Agent sessions — bounded runtime execution context
CREATE TABLE IF NOT EXISTS agent_sessions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id          TEXT NOT NULL,
  task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  strategy          TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  steps_completed   INTEGER NOT NULL DEFAULT 0,
  max_steps         INTEGER NOT NULL DEFAULT 10,
  observations      JSONB DEFAULT '[]',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);

-- 2.2 Episodic memory — per-agent execution episodes for behavioral learning
CREATE TABLE IF NOT EXISTS agent_episodes (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id          TEXT NOT NULL,
  task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  task_type         TEXT NOT NULL,
  strategy          TEXT NOT NULL,
  action_summary    TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  failure_reason    TEXT,
  quality_score     REAL,
  cost_usd          REAL,
  duration_ms       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_episodes_agent ON agent_episodes(project_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_episodes_type ON agent_episodes(task_type, outcome);

-- 2.3 Strategy patterns — aggregated success rates derived from episodes
CREATE TABLE IF NOT EXISTS agent_strategy_patterns (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_role        TEXT NOT NULL,
  task_type         TEXT NOT NULL,
  strategy          TEXT NOT NULL,
  success_rate      REAL NOT NULL DEFAULT 0,
  avg_cost_usd      REAL,
  avg_quality       REAL,
  sample_count      INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, agent_role, task_type, strategy)
);
CREATE INDEX IF NOT EXISTS idx_strategy_patterns_lookup ON agent_strategy_patterns(project_id, agent_role, task_type);

-- 2.4 Agent strategies catalog — per-role strategy definitions
CREATE TABLE IF NOT EXISTS agent_strategies (
  id                TEXT PRIMARY KEY,
  agent_role        TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  prompt_addendum   TEXT,
  allowed_task_types TEXT[] NOT NULL DEFAULT '{}',
  is_default        BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (agent_role, name)
);

-- 2.5 Task proposals — runtime task injection by agents
CREATE TABLE IF NOT EXISTS task_proposals (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  originating_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  originating_agent_id TEXT NOT NULL,
  proposal_type        TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  severity             TEXT,
  suggested_role       TEXT,
  phase_id             TEXT REFERENCES phases(id) ON DELETE SET NULL,
  complexity           TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  approved_by          TEXT,
  created_task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  rejected_reason      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_proposals_project ON task_proposals(project_id, status);
ALTER TABLE task_proposals ADD COLUMN IF NOT EXISTS phase_id TEXT;
ALTER TABLE task_proposals ADD COLUMN IF NOT EXISTS complexity TEXT;
ALTER TABLE task_proposals ADD COLUMN IF NOT EXISTS created_task_id TEXT;

-- 2.6 Structured inter-agent protocol messages
CREATE TABLE IF NOT EXISTS agent_protocol_messages (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_agent_id     TEXT NOT NULL,
  to_agent_id       TEXT,
  related_task_id   TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  message_type      TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'unread',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_protocol_messages_project ON agent_protocol_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_protocol_messages_to ON agent_protocol_messages(to_agent_id, status);

-- 2.7 Approval matrix — risk-based governance rules
CREATE TABLE IF NOT EXISTS approval_rules (
  id                TEXT PRIMARY KEY,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  action_type       TEXT NOT NULL,
  risk_level        TEXT NOT NULL DEFAULT 'low',
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  auto_approve      BOOLEAN NOT NULL DEFAULT false,
  max_per_run       INTEGER,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, action_type, risk_level)
);

-- =========================================================================
-- Phase 3: Dynamic Agentic Platform
-- =========================================================================

-- 3.1 Graph mutations — auditable runtime DAG changes
CREATE TABLE IF NOT EXISTS graph_mutations (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_run_id   TEXT NOT NULL,
  caused_by_agent_id TEXT,
  mutation_type     TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'applied',
  approved_by       TEXT,
  rejected_reason   TEXT,
  applied_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_graph_mutations_project ON graph_mutations(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_mutations_run ON graph_mutations(pipeline_run_id);
ALTER TABLE graph_mutations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied';
ALTER TABLE graph_mutations ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
ALTER TABLE graph_mutations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- 3.2 Replan events — adaptive replanning audit trail
CREATE TABLE IF NOT EXISTS replan_events (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trigger           TEXT NOT NULL,
  patch_entries     JSONB NOT NULL DEFAULT '[]',
  auto_applied      INTEGER NOT NULL DEFAULT 0,
  pending_approval  INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'applied',
  approved_by       TEXT,
  rejected_reason   TEXT,
  applied_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replan_events_project ON replan_events(project_id);
ALTER TABLE replan_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied';
ALTER TABLE replan_events ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE replan_events ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
ALTER TABLE replan_events ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- 3.3 Execution goals — goal-based execution model
CREATE TABLE IF NOT EXISTS execution_goals (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  definition        JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  criteria_results  JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_execution_goals_project ON execution_goals(project_id);
CREATE INDEX IF NOT EXISTS idx_execution_goals_task ON execution_goals(task_id);

-- 3.4 Sandbox policies — capability isolation per project
CREATE TABLE IF NOT EXISTS sandbox_policies (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  isolation_level       TEXT NOT NULL DEFAULT 'workspace',
  allowed_tools         JSONB NOT NULL DEFAULT '[]',
  denied_tools          JSONB NOT NULL DEFAULT '[]',
  filesystem_scope      JSONB NOT NULL DEFAULT '[]',
  network_policy        TEXT NOT NULL DEFAULT 'project_only',
  max_execution_time_ms INTEGER NOT NULL DEFAULT 300000,
  max_output_size_bytes INTEGER NOT NULL DEFAULT 10485760,
  elevated_capabilities JSONB NOT NULL DEFAULT '[]',
  enforcement_mode      TEXT NOT NULL DEFAULT 'hard',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sandbox_policies ADD COLUMN IF NOT EXISTS enforcement_mode TEXT NOT NULL DEFAULT 'hard';
CREATE INDEX IF NOT EXISTS idx_sandbox_policies_project ON sandbox_policies(project_id);

-- 3.4b Sandbox sessions — per-task isolation sessions
CREATE TABLE IF NOT EXISTS sandbox_sessions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id          TEXT NOT NULL,
  policy            JSONB NOT NULL,
  workspace_path    TEXT NOT NULL,
  violations        JSONB NOT NULL DEFAULT '[]',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sandbox_sessions_project ON sandbox_sessions(project_id);

-- 3.6 Agent capability grants — explicit token-based permissions per role
CREATE TABLE IF NOT EXISTS agent_capability_grants (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_role    TEXT NOT NULL,
  capability    TEXT NOT NULL,
  granted       BOOLEAN NOT NULL DEFAULT true,
  granted_by    TEXT NOT NULL DEFAULT 'system',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, agent_role, capability)
);
CREATE INDEX IF NOT EXISTS idx_capability_grants_project ON agent_capability_grants(project_id);
CREATE INDEX IF NOT EXISTS idx_capability_grants_role ON agent_capability_grants(project_id, agent_role);

-- 3.5 Learning patterns — cross-project reusable patterns
CREATE TABLE IF NOT EXISTS learning_patterns (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT,
  learning_type     TEXT NOT NULL,
  task_type         TEXT NOT NULL,
  agent_role        TEXT NOT NULL,
  pattern           JSONB NOT NULL DEFAULT '{}',
  sample_count      INTEGER NOT NULL DEFAULT 0,
  success_rate      NUMERIC(5,4) NOT NULL DEFAULT 0,
  is_global         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, learning_type, task_type, agent_role)
);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_lookup ON learning_patterns(task_type, agent_role);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_global ON learning_patterns(is_global) WHERE is_global = true;

-- ---------------------------------------------------------------------------
-- OSC-001: Run Store
-- Canonical run entity for OscorpexKernel facade.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal          TEXT NOT NULL DEFAULT '',
  mode          TEXT NOT NULL DEFAULT 'execute',
  status        TEXT NOT NULL DEFAULT 'created',
  current_stage_id TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs(status);

-- ---------------------------------------------------------------------------
-- Phase 12: Replay Snapshots
-- Checkpoint-level state capture for replay and observability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replay_snapshots (
  id                        TEXT PRIMARY KEY,
  run_id                    TEXT NOT NULL,
  checkpoint_id             TEXT NOT NULL DEFAULT 'default',
  snapshot_json             TEXT NOT NULL DEFAULT '{}',
  context_hash              TEXT,
  metadata                  TEXT NOT NULL DEFAULT '{}',
  policy_decisions_json     TEXT DEFAULT '[]',
  verification_reports_json TEXT DEFAULT '[]',
  created_at                TIMESTAMPTZ NOT NULL
);

-- Migration: ensure columns exist for existing tables
ALTER TABLE replay_snapshots ADD COLUMN IF NOT EXISTS policy_decisions_json TEXT DEFAULT '[]';
ALTER TABLE replay_snapshots ADD COLUMN IF NOT EXISTS verification_reports_json TEXT DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_replay_run ON replay_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_replay_checkpoint ON replay_snapshots(run_id, checkpoint_id);

-- ---------------------------------------------------------------------------
-- Control Plane Tables (Phase 1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_instances (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'idle',
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_instances_project ON agent_instances(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status);

CREATE TABLE IF NOT EXISTS provider_runtime_registry (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'available',
  last_health_check_at TIMESTAMPTZ,
  cooldown_until      TIMESTAMPTZ,
  capabilities        TEXT NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_runtime_status ON provider_runtime_registry(status);

CREATE TABLE IF NOT EXISTS capability_snapshots (
  id            TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES provider_runtime_registry(id) ON DELETE CASCADE,
  capabilities  TEXT NOT NULL DEFAULT '[]',
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capability_snapshots_provider ON capability_snapshots(provider_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS agent_presence (
  agent_id      TEXT PRIMARY KEY REFERENCES agent_instances(id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'unknown',
  last_heartbeat_at TIMESTAMPTZ,
  payload       TEXT NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_presence_state ON agent_presence(state);

CREATE TABLE IF NOT EXISTS runtime_heartbeats (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT,
  provider_id   TEXT,
  project_id    TEXT,
  state         TEXT NOT NULL DEFAULT 'unknown',
  payload       TEXT NOT NULL DEFAULT '{}',
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runtime_heartbeats_agent ON runtime_heartbeats(agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_heartbeats_provider ON runtime_heartbeats(provider_id, recorded_at DESC);

-- Migration: remove FK constraints from runtime_heartbeats for flexible heartbeat recording
ALTER TABLE runtime_heartbeats DROP CONSTRAINT IF EXISTS runtime_heartbeats_agent_id_fkey;
ALTER TABLE runtime_heartbeats DROP CONSTRAINT IF EXISTS runtime_heartbeats_provider_id_fkey;
ALTER TABLE runtime_heartbeats DROP CONSTRAINT IF EXISTS runtime_heartbeats_project_id_fkey;

CREATE TABLE IF NOT EXISTS approvals (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  requested_by  TEXT NOT NULL DEFAULT '',
  approved_by   TEXT,
  rejected_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals(project_id);
CREATE INDEX IF NOT EXISTS idx_approvals_expires ON approvals(expires_at);

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS escalated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS escalation_target TEXT;

CREATE TABLE IF NOT EXISTS approval_events (
  id            TEXT PRIMARY KEY,
  approval_id   TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  actor         TEXT NOT NULL DEFAULT '',
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_events_approval ON approval_events(approval_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category      TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'info',
  actor         TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_category ON audit_events(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_severity ON audit_events(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_events (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'warning',
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity, created_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  severity      TEXT NOT NULL DEFAULT 'warning',
  acknowledged_by TEXT,
  resolved_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_project ON incidents(project_id);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(type);

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assignee TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_note TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS linked_task_id TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS linked_run_id TEXT;

CREATE TABLE IF NOT EXISTS incident_events (
  id            TEXT PRIMARY KEY,
  incident_id   TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  actor         TEXT NOT NULL DEFAULT '',
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- H2-A: Quality Gates Center schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quality_gates (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  tenant_id         TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  gate_type         TEXT NOT NULL,
  environment       TEXT NOT NULL DEFAULT 'production',
  required          BOOLEAN NOT NULL DEFAULT false,
  blocking          BOOLEAN NOT NULL DEFAULT false,
  auto_evaluated    BOOLEAN NOT NULL DEFAULT true,
  human_reviewed    BOOLEAN NOT NULL DEFAULT false,
  override_allowed  BOOLEAN NOT NULL DEFAULT false,
  override_roles    JSONB NOT NULL DEFAULT '[]',
  owner_role        TEXT NOT NULL,
  thresholds        JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'active',
  policy_version    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at     TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_quality_gates_lookup ON quality_gates(tenant_id, project_id, environment, gate_type, status);
CREATE INDEX IF NOT EXISTS idx_quality_gates_policy ON quality_gates(policy_version, status);
CREATE INDEX IF NOT EXISTS idx_quality_gates_type ON quality_gates(gate_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_gates_active_scope
  ON quality_gates(COALESCE(tenant_id, ''), COALESCE(project_id, ''), environment, gate_type, policy_version)
  WHERE status <> 'retired';

ALTER TABLE quality_gates ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE quality_gates ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

INSERT INTO quality_gates (
  id,
  name,
  description,
  tenant_id,
  project_id,
  gate_type,
  environment,
  required,
  blocking,
  auto_evaluated,
  human_reviewed,
  override_allowed,
  override_roles,
  owner_role,
  thresholds,
  status,
  policy_version,
  metadata
)
VALUES
  ('qg-default-v1-dev-typecheck', 'typecheck', 'TypeScript type checking must complete for development quality feedback.', NULL, NULL, 'typecheck', 'dev', true, true, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-typecheck', 'typecheck', 'TypeScript type checking must pass before staging promotion.', NULL, NULL, 'typecheck', 'staging', true, true, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-typecheck', 'typecheck', 'TypeScript type checking must pass before production release.', NULL, NULL, 'typecheck', 'production', true, true, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-test-coverage', 'test_coverage', 'Coverage is collected in development but does not block local iteration.', NULL, NULL, 'test_coverage', 'dev', false, false, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{"minimum_percent":0,"soft_minimum_percent":0}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-test-coverage', 'test_coverage', 'Coverage is required in staging and warns before production hard blocking.', NULL, NULL, 'test_coverage', 'staging', true, false, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{"minimum_percent":70,"soft_minimum_percent":75}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-test-coverage', 'test_coverage', 'Coverage must meet production threshold before release.', NULL, NULL, 'test_coverage', 'production', true, true, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{"minimum_percent":80,"soft_minimum_percent":85}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-lint', 'lint', 'Lint must pass to keep development changes reviewable.', NULL, NULL, 'lint', 'dev', true, true, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-lint', 'lint', 'Lint must pass before staging promotion.', NULL, NULL, 'lint', 'staging', true, true, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-lint', 'lint', 'Lint must pass before production release.', NULL, NULL, 'lint', 'production', true, true, true, false, true, '["engineering-lead","release-manager"]'::jsonb, 'engineering-lead', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-security-scan', 'security_scan', 'Security scan findings are visible in development and never fail open.', NULL, NULL, 'security_scan', 'dev', true, false, true, true, false, '[]'::jsonb, 'security-admin', '{"block_on":["critical"],"review_on":["high","critical"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-security-scan', 'security_scan', 'High and critical security findings block staging promotion.', NULL, NULL, 'security_scan', 'staging', true, true, true, true, false, '[]'::jsonb, 'security-admin', '{"block_on":["high","critical"],"review_on":["high","critical"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-security-scan', 'security_scan', 'High and critical security findings block production release.', NULL, NULL, 'security_scan', 'production', true, true, true, true, false, '[]'::jsonb, 'security-admin', '{"block_on":["high","critical"],"review_on":["high","critical"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-provider-policy-compliance', 'provider_policy_compliance', 'Provider policy violations are evaluated in development.', NULL, NULL, 'provider_policy_compliance', 'dev', true, false, true, true, false, '[]'::jsonb, 'platform-admin', '{"deny_blocks":true,"restricted_requires_review":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-provider-policy-compliance', 'provider_policy_compliance', 'Provider deny policy blocks staging promotion.', NULL, NULL, 'provider_policy_compliance', 'staging', true, true, true, true, false, '[]'::jsonb, 'platform-admin', '{"deny_blocks":true,"restricted_requires_review":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-provider-policy-compliance', 'provider_policy_compliance', 'Provider deny policy blocks production release.', NULL, NULL, 'provider_policy_compliance', 'production', true, true, true, true, false, '[]'::jsonb, 'platform-admin', '{"deny_blocks":true,"restricted_requires_review":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-review-acceptance', 'review_acceptance', 'Review acceptance is optional for development iteration.', NULL, NULL, 'review_acceptance', 'dev', false, false, false, true, false, '[]'::jsonb, 'release-manager', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-review-acceptance', 'review_acceptance', 'Accepted review is required before staging promotion.', NULL, NULL, 'review_acceptance', 'staging', true, true, false, true, false, '[]'::jsonb, 'release-manager', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-review-acceptance', 'review_acceptance', 'Accepted review is required before production release.', NULL, NULL, 'review_acceptance', 'production', true, true, false, true, false, '[]'::jsonb, 'release-manager', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-human-approval', 'human_approval', 'Human approval is not required for default development flow.', NULL, NULL, 'human_approval', 'dev', false, false, false, true, false, '[]'::jsonb, 'release-manager', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-human-approval', 'human_approval', 'Human approval is available but not blocking by default in staging.', NULL, NULL, 'human_approval', 'staging', false, false, false, true, false, '[]'::jsonb, 'release-manager', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-human-approval', 'human_approval', 'Human approval is required before production release.', NULL, NULL, 'human_approval', 'production', true, true, false, true, false, '[]'::jsonb, 'release-manager', '{}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-artifact-completeness', 'artifact_completeness', 'Development artifact completeness is evaluated as non-blocking evidence.', NULL, NULL, 'artifact_completeness', 'dev', true, false, true, false, true, '["release-manager","operator"]'::jsonb, 'release-manager', '{"required_artifacts":["test_report","diff_report"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-artifact-completeness', 'artifact_completeness', 'Staging requires core release artifacts.', NULL, NULL, 'artifact_completeness', 'staging', true, true, true, false, true, '["release-manager","operator"]'::jsonb, 'release-manager', '{"required_artifacts":["test_report","diff_report","review_summary"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-artifact-completeness', 'artifact_completeness', 'Production requires complete release evidence artifacts.', NULL, NULL, 'artifact_completeness', 'production', true, true, true, false, true, '["release-manager","operator"]'::jsonb, 'release-manager', '{"required_artifacts":["test_report","diff_report","review_summary","security_result","deployment_plan","rollback_plan","approval_evidence"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-cost-threshold', 'cost_threshold', 'Development cost threshold is visible but non-blocking.', NULL, NULL, 'cost_threshold', 'dev', false, false, true, false, true, '["finance-ops","operator"]'::jsonb, 'finance-ops', '{"soft_cap_usd":25,"hard_cap_usd":100}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-cost-threshold', 'cost_threshold', 'Staging cost threshold warns before production release.', NULL, NULL, 'cost_threshold', 'staging', true, false, true, false, true, '["finance-ops","operator"]'::jsonb, 'finance-ops', '{"soft_cap_usd":100,"hard_cap_usd":500}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-cost-threshold', 'cost_threshold', 'Production hard cost cap blocks release.', NULL, NULL, 'cost_threshold', 'production', true, true, true, false, true, '["finance-ops","operator"]'::jsonb, 'finance-ops', '{"soft_cap_usd":250,"hard_cap_usd":1000}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-rollback-safety-check', 'rollback_safety_check', 'Rollback plan is optional for development flow.', NULL, NULL, 'rollback_safety_check', 'dev', false, false, true, false, false, '[]'::jsonb, 'operator', '{"rollback_plan_required":false}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-rollback-safety-check', 'rollback_safety_check', 'Rollback safety is required for staging validation.', NULL, NULL, 'rollback_safety_check', 'staging', true, false, true, false, false, '[]'::jsonb, 'operator', '{"rollback_plan_required":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-rollback-safety-check', 'rollback_safety_check', 'Rollback safety is required and blocking for production release.', NULL, NULL, 'rollback_safety_check', 'production', true, true, true, false, false, '[]'::jsonb, 'operator', '{"rollback_plan_required":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-deployment-health-check', 'deployment_health_check', 'Development deployment health is recorded as non-blocking signal.', NULL, NULL, 'deployment_health_check', 'dev', true, false, true, false, true, '["operator","platform-admin"]'::jsonb, 'operator', '{"post_release_window_minutes":0}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-deployment-health-check', 'deployment_health_check', 'Staging deployment health must pass before promotion.', NULL, NULL, 'deployment_health_check', 'staging', true, true, true, false, true, '["operator","platform-admin"]'::jsonb, 'operator', '{"post_release_window_minutes":30}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-deployment-health-check', 'deployment_health_check', 'Production deployment health blocks release and rollback decisions.', NULL, NULL, 'deployment_health_check', 'production', true, true, true, false, true, '["operator","platform-admin"]'::jsonb, 'operator', '{"post_release_window_minutes":60}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-incident-freeze-window', 'incident_freeze_window', 'Development is not blocked by incident freeze by default.', NULL, NULL, 'incident_freeze_window', 'dev', false, false, true, true, true, '["operator","platform-admin"]'::jsonb, 'operator', '{"block_severities":[]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-incident-freeze-window', 'incident_freeze_window', 'Staging checks active incident freeze windows.', NULL, NULL, 'incident_freeze_window', 'staging', true, false, true, true, true, '["operator","platform-admin"]'::jsonb, 'operator', '{"block_severities":["critical"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-incident-freeze-window', 'incident_freeze_window', 'Production release is blocked during P0/P1 incident freeze unless overridden.', NULL, NULL, 'incident_freeze_window', 'production', true, true, true, true, true, '["operator","platform-admin"]'::jsonb, 'operator', '{"block_severities":["high","critical"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-tenant-compliance', 'tenant_compliance', 'Tenant compliance is enforced in development to prevent isolation regressions.', NULL, NULL, 'tenant_compliance', 'dev', true, true, true, true, false, '[]'::jsonb, 'tenant-admin', '{"tenant_id_required":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-tenant-compliance', 'tenant_compliance', 'Tenant compliance blocks staging promotion.', NULL, NULL, 'tenant_compliance', 'staging', true, true, true, true, false, '[]'::jsonb, 'tenant-admin', '{"tenant_id_required":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-tenant-compliance', 'tenant_compliance', 'Tenant compliance blocks production release and cannot be overridden.', NULL, NULL, 'tenant_compliance', 'production', true, true, true, true, false, '[]'::jsonb, 'tenant-admin', '{"tenant_id_required":true}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb),

  ('qg-default-v1-dev-audit-trail-completeness', 'audit_trail_completeness', 'Audit trail completeness is required in every environment.', NULL, NULL, 'audit_trail_completeness', 'dev', true, true, true, false, false, '[]'::jsonb, 'compliance-owner', '{"required_fields":["actor","correlation_id","policy_version","artifact_digest"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"dev","override_reason_required":true}'::jsonb),
  ('qg-default-v1-staging-audit-trail-completeness', 'audit_trail_completeness', 'Audit trail completeness is required in every environment.', NULL, NULL, 'audit_trail_completeness', 'staging', true, true, true, false, false, '[]'::jsonb, 'compliance-owner', '{"required_fields":["actor","correlation_id","policy_version","artifact_digest"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"staging","override_reason_required":true}'::jsonb),
  ('qg-default-v1-production-audit-trail-completeness', 'audit_trail_completeness', 'Audit trail completeness blocks production release and cannot be overridden.', NULL, NULL, 'audit_trail_completeness', 'production', true, true, true, false, false, '[]'::jsonb, 'compliance-owner', '{"required_fields":["actor","correlation_id","policy_version","artifact_digest"]}'::jsonb, 'active', '1', '{"source":"system-default","category":"release-gate","introduced_by":"H2-B","environment_policy":"production","override_reason_required":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  gate_type = EXCLUDED.gate_type,
  environment = EXCLUDED.environment,
  required = EXCLUDED.required,
  blocking = EXCLUDED.blocking,
  auto_evaluated = EXCLUDED.auto_evaluated,
  human_reviewed = EXCLUDED.human_reviewed,
  override_allowed = EXCLUDED.override_allowed,
  override_roles = EXCLUDED.override_roles,
  owner_role = EXCLUDED.owner_role,
  thresholds = EXCLUDED.thresholds,
  status = EXCLUDED.status,
  policy_version = EXCLUDED.policy_version,
  updated_at = now(),
  metadata = EXCLUDED.metadata;

CREATE TABLE IF NOT EXISTS release_candidates (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id              TEXT REFERENCES projects(id) ON DELETE CASCADE,
  goal_ids                JSONB NOT NULL DEFAULT '[]',
  target_environment      TEXT NOT NULL,
  state                   TEXT NOT NULL DEFAULT 'candidate',
  requested_by            TEXT NOT NULL DEFAULT '',
  artifact_ids            JSONB NOT NULL DEFAULT '[]',
  policy_version          TEXT NOT NULL,
  correlation_id          TEXT NOT NULL,
  deploy_window_starts_at TIMESTAMPTZ,
  deploy_window_ends_at   TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at               TIMESTAMPTZ,
  metadata                JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_release_candidates_state ON release_candidates(tenant_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_candidates_project ON release_candidates(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_candidates_env ON release_candidates(target_environment, state);
CREATE INDEX IF NOT EXISTS idx_release_candidates_goal_ids ON release_candidates USING GIN(goal_ids);
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_candidates_idempotency
  ON release_candidates(tenant_id, correlation_id)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS artifact_references (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
  goal_id               TEXT REFERENCES execution_goals(id) ON DELETE CASCADE,
  release_candidate_id  TEXT REFERENCES release_candidates(id) ON DELETE CASCADE,
  artifact_type         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'available',
  location              TEXT NOT NULL,
  digest                TEXT NOT NULL,
  produced_by           TEXT NOT NULL DEFAULT '',
  content_type          TEXT,
  size_bytes            BIGINT,
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  produced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_artifact_refs_goal ON artifact_references(tenant_id, goal_id, artifact_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifact_refs_release ON artifact_references(tenant_id, release_candidate_id, artifact_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifact_refs_status ON artifact_references(status, artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifact_refs_digest ON artifact_references(digest);
CREATE UNIQUE INDEX IF NOT EXISTS uq_artifact_ref_digest_scope
  ON artifact_references(tenant_id, artifact_type, digest)
  WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_artifact_ref_idempotency
  ON artifact_references(tenant_id, correlation_id, artifact_type)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quality_signals (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
  goal_id               TEXT REFERENCES execution_goals(id) ON DELETE CASCADE,
  release_candidate_id  TEXT REFERENCES release_candidates(id) ON DELETE CASCADE,
  signal_type           TEXT NOT NULL,
  severity              TEXT NOT NULL DEFAULT 'info',
  status                TEXT NOT NULL DEFAULT 'observed',
  source                TEXT NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}',
  artifact_id           TEXT REFERENCES artifact_references(id) ON DELETE SET NULL,
  observed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ,
  correlation_id        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_quality_signals_scope ON quality_signals(tenant_id, release_candidate_id, signal_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_signals_goal ON quality_signals(tenant_id, goal_id, signal_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_signals_status ON quality_signals(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_quality_signals_severity ON quality_signals(severity, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_signals_idempotency
  ON quality_signals(source, correlation_id, signal_type);

CREATE TABLE IF NOT EXISTS quality_gate_evaluations (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
  goal_id               TEXT REFERENCES execution_goals(id) ON DELETE CASCADE,
  release_candidate_id  TEXT REFERENCES release_candidates(id) ON DELETE CASCADE,
  gate_id               TEXT NOT NULL REFERENCES quality_gates(id) ON DELETE RESTRICT,
  gate_type             TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  outcome               TEXT NOT NULL,
  blocking              BOOLEAN NOT NULL DEFAULT false,
  required              BOOLEAN NOT NULL DEFAULT false,
  reason                TEXT NOT NULL DEFAULT '',
  details               JSONB NOT NULL DEFAULT '{}',
  quality_signal_ids    JSONB NOT NULL DEFAULT '[]',
  artifact_ids          JSONB NOT NULL DEFAULT '[]',
  evaluated_by          TEXT NOT NULL DEFAULT 'system',
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  idempotency_key       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_qge_goal_latest ON quality_gate_evaluations(tenant_id, goal_id, gate_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qge_release_latest ON quality_gate_evaluations(tenant_id, release_candidate_id, gate_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qge_outcome ON quality_gate_evaluations(outcome, blocking, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qge_policy ON quality_gate_evaluations(policy_version, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qge_idempotency
  ON quality_gate_evaluations(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS approval_requests (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
  goal_id               TEXT REFERENCES execution_goals(id) ON DELETE CASCADE,
  release_candidate_id  TEXT REFERENCES release_candidates(id) ON DELETE CASCADE,
  approval_class        TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'pending',
  required_roles        JSONB NOT NULL DEFAULT '[]',
  required_quorum       INTEGER NOT NULL DEFAULT 1,
  rejection_policy      TEXT NOT NULL DEFAULT 'any_rejection_blocks',
  requested_by          TEXT NOT NULL DEFAULT 'system',
  reason                TEXT NOT NULL DEFAULT '',
  artifact_ids          JSONB NOT NULL DEFAULT '[]',
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_pending ON approval_requests(tenant_id, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_goal ON approval_requests(tenant_id, goal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_release ON approval_requests(tenant_id, release_candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_class ON approval_requests(approval_class, state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_request_active_scope
  ON approval_requests(tenant_id, approval_class, COALESCE(goal_id, ''), COALESCE(release_candidate_id, ''), policy_version)
  WHERE state IN ('pending', 'in-review', 'approved') AND tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS approval_decisions (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  approval_request_id   TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  decision              TEXT NOT NULL,
  actor_id              TEXT NOT NULL,
  actor_roles           JSONB NOT NULL DEFAULT '[]',
  decision_reason       TEXT NOT NULL DEFAULT '',
  artifact_ids          JSONB NOT NULL DEFAULT '[]',
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_request ON approval_decisions(approval_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_actor ON approval_decisions(tenant_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_decision ON approval_decisions(decision, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_decision_actor_request
  ON approval_decisions(approval_request_id, actor_id, decision)
  WHERE decision IN ('approved', 'rejected');

CREATE TABLE IF NOT EXISTS review_results (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
  goal_id               TEXT NOT NULL REFERENCES execution_goals(id) ON DELETE CASCADE,
  release_candidate_id  TEXT REFERENCES release_candidates(id) ON DELETE CASCADE,
  review_type           TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'pending',
  reviewer_id           TEXT NOT NULL DEFAULT 'system',
  summary               TEXT NOT NULL DEFAULT '',
  findings              JSONB NOT NULL DEFAULT '[]',
  artifact_ids          JSONB NOT NULL DEFAULT '[]',
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_review_results_goal_latest ON review_results(tenant_id, goal_id, review_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_results_release ON review_results(tenant_id, release_candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_results_state ON review_results(state, created_at DESC);

CREATE TABLE IF NOT EXISTS release_decisions (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  release_candidate_id  TEXT NOT NULL REFERENCES release_candidates(id) ON DELETE CASCADE,
  decision              TEXT NOT NULL,
  allowed               BOOLEAN NOT NULL DEFAULT false,
  blocked_reasons       JSONB NOT NULL DEFAULT '[]',
  required_approvals    JSONB NOT NULL DEFAULT '[]',
  required_artifacts    JSONB NOT NULL DEFAULT '[]',
  gate_evaluation_ids   JSONB NOT NULL DEFAULT '[]',
  approval_request_ids  JSONB NOT NULL DEFAULT '[]',
  approval_decision_ids JSONB NOT NULL DEFAULT '[]',
  override_action_ids   JSONB NOT NULL DEFAULT '[]',
  rollback_trigger_ids  JSONB NOT NULL DEFAULT '[]',
  rollback_action       TEXT NOT NULL DEFAULT 'none',
  evaluated_by          TEXT NOT NULL DEFAULT 'system',
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_release_decisions_candidate_latest ON release_decisions(tenant_id, release_candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_decisions_decision ON release_decisions(decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_decisions_policy ON release_decisions(policy_version, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_decision_idempotency
  ON release_decisions(tenant_id, release_candidate_id, correlation_id)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS override_actions (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  release_candidate_id  TEXT NOT NULL REFERENCES release_candidates(id) ON DELETE CASCADE,
  gate_evaluation_id    TEXT REFERENCES quality_gate_evaluations(id) ON DELETE RESTRICT,
  approval_request_id   TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
  override_class        TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'requested',
  requested_by          TEXT NOT NULL,
  approved_by           TEXT,
  reason                TEXT NOT NULL,
  scope                 JSONB NOT NULL DEFAULT '{}',
  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_override_actions_active ON override_actions(tenant_id, release_candidate_id, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_override_actions_gate ON override_actions(gate_evaluation_id, state);
CREATE INDEX IF NOT EXISTS idx_override_actions_class ON override_actions(override_class, state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_override_active_gate
  ON override_actions(tenant_id, release_candidate_id, gate_evaluation_id)
  WHERE state IN ('requested', 'approved', 'active') AND tenant_id IS NOT NULL AND gate_evaluation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rollback_triggers (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  release_candidate_id  TEXT NOT NULL REFERENCES release_candidates(id) ON DELETE CASCADE,
  trigger_type          TEXT NOT NULL,
  severity              TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'detected',
  automatic             BOOLEAN NOT NULL DEFAULT false,
  source                TEXT NOT NULL,
  reason                TEXT NOT NULL,
  quality_signal_ids    JSONB NOT NULL DEFAULT '[]',
  artifact_ids          JSONB NOT NULL DEFAULT '[]',
  incident_id           TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  resolved_by           TEXT,
  resolved_at           TIMESTAMPTZ,
  policy_version        TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at         TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_rollback_triggers_active ON rollback_triggers(tenant_id, release_candidate_id, state, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rollback_triggers_type ON rollback_triggers(trigger_type, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rollback_triggers_incident ON rollback_triggers(incident_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rollback_trigger_idempotency
  ON rollback_triggers(tenant_id, release_candidate_id, trigger_type, correlation_id)
  WHERE tenant_id IS NOT NULL;

-- vH2-F: Artifact linkage + title metadata (idempotent)
ALTER TABLE artifact_references
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE artifact_references
  ADD COLUMN IF NOT EXISTS approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL;
ALTER TABLE artifact_references
  ADD COLUMN IF NOT EXISTS release_decision_id TEXT REFERENCES release_decisions(id) ON DELETE SET NULL;
ALTER TABLE artifact_references
  ADD COLUMN IF NOT EXISTS rollback_trigger_id TEXT REFERENCES rollback_triggers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_artifact_refs_approval_request ON artifact_references(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_artifact_refs_release_decision ON artifact_references(release_decision_id);
CREATE INDEX IF NOT EXISTS idx_artifact_refs_rollback_trigger ON artifact_references(rollback_trigger_id);

-- ---------------------------------------------------------------------------
-- Phase 2: Operator Actions & Governance Flags
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operator_actions (
  id            TEXT PRIMARY KEY,
  action_type   TEXT NOT NULL,
  target_id     TEXT,
  target_type   TEXT,
  actor         TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'success',
  result        TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operator_actions_type ON operator_actions(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_actions_actor ON operator_actions(actor, created_at DESC);

CREATE TABLE IF NOT EXISTS operator_flags (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL DEFAULT '',
  set_by        TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
