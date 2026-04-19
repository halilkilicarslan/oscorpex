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
  review_status             TEXT,
  reviewer_agent_id         TEXT,
  revision_count            INTEGER NOT NULL DEFAULT 0,
  assigned_agent_id         TEXT
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
