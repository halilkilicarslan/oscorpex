// ---------------------------------------------------------------------------
// Oscorpex — Context Repository: FTS Content Store (v4.0)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type {
	ContextChunk,
	ContextContentType,
	ContextMatchLayer,
	ContextSearchResult,
	ContextSource,
} from "../types.js";
import { now, rowToContextChunk, rowToContextSource } from "./helpers.js";
import { createLogger } from "../logger.js";
const log = createLogger("context-repo");

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function upsertContextSource(
	projectId: string,
	label: string,
	chunkCount: number,
	codeChunkCount: number,
): Promise<ContextSource> {
	const ts = now();
	const id = randomUUID();
	await execute(
		`
		INSERT INTO context_sources (id, project_id, label, chunk_count, code_chunk_count, indexed_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (project_id, label) DO UPDATE
			SET chunk_count = EXCLUDED.chunk_count,
				code_chunk_count = EXCLUDED.code_chunk_count,
				indexed_at = EXCLUDED.indexed_at
		`,
		[id, projectId, label, chunkCount, codeChunkCount, ts],
	);
	return { id, projectId, label, chunkCount, codeChunkCount, indexedAt: ts };
}

export async function getContextSource(projectId: string, label: string): Promise<ContextSource | null> {
	const row = await queryOne<any>("SELECT * FROM context_sources WHERE project_id = $1 AND label = $2", [
		projectId,
		label,
	]);
	return row ? rowToContextSource(row) : null;
}

export async function listContextSources(projectId: string): Promise<ContextSource[]> {
	const rows = await query<any>("SELECT * FROM context_sources WHERE project_id = $1 ORDER BY indexed_at DESC", [
		projectId,
	]);
	return rows.map(rowToContextSource);
}

export async function deleteContextSource(projectId: string, label: string): Promise<void> {
	await execute("DELETE FROM context_sources WHERE project_id = $1 AND label = $2", [projectId, label]);
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export async function insertChunks(
	sourceId: string,
	chunks: Array<{ title: string; content: string; contentType: ContextContentType }>,
): Promise<number> {
	if (chunks.length === 0) return 0;

	// Delete existing chunks for this source (re-index)
	await execute("DELETE FROM context_chunks WHERE source_id = $1", [sourceId]);

	// Batch insert (groups of 100 to avoid param limits)
	const batchSize = 100;
	let inserted = 0;
	for (let i = 0; i < chunks.length; i += batchSize) {
		const batch = chunks.slice(i, i + batchSize);
		const values: string[] = [];
		const params: unknown[] = [];
		let paramIdx = 1;

		for (const chunk of batch) {
			values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`);
			params.push(sourceId, chunk.title, chunk.content, chunk.contentType);
			paramIdx += 4;
		}

		await execute(
			`INSERT INTO context_chunks (source_id, title, content, content_type) VALUES ${values.join(", ")}`,
			params,
		);
		inserted += batch.length;
	}

	return inserted;
}

export async function getChunksBySource(sourceId: string): Promise<ContextChunk[]> {
	const rows = await query<any>("SELECT * FROM context_chunks WHERE source_id = $1 ORDER BY id", [sourceId]);
	return rows.map(rowToContextChunk);
}

// ---------------------------------------------------------------------------
// FTS Search — RRF (Reciprocal Rank Fusion) with tsvector + pg_trgm
// ---------------------------------------------------------------------------

export async function searchChunks(
	projectId: string,
	searchQuery: string,
	opts: {
		limit?: number;
		source?: string;
		contentType?: ContextContentType;
	} = {},
): Promise<ContextSearchResult[]> {
	const limit = opts.limit ?? 10;

	// Layer 1: tsvector full-text search
	const tsvectorResults = await searchTsvector(projectId, searchQuery, limit, opts);

	// Layer 2: pg_trgm trigram similarity
	const trigramResults = await searchTrigram(projectId, searchQuery, limit, opts);

	// RRF merge
	return rrfMerge(tsvectorResults, trigramResults, limit);
}

async function searchTsvector(
	projectId: string,
	searchQuery: string,
	limit: number,
	opts: { source?: string; contentType?: ContextContentType },
): Promise<ContextSearchResult[]> {
	const conditions = ["cs.project_id = $1", "cc.tsv @@ plainto_tsquery('english', $2)"];
	const params: unknown[] = [projectId, searchQuery];
	let paramIdx = 3;

	if (opts.source) {
		conditions.push(`cs.label = $${paramIdx}`);
		params.push(opts.source);
		paramIdx++;
	}
	if (opts.contentType) {
		conditions.push(`cc.content_type = $${paramIdx}`);
		params.push(opts.contentType);
		paramIdx++;
	}

	params.push(limit);

	const rows = await query<any>(
		`
		SELECT cc.title, cc.content, cs.label AS source, cc.content_type,
			ts_rank(cc.tsv, plainto_tsquery('english', $2)) AS rank
		FROM context_chunks cc
		JOIN context_sources cs ON cs.id = cc.source_id
		WHERE ${conditions.join(" AND ")}
		ORDER BY rank DESC
		LIMIT $${paramIdx}
		`,
		params,
	);

	return rows.map((r) => ({
		title: r.title,
		content: r.content,
		source: r.source,
		rank: Number(r.rank),
		contentType: r.content_type as ContextContentType,
		matchLayer: "tsvector" as ContextMatchLayer,
	}));
}

async function searchTrigram(
	projectId: string,
	searchQuery: string,
	limit: number,
	opts: { source?: string; contentType?: ContextContentType },
): Promise<ContextSearchResult[]> {
	try {
		const conditions = ["cs.project_id = $1", "similarity(cc.content, $2) > 0.05"];
		const params: unknown[] = [projectId, searchQuery];
		let paramIdx = 3;

		if (opts.source) {
			conditions.push(`cs.label = $${paramIdx}`);
			params.push(opts.source);
			paramIdx++;
		}
		if (opts.contentType) {
			conditions.push(`cc.content_type = $${paramIdx}`);
			params.push(opts.contentType);
			paramIdx++;
		}

		params.push(limit);

		const rows = await query<any>(
			`
			SELECT cc.title, cc.content, cs.label AS source, cc.content_type,
				similarity(cc.content, $2) AS rank
			FROM context_chunks cc
			JOIN context_sources cs ON cs.id = cc.source_id
			WHERE ${conditions.join(" AND ")}
			ORDER BY rank DESC
			LIMIT $${paramIdx}
			`,
			params,
		);

		return rows.map((r) => ({
			title: r.title,
			content: r.content,
			source: r.source,
			rank: Number(r.rank),
			contentType: r.content_type as ContextContentType,
			matchLayer: "trigram" as ContextMatchLayer,
		}));
	} catch {
		// pg_trgm not available — graceful fallback to empty results
		return [];
	}
}

function rrfMerge(
	tsvectorResults: ContextSearchResult[],
	trigramResults: ContextSearchResult[],
	limit: number,
): ContextSearchResult[] {
	const K = 60; // RRF constant
	const scoreMap = new Map<string, { score: number; result: ContextSearchResult }>();

	for (let i = 0; i < tsvectorResults.length; i++) {
		const r = tsvectorResults[i];
		const key = `${r.source}::${r.title}`;
		const score = 1 / (K + i + 1);
		scoreMap.set(key, { score, result: r });
	}

	for (let i = 0; i < trigramResults.length; i++) {
		const r = trigramResults[i];
		const key = `${r.source}::${r.title}`;
		const existing = scoreMap.get(key);
		const score = 1 / (K + i + 1);
		if (existing) {
			existing.score += score;
		} else {
			scoreMap.set(key, { score, result: { ...r, matchLayer: "trigram" } });
		}
	}

	return Array.from(scoreMap.values())
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((e) => ({ ...e.result, rank: e.score }));
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupStaleSources(projectId: string, maxAgeDays = 7): Promise<number> {
	const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
	const { rowCount } = await execute("DELETE FROM context_sources WHERE project_id = $1 AND indexed_at < $2", [
		projectId,
		cutoff,
	]);
	return rowCount;
}

// ---------------------------------------------------------------------------
// Context Events (v4.0 Faz 3 — Session Tracking)
// ---------------------------------------------------------------------------

export interface ContextEventRow {
	id: number;
	project_id: string;
	task_id: string | null;
	agent_id: string | null;
	session_key: string;
	type: string;
	category: string;
	priority: number;
	data: string;
	data_hash: string;
	created_at: string;
}

export interface TrackEventInput {
	projectId: string;
	taskId?: string;
	agentId?: string;
	sessionKey: string;
	type: string;
	category: string;
	priority?: number;
	data: string;
	dataHash: string;
}

export async function insertContextEvent(input: TrackEventInput): Promise<void> {
	const ts = now();
	await execute(
		`
		INSERT INTO context_events (project_id, task_id, agent_id, session_key, type, category, priority, data, data_hash, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		`,
		[
			input.projectId,
			input.taskId ?? null,
			input.agentId ?? null,
			input.sessionKey,
			input.type,
			input.category,
			input.priority ?? 2,
			input.data,
			input.dataHash,
			ts,
		],
	);
}

export async function getContextEvents(
	sessionKey: string,
	opts: { category?: string; limit?: number } = {},
): Promise<ContextEventRow[]> {
	const conditions = ["session_key = $1"];
	const params: unknown[] = [sessionKey];
	let paramIdx = 2;

	if (opts.category) {
		conditions.push(`category = $${paramIdx}`);
		params.push(opts.category);
		paramIdx++;
	}

	params.push(opts.limit ?? 100);

	const rows = await query<ContextEventRow>(
		`
		SELECT * FROM context_events
		WHERE ${conditions.join(" AND ")}
		ORDER BY created_at DESC
		LIMIT $${paramIdx}
		`,
		params,
	);
	return rows;
}

export async function isDuplicateEvent(
	sessionKey: string,
	type: string,
	dataHash: string,
	windowSize = 5,
): Promise<boolean> {
	const row = await queryOne<{ cnt: string }>(
		`
		SELECT COUNT(*) AS cnt FROM (
			SELECT data_hash FROM context_events
			WHERE session_key = $1 AND type = $2
			ORDER BY created_at DESC
			LIMIT $3
		) recent
		WHERE recent.data_hash = $4
		`,
		[sessionKey, type, windowSize, dataHash],
	);
	return Number(row?.cnt ?? 0) > 0;
}

export async function countSessionEvents(sessionKey: string): Promise<number> {
	const row = await queryOne<{ cnt: string }>("SELECT COUNT(*) AS cnt FROM context_events WHERE session_key = $1", [
		sessionKey,
	]);
	return Number(row?.cnt ?? 0);
}

export async function evictLowPriorityEvents(sessionKey: string, maxEvents: number): Promise<number> {
	const { rowCount } = await execute(
		`
		DELETE FROM context_events
		WHERE id IN (
			SELECT id FROM context_events
			WHERE session_key = $1
			ORDER BY priority DESC, created_at ASC
			LIMIT GREATEST(0, (SELECT COUNT(*) FROM context_events WHERE session_key = $1) - $2)
		)
		`,
		[sessionKey, maxEvents],
	);
	return rowCount;
}

export async function cleanupOldEvents(maxAgeDays = 30): Promise<number> {
	const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
	const { rowCount } = await execute("DELETE FROM context_events WHERE created_at < $1", [cutoff]);
	return rowCount;
}
