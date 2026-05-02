// ---------------------------------------------------------------------------
// Oscorpex — Context Analytics (v4.0 Faz 4)
// Tracks context savings metrics, search efficiency, and session continuity.
// ---------------------------------------------------------------------------

import { listContextSources } from "./db.js";
import { query, queryOne } from "./pg.js";
import { createLogger } from "./logger.js";
const log = createLogger("context-analytics");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextMetrics {
	// Savings
	totalSources: number;
	totalChunks: number;
	codeChunks: number;
	proseChunks: number;

	// Search efficiency (placeholder — wired when search tracking is added)
	searchCalls: number;
	searchHits: number;

	// Session continuity
	totalEvents: number;
	eventsByCategory: Record<string, number>;

	// Token estimation
	estimatedTokensIndexed: number;
}

export interface PerTaskContextMetrics {
	taskId: string;
	taskTitle: string;
	sourceLabel: string;
	chunkCount: number;
	codeChunkCount: number;
	indexedAt: string;
}

// ---------------------------------------------------------------------------
// Compute Metrics
// ---------------------------------------------------------------------------

const BYTES_PER_TOKEN = 4;

export async function getContextMetrics(projectId: string): Promise<ContextMetrics> {
	const sources = await listContextSources(projectId);

	const totalChunks = sources.reduce((sum, s) => sum + s.chunkCount, 0);
	const codeChunks = sources.reduce((sum, s) => sum + s.codeChunkCount, 0);

	// Content size estimation from chunks
	const sizeRow = await queryOne<{ total_bytes: string }>(
		`
		SELECT COALESCE(SUM(LENGTH(cc.content)), 0) AS total_bytes
		FROM context_chunks cc
		JOIN context_sources cs ON cs.id = cc.source_id
		WHERE cs.project_id = $1
		`,
		[projectId],
	);
	const totalBytes = Number(sizeRow?.total_bytes ?? 0);

	// Session events
	const eventRow = await queryOne<{ cnt: string }>("SELECT COUNT(*) AS cnt FROM context_events WHERE project_id = $1", [
		projectId,
	]);
	const totalEvents = Number(eventRow?.cnt ?? 0);

	// Events by category
	const categoryRows = await query<{ category: string; cnt: string }>(
		`
		SELECT category, COUNT(*) AS cnt
		FROM context_events
		WHERE project_id = $1
		GROUP BY category
		`,
		[projectId],
	);
	const eventsByCategory: Record<string, number> = {};
	for (const row of categoryRows) {
		eventsByCategory[row.category] = Number(row.cnt);
	}

	// Search tracking
	const searchRow = await queryOne<{ search_calls: string; search_hits: string }>(
		"SELECT search_calls, search_hits FROM context_search_stats WHERE project_id = $1",
		[projectId],
	);

	return {
		totalSources: sources.length,
		totalChunks,
		codeChunks,
		proseChunks: totalChunks - codeChunks,
		searchCalls: Number(searchRow?.search_calls ?? 0),
		searchHits: Number(searchRow?.search_hits ?? 0),
		totalEvents,
		eventsByCategory,
		estimatedTokensIndexed: Math.ceil(totalBytes / BYTES_PER_TOKEN),
	};
}

// ---------------------------------------------------------------------------
// Per-Task Breakdown
// ---------------------------------------------------------------------------

export async function getPerTaskContextMetrics(projectId: string): Promise<PerTaskContextMetrics[]> {
	const sources = await listContextSources(projectId);

	return sources
		.filter((s) => s.label.startsWith("task:"))
		.map((s) => {
			// label format: "task:{taskId}:{taskTitle}"
			const parts = s.label.split(":");
			const taskId = parts[1] ?? "";
			const taskTitle = parts.slice(2).join(":") ?? "";
			return {
				taskId,
				taskTitle,
				sourceLabel: s.label,
				chunkCount: s.chunkCount,
				codeChunkCount: s.codeChunkCount,
				indexedAt: s.indexedAt,
			};
		});
}
