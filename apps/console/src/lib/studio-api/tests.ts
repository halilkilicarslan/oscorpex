// ---------------------------------------------------------------------------
// Oscorpex — Tests API Client (V6 M2)
// ---------------------------------------------------------------------------

import { API, json } from './base.js';

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

export interface TestSummaryTrendEntry {
	date: string;
	passRate: number;
	total: number;
}

export interface TestSummary {
	totalRuns: number;
	avgPassRate: number;
	latestStatus: 'passed' | 'failed' | 'unknown';
	latestRunAt: string | null;
	trend: TestSummaryTrendEntry[];
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function triggerTestRun(
	projectId: string,
	repoPath: string,
	taskId?: string,
): Promise<TestResult> {
	return json<TestResult>(`${API}/tests/run/${projectId}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ repoPath, taskId }),
	});
}

export async function fetchTestResults(projectId: string, opts?: {
	taskId?: string;
	limit?: number;
	offset?: number;
}): Promise<TestResult[]> {
	const params = new URLSearchParams();
	if (opts?.taskId) params.set('taskId', opts.taskId);
	if (opts?.limit != null) params.set('limit', String(opts.limit));
	if (opts?.offset != null) params.set('offset', String(opts.offset));
	const qs = params.toString() ? `?${params.toString()}` : '';
	return json<TestResult[]>(`${API}/tests/results/${projectId}${qs}`);
}

export async function fetchTestSummary(projectId: string): Promise<TestSummary> {
	return json<TestSummary>(`${API}/tests/summary/${projectId}`);
}
