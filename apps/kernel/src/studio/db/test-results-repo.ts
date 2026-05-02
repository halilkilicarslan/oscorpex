// ---------------------------------------------------------------------------
// Oscorpex — Test Results Repo (V6 M2)
// CRUD + aggregation for automated test run results.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne } from "../pg.js";
const log = createLogger("test-results-repo");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestResult {
	id: string;
	projectId: string;
	taskId: string | null;
	framework: string;
	passed: number;
	failed: number;
	skipped: number;
	total: number;
	coverage: number | null;
	durationMs: number | null;
	rawOutput: string | null;
	createdAt: string;
}

export interface TestSummary {
	totalRuns: number;
	avgPassRate: number;
	latestStatus: "passed" | "failed" | "unknown";
	latestRunAt: string | null;
	trend: Array<{ date: string; passRate: number; total: number }>;
}

export interface SaveTestResultData {
	projectId: string;
	taskId?: string | null;
	framework: string;
	passed: number;
	failed: number;
	skipped: number;
	total: number;
	coverage?: number | null;
	durationMs?: number | null;
	rawOutput?: string | null;
}

export interface GetTestResultsOpts {
	taskId?: string;
	limit?: number;
	offset?: number;
}

// ---------------------------------------------------------------------------
// Row → Model mapper
// ---------------------------------------------------------------------------

function rowToTestResult(row: Record<string, unknown>): TestResult {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		taskId: (row.task_id as string | null) ?? null,
		framework: row.framework as string,
		passed: Number(row.passed ?? 0),
		failed: Number(row.failed ?? 0),
		skipped: Number(row.skipped ?? 0),
		total: Number(row.total ?? 0),
		coverage: row.coverage != null ? Number(row.coverage) : null,
		durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
		rawOutput: (row.raw_output as string | null) ?? null,
		createdAt: row.created_at as string,
	};
}

// ---------------------------------------------------------------------------
// saveTestResult
// ---------------------------------------------------------------------------

export async function saveTestResult(data: SaveTestResultData): Promise<TestResult> {
	const id = randomUUID();
	const row = await queryOne<Record<string, unknown>>(
		`INSERT INTO test_results
		 (id, project_id, task_id, framework, passed, failed, skipped, total, coverage, duration_ms, raw_output)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING *`,
		[
			id,
			data.projectId,
			data.taskId ?? null,
			data.framework,
			data.passed,
			data.failed,
			data.skipped,
			data.total,
			data.coverage ?? null,
			data.durationMs ?? null,
			data.rawOutput ?? null,
		],
	);
	if (!row) throw new Error("test_results insert returned no row");
	return rowToTestResult(row);
}

// ---------------------------------------------------------------------------
// getTestResults
// ---------------------------------------------------------------------------

export async function getTestResults(projectId: string, opts: GetTestResultsOpts = {}): Promise<TestResult[]> {
	const { taskId, limit = 50, offset = 0 } = opts;
	const conditions: string[] = ["project_id = $1"];
	const params: unknown[] = [projectId];
	let idx = 2;

	if (taskId) {
		conditions.push(`task_id = $${idx++}`);
		params.push(taskId);
	}

	params.push(limit, offset);
	const rows = await query<Record<string, unknown>>(
		`SELECT * FROM test_results
		 WHERE ${conditions.join(" AND ")}
		 ORDER BY created_at DESC
		 LIMIT $${idx++} OFFSET $${idx}`,
		params,
	);
	return rows.map(rowToTestResult);
}

// ---------------------------------------------------------------------------
// getLatestResult
// ---------------------------------------------------------------------------

export async function getLatestTestResult(projectId: string): Promise<TestResult | null> {
	const row = await queryOne<Record<string, unknown>>(
		`SELECT * FROM test_results WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
		[projectId],
	);
	return row ? rowToTestResult(row) : null;
}

// ---------------------------------------------------------------------------
// getTestSummary
// ---------------------------------------------------------------------------

export async function getTestSummary(projectId: string): Promise<TestSummary> {
	// Total runs + avg pass rate
	const agg = await queryOne<Record<string, unknown>>(
		`SELECT
		   COUNT(*)::int                                                      AS total_runs,
		   COALESCE(AVG(CASE WHEN total > 0 THEN passed::float / total END), 0) AS avg_pass_rate
		 FROM test_results
		 WHERE project_id = $1`,
		[projectId],
	);

	const totalRuns = Number(agg?.total_runs ?? 0);
	const avgPassRate = Number(agg?.avg_pass_rate ?? 0);

	// Latest result for status
	const latest = await getLatestTestResult(projectId);
	let latestStatus: "passed" | "failed" | "unknown" = "unknown";
	if (latest) {
		latestStatus = latest.failed === 0 ? "passed" : "failed";
	}

	// Trend: last 14 days, daily aggregation
	const trendRows = await query<Record<string, unknown>>(
		`SELECT
		   DATE(created_at)::text                                                    AS date,
		   COALESCE(AVG(CASE WHEN total > 0 THEN passed::float / total END), 0)     AS pass_rate,
		   SUM(total)::int                                                           AS total
		 FROM test_results
		 WHERE project_id = $1
		   AND created_at >= now() - INTERVAL '14 days'
		 GROUP BY DATE(created_at)
		 ORDER BY DATE(created_at) ASC`,
		[projectId],
	);

	const trend = trendRows.map((r) => ({
		date: r.date as string,
		passRate: Number(r.pass_rate ?? 0),
		total: Number(r.total ?? 0),
	}));

	return {
		totalRuns,
		avgPassRate,
		latestStatus,
		latestRunAt: latest?.createdAt ?? null,
		trend,
	};
}

// ---------------------------------------------------------------------------
// deleteTestResult (utility for tests / cleanup)
// ---------------------------------------------------------------------------

export async function deleteTestResult(id: string): Promise<void> {
	await execute(`DELETE FROM test_results WHERE id = $1`, [id]);
}
