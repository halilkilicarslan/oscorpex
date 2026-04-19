// ---------------------------------------------------------------------------
// Oscorpex — CIStatusPanel tests (V6 M3)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CIStatusPanel from '../pages/studio/CIStatusPanel';
import type { CITracking } from '../lib/studio-api/ci.js';

// ---------------------------------------------------------------------------
// Mock studio-api/ci
// ---------------------------------------------------------------------------

const mockFetchCIStatus = vi.fn<() => Promise<CITracking[]>>();
const mockTrackPR = vi.fn<() => Promise<CITracking>>();

vi.mock('../lib/studio-api/ci.js', () => ({
	fetchCIStatus: (...args: unknown[]) => mockFetchCIStatus(...(args as [])),
	trackPR: (...args: unknown[]) => mockTrackPR(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTracking(overrides: Partial<CITracking> = {}): CITracking {
	return {
		id: 'track-1',
		projectId: 'proj-1',
		provider: 'github',
		prId: '42',
		prUrl: 'https://github.com/acme/repo/pull/42',
		status: 'pending',
		details: {},
		pipelineUrl: null,
		createdAt: new Date('2026-04-20T10:00:00Z').toISOString(),
		updatedAt: new Date('2026-04-20T10:05:00Z').toISOString(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CIStatusPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchCIStatus.mockResolvedValue([]);
	});

	it('shows loading state initially', () => {
		mockFetchCIStatus.mockReturnValue(new Promise(() => {})); // never resolves
		render(<CIStatusPanel projectId="proj-1" />);
		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('shows empty state when no trackings', async () => {
		mockFetchCIStatus.mockResolvedValue([]);
		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText(/No CI trackings yet/i)).toBeInTheDocument();
		});
	});

	it('renders tracking rows with PR number and status badge', async () => {
		mockFetchCIStatus.mockResolvedValue([
			makeTracking({ prId: '42', status: 'running' }),
			makeTracking({ id: 'track-2', prId: '99', status: 'success', provider: 'gitlab' }),
		]);

		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('#42')).toBeInTheDocument();
		});
		expect(screen.getByText('#99')).toBeInTheDocument();
		expect(screen.getByText('Running')).toBeInTheDocument();
		expect(screen.getByText('Success')).toBeInTheDocument();
	});

	it('shows correct status badge colors', async () => {
		mockFetchCIStatus.mockResolvedValue([
			makeTracking({ status: 'failure' }),
		]);

		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			const badge = screen.getByText('Failure');
			expect(badge.className).toMatch(/ef4444/);
		});
	});

	it('renders pending badge in yellow', async () => {
		mockFetchCIStatus.mockResolvedValue([
			makeTracking({ status: 'pending' }),
		]);

		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			const badge = screen.getByText('Pending');
			expect(badge.className).toMatch(/f59e0b/);
		});
	});

	it('renders provider icons for github and gitlab', async () => {
		mockFetchCIStatus.mockResolvedValue([
			makeTracking({ provider: 'github' }),
			makeTracking({ id: 'track-2', provider: 'gitlab', prId: '7' }),
		]);

		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
			expect(screen.getByLabelText('GitLab')).toBeInTheDocument();
		});
	});

	it('shows pipeline link when pipelineUrl is set', async () => {
		mockFetchCIStatus.mockResolvedValue([
			makeTracking({ pipelineUrl: 'https://ci.example.com/jobs/100' }),
		]);

		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			const link = screen.getByText('View pipeline');
			expect(link).toHaveAttribute('href', 'https://ci.example.com/jobs/100');
		});
	});

	it('shows dash when pipelineUrl is null', async () => {
		mockFetchCIStatus.mockResolvedValue([makeTracking({ pipelineUrl: null })]);

		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('—')).toBeInTheDocument();
		});
	});

	it('opens track PR modal on button click', async () => {
		const user = userEvent.setup();
		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

		await user.click(screen.getByText('+ Track PR'));

		await waitFor(() => {
			expect(screen.getByText('Track Pull Request')).toBeInTheDocument();
		});
	});

	it('shows error state on fetch failure', async () => {
		mockFetchCIStatus.mockRejectedValue(new Error('Network error'));

		render(<CIStatusPanel projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Network error')).toBeInTheDocument();
		});
	});
});
