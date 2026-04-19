// ---------------------------------------------------------------------------
// Oscorpex — TestCoverage page (V6 M2)
// Displays automated test run history and summary for a project.
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { fetchTestResults, fetchTestSummary, triggerTestRun } from '../../lib/studio-api';
import type { TestResult, TestSummary } from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null): string {
	if (ms == null) return '—';
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleString();
}

function passRate(result: TestResult): string {
	if (result.total === 0) return '—';
	return `${Math.round((result.passed / result.total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ result }: { result: TestResult }) {
	if (result.total === 0) {
		return (
			<span className="px-2 py-0.5 rounded text-xs font-medium bg-[#1f1f1f] text-gray-400 border border-[#262626]">
				No tests
			</span>
		);
	}
	if (result.failed === 0) {
		return (
			<span className="px-2 py-0.5 rounded text-xs font-medium bg-[#14532d] text-[#22c55e] border border-[#16a34a]">
				Passed
			</span>
		);
	}
	return (
		<span className="px-2 py-0.5 rounded text-xs font-medium bg-[#450a0a] text-[#ef4444] border border-[#b91c1c]">
			Failed
		</span>
	);
}

function SummaryCard({ summary, loading }: { summary: TestSummary | null; loading: boolean }) {
	if (loading) {
		return (
			<div className="bg-[#111111] border border-[#262626] rounded-lg p-6 animate-pulse">
				<div className="h-4 bg-[#262626] rounded w-1/3 mb-4" />
				<div className="grid grid-cols-3 gap-4">
					{[0, 1, 2].map((i) => (
						<div key={i} className="h-12 bg-[#262626] rounded" />
					))}
				</div>
			</div>
		);
	}

	if (!summary) return null;

	const avgPct = Math.round(summary.avgPassRate * 100);
	const statusColor =
		summary.latestStatus === 'passed'
			? 'text-[#22c55e]'
			: summary.latestStatus === 'failed'
				? 'text-[#ef4444]'
				: 'text-gray-400';

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-lg p-6">
			<h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
				Test Summary
			</h2>
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
				<div>
					<p className="text-xs text-gray-500 mb-1">Total Runs</p>
					<p className="text-2xl font-bold text-white">{summary.totalRuns}</p>
				</div>
				<div>
					<p className="text-xs text-gray-500 mb-1">Avg Pass Rate</p>
					<p className="text-2xl font-bold text-[#22c55e]">{avgPct}%</p>
				</div>
				<div>
					<p className="text-xs text-gray-500 mb-1">Latest Status</p>
					<p className={`text-2xl font-bold capitalize ${statusColor}`}>
						{summary.latestStatus}
					</p>
				</div>
				<div>
					<p className="text-xs text-gray-500 mb-1">Last Run</p>
					<p className="text-sm text-gray-300">
						{summary.latestRunAt ? formatDate(summary.latestRunAt) : '—'}
					</p>
				</div>
			</div>
		</div>
	);
}

function ResultsTable({ results, loading }: { results: TestResult[]; loading: boolean }) {
	if (loading) {
		return (
			<div className="bg-[#111111] border border-[#262626] rounded-lg p-6 animate-pulse">
				{[0, 1, 2].map((i) => (
					<div key={i} className="h-10 bg-[#262626] rounded mb-2" />
				))}
			</div>
		);
	}

	if (results.length === 0) {
		return (
			<div className="bg-[#111111] border border-[#262626] rounded-lg p-10 text-center">
				<p className="text-gray-500 text-sm">No test runs recorded yet.</p>
				<p className="text-gray-600 text-xs mt-1">
					Trigger a test run to see results here.
				</p>
			</div>
		);
	}

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-lg overflow-hidden">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-[#262626] text-gray-400 text-xs uppercase tracking-wider">
							<th className="text-left px-4 py-3">Date</th>
							<th className="text-left px-4 py-3">Framework</th>
							<th className="text-left px-4 py-3">Status</th>
							<th className="text-right px-4 py-3 text-[#22c55e]">Passed</th>
							<th className="text-right px-4 py-3 text-[#ef4444]">Failed</th>
							<th className="text-right px-4 py-3 text-yellow-500">Skipped</th>
							<th className="text-right px-4 py-3">Total</th>
							<th className="text-right px-4 py-3">Pass Rate</th>
							<th className="text-right px-4 py-3">Coverage</th>
							<th className="text-right px-4 py-3">Duration</th>
						</tr>
					</thead>
					<tbody>
						{results.map((r, idx) => (
							<tr
								key={r.id}
								className={`border-b border-[#1a1a1a] hover:bg-[#161616] transition-colors ${
									idx % 2 === 0 ? '' : 'bg-[#0d0d0d]'
								}`}
							>
								<td className="px-4 py-3 text-gray-300 whitespace-nowrap">
									{formatDate(r.createdAt)}
								</td>
								<td className="px-4 py-3">
									<span className="text-xs font-mono text-gray-400 bg-[#1a1a1a] px-2 py-0.5 rounded">
										{r.framework}
									</span>
								</td>
								<td className="px-4 py-3">
									<StatusBadge result={r} />
								</td>
								<td className="px-4 py-3 text-right text-[#22c55e] font-medium">{r.passed}</td>
								<td className="px-4 py-3 text-right text-[#ef4444] font-medium">{r.failed}</td>
								<td className="px-4 py-3 text-right text-yellow-500 font-medium">{r.skipped}</td>
								<td className="px-4 py-3 text-right text-gray-300">{r.total}</td>
								<td className="px-4 py-3 text-right text-gray-300">{passRate(r)}</td>
								<td className="px-4 py-3 text-right text-gray-400">
									{r.coverage != null ? `${r.coverage.toFixed(1)}%` : '—'}
								</td>
								<td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">
									{formatDuration(r.durationMs)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// TestCoverage page
// ---------------------------------------------------------------------------

interface Props {
	projectId: string;
	repoPath?: string;
}

export default function TestCoverage({ projectId, repoPath }: Props) {
	const [results, setResults] = useState<TestResult[]>([]);
	const [summary, setSummary] = useState<TestSummary | null>(null);
	const [loadingResults, setLoadingResults] = useState(true);
	const [loadingSummary, setLoadingSummary] = useState(true);
	const [running, setRunning] = useState(false);
	const [runError, setRunError] = useState<string | null>(null);

	const loadData = useCallback(async () => {
		setLoadingResults(true);
		setLoadingSummary(true);
		try {
			const [res, sum] = await Promise.all([
				fetchTestResults(projectId),
				fetchTestSummary(projectId),
			]);
			setResults(res);
			setSummary(sum);
		} catch (err) {
			console.error('[TestCoverage] loadData failed:', err);
		} finally {
			setLoadingResults(false);
			setLoadingSummary(false);
		}
	}, [projectId]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const handleRunTests = async () => {
		if (!repoPath) return;
		setRunning(true);
		setRunError(null);
		try {
			await triggerTestRun(projectId, repoPath);
			await loadData();
		} catch (err) {
			setRunError(err instanceof Error ? err.message : 'Failed to run tests');
		} finally {
			setRunning(false);
		}
	};

	return (
		<div className="min-h-screen bg-[#0a0a0a] text-white p-6 space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-bold text-white">Test Coverage</h1>
					<p className="text-sm text-gray-500 mt-0.5">Automated test run history and statistics</p>
				</div>
				{repoPath && (
					<button
						type="button"
						onClick={handleRunTests}
						disabled={running}
						className="px-4 py-2 rounded-md text-sm font-medium bg-[#22c55e] text-black hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						{running ? 'Running...' : 'Run Tests'}
					</button>
				)}
			</div>

			{/* Run error */}
			{runError && (
				<div className="bg-[#450a0a] border border-[#b91c1c] rounded-lg px-4 py-3 text-[#ef4444] text-sm">
					{runError}
				</div>
			)}

			{/* Summary */}
			<SummaryCard summary={summary} loading={loadingSummary} />

			{/* Results table */}
			<div>
				<h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
					Run History
				</h2>
				<ResultsTable results={results} loading={loadingResults} />
			</div>
		</div>
	);
}
