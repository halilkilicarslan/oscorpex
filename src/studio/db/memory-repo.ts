// ---------------------------------------------------------------------------
// Oscorpex — Memory Repository: Context Snapshots, Facts, Routing Policies
// ---------------------------------------------------------------------------

import { execute, getPool, query, queryOne } from "../pg.js";
import { now, rowToMemoryFact, rowToContextSnapshot, rowToConversationCompaction } from "./helpers.js";
import type { MemoryFact, ProjectContextSnapshot, ConversationCompaction, ModelRoutingPolicy } from "../types.js";

// ---------------------------------------------------------------------------
// Context Snapshots
// ---------------------------------------------------------------------------

export async function upsertContextSnapshot(
	projectId: string,
	kind: string,
	summaryJson: Record<string, unknown>,
	sourceVersion: number,
): Promise<ProjectContextSnapshot> {
	const ts = now();
	await execute(
		`
    INSERT INTO context_snapshots (project_id, kind, summary_json, source_version, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (project_id, kind) DO UPDATE
      SET summary_json = EXCLUDED.summary_json,
          source_version = EXCLUDED.source_version,
          updated_at = EXCLUDED.updated_at
    `,
		[projectId, kind, JSON.stringify(summaryJson), sourceVersion, ts],
	);
	return { projectId, kind, summaryJson, sourceVersion, updatedAt: ts };
}

export async function getContextSnapshot(projectId: string, kind: string): Promise<ProjectContextSnapshot | null> {
	const row = await queryOne<any>(
		"SELECT * FROM context_snapshots WHERE project_id = $1 AND kind = $2",
		[projectId, kind],
	);
	return row ? rowToContextSnapshot(row) : null;
}

export async function getContextSnapshots(projectId: string): Promise<ProjectContextSnapshot[]> {
	const rows = await query<any>(
		"SELECT * FROM context_snapshots WHERE project_id = $1 ORDER BY kind",
		[projectId],
	);
	return rows.map(rowToContextSnapshot);
}

// ---------------------------------------------------------------------------
// Conversation Compactions
// ---------------------------------------------------------------------------

export async function upsertConversationCompaction(
	projectId: string,
	channel: string,
	lastMessageId: string,
	summary: string,
): Promise<ConversationCompaction> {
	const ts = now();
	await execute(
		`
    INSERT INTO conversation_compactions (project_id, channel, last_message_id, summary, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (project_id, channel) DO UPDATE
      SET last_message_id = EXCLUDED.last_message_id,
          summary = EXCLUDED.summary,
          updated_at = EXCLUDED.updated_at
    `,
		[projectId, channel, lastMessageId, summary, ts],
	);
	return { projectId, channel, lastMessageId, summary, updatedAt: ts };
}

export async function getConversationCompaction(
	projectId: string,
	channel: string,
): Promise<ConversationCompaction | null> {
	const row = await queryOne<any>(
		"SELECT * FROM conversation_compactions WHERE project_id = $1 AND channel = $2",
		[projectId, channel],
	);
	return row ? rowToConversationCompaction(row) : null;
}

// ---------------------------------------------------------------------------
// Memory Facts
// ---------------------------------------------------------------------------

export async function upsertMemoryFact(
	projectId: string,
	scope: string,
	key: string,
	value: string,
	confidence = 1.0,
	source = "system",
): Promise<MemoryFact> {
	const ts = now();
	await execute(
		`
    INSERT INTO memory_facts (project_id, scope, key, value, confidence, source, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (project_id, scope, key) DO UPDATE
      SET value = EXCLUDED.value,
          confidence = EXCLUDED.confidence,
          source = EXCLUDED.source,
          updated_at = EXCLUDED.updated_at
    `,
		[projectId, scope, key, value, confidence, source, ts],
	);
	return { projectId, scope, key, value, confidence, source, updatedAt: ts };
}

export async function getMemoryFacts(projectId: string, scope?: string): Promise<MemoryFact[]> {
	let rows: any[];
	if (scope) {
		rows = await query<any>(
			"SELECT * FROM memory_facts WHERE project_id = $1 AND scope = $2 ORDER BY scope, key",
			[projectId, scope],
		);
	} else {
		rows = await query<any>(
			"SELECT * FROM memory_facts WHERE project_id = $1 ORDER BY scope, key",
			[projectId],
		);
	}
	return rows.map(rowToMemoryFact);
}

export async function getMemoryFact(projectId: string, scope: string, key: string): Promise<MemoryFact | null> {
	const row = await queryOne<any>(
		"SELECT * FROM memory_facts WHERE project_id = $1 AND scope = $2 AND key = $3",
		[projectId, scope, key],
	);
	return row ? rowToMemoryFact(row) : null;
}

export async function deleteMemoryFact(projectId: string, scope: string, key: string): Promise<void> {
	await execute(
		"DELETE FROM memory_facts WHERE project_id = $1 AND scope = $2 AND key = $3",
		[projectId, scope, key],
	);
}

// ---------------------------------------------------------------------------
// Model Routing Policies
// ---------------------------------------------------------------------------

export async function upsertRoutingPolicy(data: {
	scope: string;
	taskType: string;
	riskLevel: string;
	provider: string;
	model: string;
	effort: string;
	fallbackChain: string[];
}): Promise<void> {
	const ts = now();
	await execute(
		`
    INSERT INTO model_routing_policies (scope, task_type, risk_level, provider, model, effort, fallback_chain, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (scope, task_type, risk_level) DO UPDATE
      SET provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          effort = EXCLUDED.effort,
          fallback_chain = EXCLUDED.fallback_chain,
          updated_at = EXCLUDED.updated_at
    `,
		[data.scope, data.taskType, data.riskLevel, data.provider, data.model, data.effort, JSON.stringify(data.fallbackChain), ts],
	);
}

export async function getRoutingPolicies(scope: string): Promise<ModelRoutingPolicy[]> {
	const rows = await query<any>(
		"SELECT * FROM model_routing_policies WHERE scope = $1 ORDER BY task_type, risk_level",
		[scope],
	);
	return rows.map(rowToRoutingPolicy);
}

export async function getRoutingPolicy(
	scope: string,
	taskType: string,
	riskLevel: string,
): Promise<ModelRoutingPolicy | null> {
	const row = await queryOne<any>(
		"SELECT * FROM model_routing_policies WHERE scope = $1 AND task_type = $2 AND risk_level = $3",
		[scope, taskType, riskLevel],
	);
	return row ? rowToRoutingPolicy(row) : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToRoutingPolicy(row: any): ModelRoutingPolicy {
	return {
		scope: row.scope,
		taskType: row.task_type,
		riskLevel: row.risk_level,
		provider: row.provider,
		model: row.model,
		effort: row.effort,
		fallbackChain: JSON.parse(row.fallback_chain),
	};
}
