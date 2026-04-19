// ---------------------------------------------------------------------------
// Oscorpex — Search Log Repo (v4.1)
// Per-query search tracking for RAG Observability dashboard.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import { now } from "./helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextSearchLog {
	id: string;
	projectId: string;
	queryText: string;
	resultCount: number;
	topRank: number | null;
	latencyMs: number;
	sourceFilter: string | null;
	contentType: string | null;
	createdAt: string;
}

export interface SearchObservability {
	totalSearches: number;
	totalHits: number;
	totalMisses: number;
	hitRate: number;
	avgLatencyMs: number;
	avgResultCount: number;
	avgTopRank: number;
	recentSearches: ContextSearchLog[];
	hourlyBreakdown: Array<{ hour: string; searches: number; hits: number; avgLatency: number }>;
}

// ---------------------------------------------------------------------------
// Row Mapper
// ---------------------------------------------------------------------------

function rowToSearchLog(row: any): ContextSearchLog {
	return {
		id: row.id,
		projectId: row.project_id,
		queryText: row.query_text,
		resultCount: Number(row.result_count),
		topRank: row.top_rank != null ? Number(row.top_rank) : null,
		latencyMs: Number(row.latency_ms),
		sourceFilter: row.source_filter,
		contentType: row.content_type,
		createdAt: row.created_at,
	};
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export async function insertSearchLog(
	projectId: string,
	queryText: string,
	resultCount: number,
	topRank: number | null,
	latencyMs: number,
	sourceFilter?: string,
	contentType?: string,
): Promise<void> {
	await execute(
		`INSERT INTO context_search_log (id, project_id, query_text, result_count, top_rank, latency_ms, source_filter, content_type, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[
			randomUUID(),
			projectId,
			queryText,
			resultCount,
			topRank,
			latencyMs,
			sourceFilter ?? null,
			contentType ?? null,
			now(),
		],
	);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getSearchObservability(projectId: string, days = 7): Promise<SearchObservability> {
	const since = new Date();
	since.setDate(since.getDate() - days);
	const sinceStr = since.toISOString();

	const statsRow = await queryOne<any>(
		`SELECT COUNT(*) AS total,
		        SUM(CASE WHEN result_count > 0 THEN 1 ELSE 0 END) AS hits,
		        SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS misses,
		        AVG(latency_ms) AS avg_latency,
		        AVG(result_count) AS avg_results,
		        AVG(top_rank) FILTER (WHERE top_rank IS NOT NULL) AS avg_rank
		 FROM context_search_log
		 WHERE project_id = $1 AND created_at >= $2`,
		[projectId, sinceStr],
	);

	const totalSearches = Number(statsRow?.total ?? 0);
	const totalHits = Number(statsRow?.hits ?? 0);
	const totalMisses = Number(statsRow?.misses ?? 0);

	const recentRows = await query<any>(
		`SELECT * FROM context_search_log
		 WHERE project_id = $1 AND created_at >= $2
		 ORDER BY created_at DESC LIMIT 20`,
		[projectId, sinceStr],
	);

	const hourlyRows = await query<any>(
		`SELECT SUBSTRING(created_at, 1, 13) AS hour,
		        COUNT(*) AS searches,
		        SUM(CASE WHEN result_count > 0 THEN 1 ELSE 0 END) AS hits,
		        AVG(latency_ms) AS avg_latency
		 FROM context_search_log
		 WHERE project_id = $1 AND created_at >= $2
		 GROUP BY hour ORDER BY hour`,
		[projectId, sinceStr],
	);

	return {
		totalSearches,
		totalHits,
		totalMisses,
		hitRate: totalSearches > 0 ? totalHits / totalSearches : 0,
		avgLatencyMs: Math.round(Number(statsRow?.avg_latency ?? 0)),
		avgResultCount: Math.round(Number(statsRow?.avg_results ?? 0) * 10) / 10,
		avgTopRank: Math.round(Number(statsRow?.avg_rank ?? 0) * 100) / 100,
		recentSearches: recentRows.map(rowToSearchLog),
		hourlyBreakdown: hourlyRows.map((r: any) => ({
			hour: r.hour,
			searches: Number(r.searches),
			hits: Number(r.hits),
			avgLatency: Math.round(Number(r.avg_latency)),
		})),
	};
}
