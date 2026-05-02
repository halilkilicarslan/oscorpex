// ---------------------------------------------------------------------------
// Oscorpex — Memory Repository: Context Snapshots, Facts
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, getPool, query, queryOne } from "../pg.js";
import type { ConversationCompaction, MemoryFact, ProjectContextSnapshot } from "../types.js";
import { now, rowToContextSnapshot, rowToConversationCompaction, rowToMemoryFact } from "./helpers.js";
const log = createLogger("memory-repo");

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
    INSERT INTO project_context_snapshots (id, project_id, kind, summary_json, source_version, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (project_id, kind) DO UPDATE
      SET summary_json = EXCLUDED.summary_json,
          source_version = EXCLUDED.source_version,
          updated_at = EXCLUDED.updated_at
    `,
		[randomUUID(), projectId, kind, JSON.stringify(summaryJson), sourceVersion, ts],
	);
	return { projectId, kind, summaryJson, sourceVersion, updatedAt: ts };
}

export async function getContextSnapshot(projectId: string, kind: string): Promise<ProjectContextSnapshot | null> {
	const row = await queryOne<any>("SELECT * FROM project_context_snapshots WHERE project_id = $1 AND kind = $2", [
		projectId,
		kind,
	]);
	return row ? rowToContextSnapshot(row) : null;
}

export async function getContextSnapshots(projectId: string): Promise<ProjectContextSnapshot[]> {
	const rows = await query<any>("SELECT * FROM project_context_snapshots WHERE project_id = $1 ORDER BY kind", [
		projectId,
	]);
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
    INSERT INTO conversation_compactions (id, project_id, channel, last_message_id, summary, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (project_id, channel) DO UPDATE
      SET last_message_id = EXCLUDED.last_message_id,
          summary = EXCLUDED.summary,
          updated_at = EXCLUDED.updated_at
    `,
		[randomUUID(), projectId, channel, lastMessageId, summary, ts],
	);
	return { projectId, channel, lastMessageId, summary, updatedAt: ts };
}

export async function getConversationCompaction(
	projectId: string,
	channel: string,
): Promise<ConversationCompaction | null> {
	const row = await queryOne<any>("SELECT * FROM conversation_compactions WHERE project_id = $1 AND channel = $2", [
		projectId,
		channel,
	]);
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
    INSERT INTO memory_facts (id, project_id, scope, key, value, confidence, source, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (project_id, scope, key) DO UPDATE
      SET value = EXCLUDED.value,
          confidence = EXCLUDED.confidence,
          source = EXCLUDED.source,
          updated_at = EXCLUDED.updated_at
    `,
		[randomUUID(), projectId, scope, key, value, confidence, source, ts],
	);
	return { projectId, scope, key, value, confidence, source, updatedAt: ts };
}

export async function getMemoryFacts(projectId: string, scope?: string): Promise<MemoryFact[]> {
	let rows: any[];
	if (scope) {
		rows = await query<any>("SELECT * FROM memory_facts WHERE project_id = $1 AND scope = $2 ORDER BY scope, key", [
			projectId,
			scope,
		]);
	} else {
		rows = await query<any>("SELECT * FROM memory_facts WHERE project_id = $1 ORDER BY scope, key", [projectId]);
	}
	return rows.map(rowToMemoryFact);
}

export async function getMemoryFact(projectId: string, scope: string, key: string): Promise<MemoryFact | null> {
	const row = await queryOne<any>("SELECT * FROM memory_facts WHERE project_id = $1 AND scope = $2 AND key = $3", [
		projectId,
		scope,
		key,
	]);
	return row ? rowToMemoryFact(row) : null;
}

export async function deleteMemoryFact(projectId: string, scope: string, key: string): Promise<void> {
	await execute("DELETE FROM memory_facts WHERE project_id = $1 AND scope = $2 AND key = $3", [projectId, scope, key]);
}

// ---------------------------------------------------------------------------
// Model Routing Policies
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
