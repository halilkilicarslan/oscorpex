// ---------------------------------------------------------------------------
// Oscorpex — TestCoverage component tests (V6 M2)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TestCoverage from '../pages/studio/TestCoverage';
import type { TestResult, TestSummary } from '../lib/studio-api';

// ---------------------------------------------------------------------------
// Mock studio-api
// ---------------------------------------------------------------------------

const mockFetchTestResults = vi.fn<() => Promise<TestResult[]>>();
const mockFetchTestSummary = vi.fn<() => Promise<TestSummary>>();
const mockTriggerTestRun = vi.fn<() => Promise<TestResult>>();

vi.mock('../lib/studio-api', () => ({
	fetchTestResults: (...args: unknown[]) => mockFetchTestResults(...(args as [])),
	fetchTestSummary: (...args: unknown[]) => mockFetchTestSummary(...(args as [])),
	triggerTestRun: (...args: unknown[]) => mockTriggerTestRun(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
	return {
		id: 'res-1',
		projectId: 'proj-1',
		taskId: null,
		framework: 'vitest',
		passed: 10,
		failed: 0,
		skipped: 1,
		total: 11,
		coverage: 87.5,
		durationMs: 1234,
		rawOutput: 'Tests  10 passed | 0 failed | 1 skipped',
		createdAt: new Date('2026-04-19T10:00:00Z').toISOString(),
		...overrides,
	};
}

function makeSummary(overrides: Partial<TestSummary> = {}): TestSummary {
	return {
		totalRuns: 5,
		avgPassRate: 0.95,
		latestStatus: 'passed',
		latestRunAt: new Date('2026-04-19T10:00:00Z').toISOString(),
		trend: [],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TestCoverage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchTestResults.mockResolvedValue([]);
		mockFetchTestSummary.mockResolvedValue(makeSummary({ totalRuns: 0, avgPassRate: 0, latestStatus: 'unknown', latestRunAt: null }));
	});

	it('renders test summary stats', async () => {
		mockFetchTestSummary.mockResolvedValue(makeSummary({
			totalRuns: 12,
			avgPassRate: 0.92,
			latestStatus: 'passed',
		}));

		render(<TestCoverage projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('12')).toBeInTheDocument();
		});
		expect(screen.getByText('92%')).toBeInTheDocument();
		expect(screen.getByText('passed')).toBeInTheDocument();
	});

	it('renders test result rows', async () => {
		mockFetchTestResults.mockResolvedValue([
			makeResult({ id: 'res-1', framework: 'vitest', passed: 10, failed: 0 }),
			makeResult({ id: 'res-2', framework: 'jest', passed: 3, failed: 2 }),
		]);

		render(<TestCoverage projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getAllByText('vitest').length).toBeGreaterThan(0);
		});
		expect(screen.getAllByText('jest').length).toBeGreaterThan(0);
	});

	it('shows empty state message when no results', async () => {
		mockFetchTestResults.mockResolvedValue([]);

		render(<TestCoverage projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('No test runs recorded yet.')).toBeInTheDocument();
		});
	});

	it('shows green Passed badge for all-passing result', async () => {
		mockFetchTestResults.mockResolvedValue([
			makeResult({ passed: 5, failed: 0, total: 5 }),
		]);

		render(<TestCoverage projectId="proj-1" />);

		await waitFor(() => {
			// Use getAllByText to handle header + badge, find the span badge
			const badges = screen.getAllByText('Passed');
			const badge = badges.find((el) => el.tagName.toLowerCase() === 'span');
			expect(badge).toBeDefined();
			expect(badge!.className).toMatch(/22c55e/);
		});
	});

	it('shows red Failed badge for result with failures', async () => {
		mockFetchTestResults.mockResolvedValue([
			makeResult({ passed: 3, failed: 2, total: 5 }),
		]);

		render(<TestCoverage projectId="proj-1" />);

		await waitFor(() => {
			// Use getAllByText to handle header + badge, find the span badge
			const badges = screen.getAllByText('Failed');
			const badge = badges.find((el) => el.tagName.toLowerCase() === 'span');
			expect(badge).toBeDefined();
			expect(badge!.className).toMatch(/ef4444/);
		});
	});

	it('shows Run Tests button when repoPath provided', async () => {
		render(<TestCoverage projectId="proj-1" repoPath="/some/repo" />);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Run Tests/i })).toBeInTheDocument();
		});
	});

	it('does not show Run Tests button without repoPath', async () => {
		render(<TestCoverage projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByRole('button', { name: /Run Tests/i })).not.toBeInTheDocument();
		});
	});

	it('triggers test run and refreshes data on button click', async () => {
		const newResult = makeResult({ id: 'res-new', passed: 7, failed: 0 });
		mockFetchTestResults.mockResolvedValue([newResult]);
		mockFetchTestSummary.mockResolvedValue(makeSummary({ totalRuns: 1 }));
		mockTriggerTestRun.mockResolvedValue(newResult);

		const user = userEvent.setup();
		render(<TestCoverage projectId="proj-1" repoPath="/some/repo" />);

		const btn = await screen.findByRole('button', { name: /Run Tests/i });
		await user.click(btn);

		await waitFor(() => {
			expect(mockTriggerTestRun).toHaveBeenCalledWith('proj-1', '/some/repo');
		});
	});

	it('shows "No tests" badge when total is 0', async () => {
		mockFetchTestResults.mockResolvedValue([
			makeResult({ passed: 0, failed: 0, skipped: 0, total: 0 }),
		]);

		render(<TestCoverage projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('No tests')).toBeInTheDocument();
		});
	});
});
