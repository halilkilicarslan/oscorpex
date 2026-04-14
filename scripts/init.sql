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
  started_at                TEXT,
  completed_at              TEXT,
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
  fallback_order INTEGER NOT NULL DEFAULT 0
);

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
  created_at      TEXT NOT NULL,
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
  created_at        TEXT NOT NULL,
  read_at           TEXT
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
  created_at      TEXT NOT NULL
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
  started_at      TEXT,
  stopped_at      TEXT,
  created_at      TEXT NOT NULL
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
  created_at             TEXT NOT NULL
);

-- Migration: add cache token columns to existing token_usage tables
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER DEFAULT 0;
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER DEFAULT 0;

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
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS model_routing_policies (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL DEFAULT 'global',
  task_type       TEXT NOT NULL DEFAULT '*',
  risk_level      TEXT NOT NULL DEFAULT '*',
  provider        TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  effort          TEXT NOT NULL DEFAULT 'medium',
  fallback_chain  TEXT NOT NULL DEFAULT '[]',
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
  created_at      TEXT NOT NULL
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
  updated_at      TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_chat_project           ON chat_messages(project_id);
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
CREATE INDEX IF NOT EXISTS idx_sonar_scans_project    ON sonar_scans(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_settings_unique ON project_settings(project_id, category, key);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at);

-- v3.0: Sub-task parent index
CREATE INDEX IF NOT EXISTS idx_tasks_parent             ON tasks(parent_task_id);

-- v3.2: Work items indexes
CREATE INDEX IF NOT EXISTS idx_work_items_project       ON work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status        ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_sprint        ON work_items(sprint_id);

-- v3.4: Memory indexes
CREATE INDEX IF NOT EXISTS idx_ctx_snapshots_project    ON project_context_snapshots(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_snapshots_kind ON project_context_snapshots(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_conv_compactions_project ON conversation_compactions(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_facts_project     ON memory_facts(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_key  ON memory_facts(project_id, scope, key);
CREATE INDEX IF NOT EXISTS idx_model_routing_scope      ON model_routing_policies(scope);

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
-- Indexes — RAG Embeddings (pgvector)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_rag_emb_kb     ON rag_embeddings(kb_id);
CREATE INDEX IF NOT EXISTS idx_rag_emb_doc    ON rag_embeddings(doc_id);
CREATE INDEX IF NOT EXISTS idx_rag_emb_vector ON rag_embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
