// ---------------------------------------------------------------------------
// Tenancy — table classification registry (F0).
//
// Every table in scripts/init.sql has exactly one entry here. The unit test
// table-classification.test.ts keeps this file in sync with init.sql.
//
//   tenant-owned : holds a tenant's data (needs RLS)
//   pre-tenant   : identity/tenancy rows read before a tenant is known
//   global       : platform-wide catalog/config shared by all tenants
//   system       : platform-operator/internal state, never exposed to tenants
//   legacy       : unused/dead
//
// tenantKey = first of tenant_id > project_id > task_id present in the table
// columns, or "none". rlsPhase is non-null only for tenant-owned/pre-tenant.
// ---------------------------------------------------------------------------

export type TableClass = "tenant-owned" | "pre-tenant" | "global" | "system" | "legacy";
export type TenantKey = "tenant_id" | "project_id" | "task_id" | "none";
export type RlsPhase = "F1" | "F5-1" | "F5-2" | "F5-3" | "F5-4" | "F5-5" | "F5-6";

export type TableWriter = "tenant" | "platform-admin" | "system-only";

/** Phases whose RLS policies are enforced in the DB today. Extend as phases land. */
export const RLS_ENFORCED_PHASES = ["F1"] as const;

export interface TableClassification {
	class: TableClass;
	tenantKey: TenantKey;
	rlsPhase: RlsPhase | null;
	/** Who may write: tenant members, platform admins only, or internal system code only. */
	writer: TableWriter;
	/** Preset/public rows are readable by all tenants; writes to them are admin-only. */
	sharedRows?: true;
	note?: string;
}

const owned = (tenantKey: TenantKey, rlsPhase: RlsPhase, note?: string): TableClassification => ({
	class: "tenant-owned",
	tenantKey,
	rlsPhase,
	writer: "tenant",
	...(note ? { note } : {}),
});
const shared = (note?: string, tenantKey: TenantKey = "none"): TableClassification => ({
	...owned(tenantKey, "F5-6", note),
	sharedRows: true,
});
const preTenant = (tenantKey: TenantKey, rlsPhase: RlsPhase, note?: string): TableClassification => ({
	class: "pre-tenant",
	tenantKey,
	rlsPhase,
	writer: "tenant",
	...(note ? { note } : {}),
});
const other = (
	cls: "global" | "system" | "legacy",
	writer: Exclude<TableWriter, "tenant">,
	note?: string,
): TableClassification => ({
	class: cls,
	tenantKey: "none",
	rlsPhase: null,
	writer,
	...(note ? { note } : {}),
});

export const TABLE_CLASSIFICATION: Record<string, TableClassification> = {
	// --- F1: RLS already enabled in init.sql -----------------------------------
	agent_dependencies: owned("project_id", "F1"),
	agent_messages: owned("project_id", "F1"),
	chat_messages: owned("project_id", "F1"),
	checkpoints: owned("tenant_id", "F1"),
	commit_proposals: owned("tenant_id", "F1"),
	events: owned("project_id", "F1"),
	git_checkpoints: owned("tenant_id", "F1"),
	hermes_api_keys: owned("tenant_id", "F1"),
	hermes_sessions: owned("tenant_id", "F1"),
	notifications: owned("tenant_id", "F1"),
	phases: owned("tenant_id", "F1"),
	pipeline_runs: owned("project_id", "F1"),
	project_agents: owned("project_id", "F1"),
	project_plans: owned("tenant_id", "F1"),
	projects: owned("tenant_id", "F1"),
	rollback_requests: owned("tenant_id", "F1"),
	sprints: owned("project_id", "F1"),
	tasks: owned("tenant_id", "F1"),
	token_usage: owned("project_id", "F1"),
	work_items: owned("project_id", "F1"),

	// --- F5-1: agent runtime ---------------------------------------------------
	agent_capabilities: owned("project_id", "F5-1"),
	agent_capability_grants: owned("project_id", "F5-1"),
	agent_daily_stats: owned("project_id", "F5-1"),
	agent_episodes: owned("project_id", "F5-1"),
	agent_instances: owned("project_id", "F5-1"),
	agent_protocol_messages: owned("project_id", "F5-1"),
	agent_runs: owned("project_id", "F5-1"),
	agent_sessions: owned("project_id", "F5-1"),
	agent_strategy_patterns: owned("project_id", "F5-1"),
	runtime_heartbeats: owned("project_id", "F5-1"),

	// --- F5-2: governance / quality -------------------------------------------
	approval_requests: owned("tenant_id", "F5-2"),
	approval_rules: owned("project_id", "F5-2"),
	approvals: owned("project_id", "F5-2"),
	audit_events: owned("project_id", "F5-2"),
	ci_trackings: owned("project_id", "F5-2"),
	command_audit_logs: owned("project_id", "F5-2"),
	incidents: owned("project_id", "F5-2"),
	quality_gate_evaluations: owned("tenant_id", "F5-2"),
	quality_gates: owned("tenant_id", "F5-2"),
	quality_signals: owned("tenant_id", "F5-2"),
	release_candidates: owned("tenant_id", "F5-2"),
	review_results: owned("tenant_id", "F5-2"),
	sandbox_policies: owned("project_id", "F5-2"),
	sandbox_sessions: owned("project_id", "F5-2"),
	security_events: owned("project_id", "F5-2"),
	sonar_scans: owned("project_id", "F5-2"),
	test_results: owned("project_id", "F5-2"),

	// --- F5-3: context / memory ------------------------------------------------
	artifact_references: owned("tenant_id", "F5-3"),
	context_events: owned("project_id", "F5-3"),
	context_search_log: owned("project_id", "F5-3"),
	context_search_stats: owned("project_id", "F5-3"),
	context_sources: owned("project_id", "F5-3"),
	conversation_compactions: owned("project_id", "F5-3"),
	memory_facts: owned("project_id", "F5-3"),
	project_context_snapshots: owned("project_id", "F5-3"),
	task_diffs: owned("task_id", "F5-3"),
	verification_results: owned("task_id", "F5-3"),

	// --- F5-4: planning / execution --------------------------------------------
	execution_goals: owned("project_id", "F5-4"),
	graph_mutations: owned("project_id", "F5-4"),
	intake_questions: owned("project_id", "F5-4"),
	plugin_executions: owned("project_id", "F5-4"),
	project_settings: owned("project_id", "F5-4"),
	project_skills: owned("project_id", "F5-4"),
	replan_events: owned("project_id", "F5-4"),
	runs: owned("project_id", "F5-4"),
	task_proposals: owned("project_id", "F5-4"),
	webhooks: owned("project_id", "F5-4"),

	// --- F5-5: remaining tenant_id tables + identity ---------------------------
	approval_decisions: owned("tenant_id", "F5-5"),
	learning_patterns: owned("tenant_id", "F5-5"),
	override_actions: owned("tenant_id", "F5-5"),
	release_decisions: owned("tenant_id", "F5-5"),
	rollback_triggers: owned("tenant_id", "F5-5"),
	api_keys: preTenant("tenant_id", "F5-5", "API key lookup happens before the tenant is known"),
	tenants: preTenant("none", "F5-5", "the tenant registry itself; resolved before app.current_tenant_id is set"),
	user_roles: preTenant("tenant_id", "F5-5", "role lookup during authentication"),
	users: preTenant("tenant_id", "F5-5", "login/lookup before the tenant is known"),

	// --- F5-6: tenant data in tables with no tenant column today ---------------
	agent_presence: owned("none", "F5-6", "presence/repo.ts; keyed by agent_id of a project agent"),
	agent_configs: shared(
		"agent-repo.ts; preset agents (is_preset=1) readable by all, writes admin-only; user rows owned by (tenant_id, created_by)",
		"tenant_id",
	),
	project_templates: shared("template-repo.ts; public templates readable by all, writes admin-only"),
	agent_skills: owned("none", "F5-6", "skill-repo.ts; agent_id + skill_id; follows agent/skill ownership (see skills)"),
	alert_history: owned("none", "F5-6", "observability/alerts.ts; child of alert_rules via rule_id"),
	alert_rules: owned("none", "F5-6", "observability/alerts.ts; per-installation rules, no tenant column"),
	approval_events: owned("none", "F5-6", "approvals/repo.ts; child of approvals via approval_id"),
	context_chunks: owned("none", "F5-6", "context-repo.ts; child of context_sources via source_id"),
	custom_team_templates: owned(
		"tenant_id",
		"F5-6",
		"team-repo.ts; user-created templates (preset team_templates are global)",
	),
	feedbacks: owned("none", "F5-6", "observability/feedbacks.ts; user ratings on traces/agents"),
	incident_events: owned("none", "F5-6", "incidents/repo.ts; child of incidents via incident_id"),
	observability_logs: owned("none", "F5-6", "observability/logs.ts; trace/span-linked logs"),
	observability_spans: owned("none", "F5-6", "observability/traces.ts; may carry tenant data in attributes"),
	observability_traces: owned("none", "F5-6", "observability/traces.ts; entity_id references tenant agents/projects"),
	prompt_templates: owned("none", "F5-6", "observability/prompts.ts; user-authored prompts"),
	rag_documents: owned("none", "F5-6", "document-indexer.ts; child of rag_knowledge_bases via kb_id"),
	rag_embeddings: owned("none", "F5-6", "vector-store.ts; tenant document content and vectors"),
	rag_knowledge_bases: owned("none", "F5-6", "document-indexer.ts, context-builder.ts; user knowledge bases"),
	rag_queries: owned("none", "F5-6", "observability/rag.ts; query log per knowledge base"),
	replay_snapshots: owned("none", "F5-6", "replay-store.ts; run_id-keyed execution snapshots"),
	skills: shared(
		"skill-repo.ts; is_global rows readable by all, writes admin-only; user rows owned by (tenant_id, created_by)",
		"tenant_id",
	),
	trigger_logs: owned("none", "F5-6", "observability/triggers.ts; child of triggers via trigger_id"),
	triggers: owned("none", "F5-6", "observability/triggers.ts; user-defined automation"),
	webhook_deliveries: owned("none", "F5-6", "webhook-repo.ts; child of webhooks via webhook_id"),

	// --- global: platform-wide catalog/config ----------------------------------
	agent_strategies: other("global", "platform-admin", "strategy-repo.ts; per-role strategy catalog, seeded"),
	ai_providers: other("global", "platform-admin", "provider-repo.ts; platform provider config incl. api_key"),
	capability_snapshots: other("global", "platform-admin", "registry/repo.ts; provider capability history"),
	provider_runtime_registry: other("global", "platform-admin", "registry/repo.ts; provider health registry"),
	registered_plugins: other("global", "platform-admin", "plugin-repo.ts; installed platform plugins"),
	team_templates: other("global", "platform-admin", "team-repo.ts, seed.ts; preset team catalog"),

	// --- system: operator / internal state -------------------------------------
	cli_probe_events: other("system", "system-only", "cli-usage/persistence.ts; host CLI probe log"),
	cli_probe_settings: other("system", "system-only", "cli-usage/persistence.ts; host CLI probe config"),
	cli_usage_snapshots: other("system", "system-only", "cli-usage/persistence.ts; host CLI usage"),
	operator_actions: other("system", "platform-admin", "operator-actions/service.ts; operator action audit"),
	operator_flags: other("system", "platform-admin", "operator-actions/service.ts; platform kill-switch flags"),
	provider_state: other("system", "system-only", "provider-state.ts; host-level cooldown state per adapter"),
	schema_meta: other("system", "system-only", "db-bootstrap.ts; hash of the last applied init.sql"),

	// --- legacy: unused --------------------------------------------------------
	jobs: other("legacy", "system-only", "job-queue and /jobs routes to be deleted in F3"),
	marketplace_items: other("legacy", "system-only", "marketplace route is not mounted"),
	voltagent_memory_conversations: other("legacy", "system-only", "VoltAgent library memory adapter only"),
	voltagent_memory_messages: other("legacy", "system-only", "VoltAgent library memory adapter only"),
	voltagent_memory_steps: other("legacy", "system-only", "VoltAgent library memory adapter only"),
	voltagent_memory_workflow_states: other("legacy", "system-only", "VoltAgent library memory adapter only"),
};

/** Sorted table names belonging to the given class. */
export function tablesByClass(cls: TableClass): string[] {
	return Object.entries(TABLE_CLASSIFICATION)
		.filter(([, e]) => e.class === cls)
		.map(([name]) => name)
		.sort();
}
