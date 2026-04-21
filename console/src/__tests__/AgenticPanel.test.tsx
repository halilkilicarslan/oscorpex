import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgenticPanel from '../pages/studio/AgenticPanel';

// ---------------------------------------------------------------------------
// Mock studio-api
// ---------------------------------------------------------------------------

const mockMetrics = {
	taskClaimLatency: { avgMs: 150, p95Ms: 320, samples: 25 },
	duplicateDispatchPrevented: 3,
	verificationFailureRate: 12.5,
	strategySuccessRates: [
		{ strategy: 'scaffold_then_refine', taskType: 'feature', successRate: 80, samples: 10 },
	],
	avgRetriesBeforeCompletion: 1.2,
	reviewRejectionByRole: [
		{ agentRole: 'frontend_dev', rejections: 3, total: 10, rate: 30 },
	],
	injectedTaskVolume: { total: 8, humanApproved: 3, autoApproved: 2, pending: 2, rejected: 1 },
	graphMutationStats: { total: 4, byType: { insert_task: 3, add_edge: 1 } },
	replanTriggerFrequency: { total: 2, byTrigger: { phase_end: 2 }, byStatus: { applied: 2 } },
	degradedProviderDuration: [],
	failureClassification: { transientFailures: 3, terminalFailures: 1, retryExhausted: 1 },
};

const mockProposals = [
	{ id: 'p1', title: 'Add error handler', proposalType: 'add_task', riskLevel: 'low', originatingAgentId: 'agent-backend-123', status: 'pending', createdAt: '2026-04-20T10:00:00Z' },
	{ id: 'p2', title: 'Refactor auth', proposalType: 'modify_task', riskLevel: 'medium', originatingAgentId: 'agent-frontend-456', status: 'approved', createdAt: '2026-04-20T09:00:00Z' },
];

const mockGoals = [
	{ id: 'g1', status: 'active', definition: { goal: 'Complete auth module', constraints: ['no breaking changes'] }, createdAt: '2026-04-20T08:00:00Z' },
	{ id: 'g2', status: 'completed', definition: { goal: 'Setup CI pipeline', constraints: [] }, createdAt: '2026-04-20T07:00:00Z' },
];

const mockMutations = [
	{ id: 'm1', mutationType: 'insert_task', reason: 'Missing test coverage', payload: {}, createdAt: '2026-04-20T10:00:00Z' },
];

const mockGrants = [
	{ id: 'cg1', projectId: 'proj-1', agentRole: 'backend_dev', capability: 'can_commit_code', granted: true, grantedBy: 'system', createdAt: '2026-04-20T08:00:00Z' },
	{ id: 'cg2', projectId: 'proj-1', agentRole: 'pm', capability: 'can_propose_task', granted: false, grantedBy: 'admin', createdAt: '2026-04-20T08:00:00Z' },
];

const mockSessions = [
	{ id: 's1', agentId: 'agent-backend-12345', strategy: 'scaffold_then_refine', status: 'active', stepsCompleted: 5, createdAt: '2026-04-20T10:00:00Z' },
	{ id: 's2', agentId: 'agent-frontend-6789', strategy: 'test_first', status: 'completed', stepsCompleted: 8, createdAt: '2026-04-20T09:00:00Z' },
];

vi.mock('../lib/studio-api', () => ({
	fetchAgenticMetrics: vi.fn(),
	fetchProposals: vi.fn(),
	fetchGoals: vi.fn(),
	fetchGraphMutations: vi.fn(),
	fetchCapabilityGrants: vi.fn(),
	fetchAgentSessions: vi.fn(),
	upsertCapabilityGrant: vi.fn(),
	approveProposal: vi.fn(),
	rejectProposal: vi.fn(),
}));

import {
	fetchAgenticMetrics,
	fetchProposals,
	fetchGoals,
	fetchGraphMutations,
	fetchCapabilityGrants,
	fetchAgentSessions,
	upsertCapabilityGrant,
	approveProposal,
	rejectProposal,
} from '../lib/studio-api';

const PROJECT_ID = 'proj-test-123';

function setupMocks(overrides?: Record<string, unknown>) {
	(fetchAgenticMetrics as ReturnType<typeof vi.fn>).mockResolvedValue(overrides?.metrics ?? mockMetrics);
	(fetchProposals as ReturnType<typeof vi.fn>).mockResolvedValue(overrides?.proposals ?? mockProposals);
	(fetchGoals as ReturnType<typeof vi.fn>).mockResolvedValue(overrides?.goals ?? mockGoals);
	(fetchGraphMutations as ReturnType<typeof vi.fn>).mockResolvedValue(overrides?.mutations ?? mockMutations);
	(fetchCapabilityGrants as ReturnType<typeof vi.fn>).mockResolvedValue(overrides?.grants ?? mockGrants);
	(fetchAgentSessions as ReturnType<typeof vi.fn>).mockResolvedValue(overrides?.sessions ?? mockSessions);
	(upsertCapabilityGrant as ReturnType<typeof vi.fn>).mockResolvedValue({});
	(approveProposal as ReturnType<typeof vi.fn>).mockResolvedValue({});
	(rejectProposal as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

describe('AgenticPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// -----------------------------------------------------------------------
	// Loading & data fetching
	// -----------------------------------------------------------------------

	it('shows loading spinner initially', () => {
		setupMocks();
		// Never resolve to keep loading state
		(fetchAgenticMetrics as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
		render(<AgenticPanel projectId={PROJECT_ID} />);
		// spinner is a RefreshCw icon with animate-spin class
		const spinner = document.querySelector('.animate-spin');
		expect(spinner).toBeTruthy();
	});

	it('fetches all data on mount', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(fetchAgenticMetrics).toHaveBeenCalledWith(PROJECT_ID);
			expect(fetchProposals).toHaveBeenCalledWith(PROJECT_ID);
			expect(fetchGoals).toHaveBeenCalledWith(PROJECT_ID);
			expect(fetchGraphMutations).toHaveBeenCalledWith(PROJECT_ID);
			expect(fetchCapabilityGrants).toHaveBeenCalledWith(PROJECT_ID);
			expect(fetchAgentSessions).toHaveBeenCalledWith(PROJECT_ID);
		});
	});

	// -----------------------------------------------------------------------
	// Metrics section
	// -----------------------------------------------------------------------

	it('renders metric stat cards', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('150ms')).toBeTruthy();
			expect(screen.getByText('12.5%')).toBeTruthy();
			expect(screen.getByText('1.2')).toBeTruthy();
			expect(screen.getByText('3')).toBeTruthy();
		});
	});

	it('renders strategy success rate bar', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('scaffold_then_refine')).toBeTruthy();
			expect(screen.getByText('80%')).toBeTruthy();
		});
	});

	it('renders injected task volume cards', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('Task Proposals')).toBeTruthy();
			expect(screen.getByText('Auto-Approved')).toBeTruthy();
		});
	});

	it('renders review rejection by role', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('frontend_dev')).toBeTruthy();
			expect(screen.getByText('3/10')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Proposals section
	// -----------------------------------------------------------------------

	it('renders proposals with status badges', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('Add error handler')).toBeTruthy();
			expect(screen.getByText('Refactor auth')).toBeTruthy();
			expect(screen.getByText('pending')).toBeTruthy();
			expect(screen.getByText('approved')).toBeTruthy();
		});
	});

	it('shows approve/reject buttons for pending proposals', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByTitle('Approve')).toBeTruthy();
			expect(screen.getByTitle('Reject')).toBeTruthy();
		});
	});

	it('calls approveProposal on approve click', async () => {
		setupMocks();
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByTitle('Approve'));
		await user.click(screen.getByTitle('Approve'));
		expect(approveProposal).toHaveBeenCalledWith('p1');
	});

	it('calls rejectProposal on reject click', async () => {
		setupMocks();
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByTitle('Reject'));
		await user.click(screen.getByTitle('Reject'));
		expect(rejectProposal).toHaveBeenCalledWith('p1', 'Rejected by user');
	});

	it('shows empty state when no proposals', async () => {
		setupMocks({ proposals: [] });
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('No proposals yet')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Goals section
	// -----------------------------------------------------------------------

	it('renders active and completed goals', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('Complete auth module')).toBeTruthy();
			expect(screen.getByText('Setup CI pipeline')).toBeTruthy();
		});
	});

	it('renders goal constraints as tags', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('no breaking changes')).toBeTruthy();
		});
	});

	it('shows empty state when no goals', async () => {
		setupMocks({ goals: [] });
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('No goals defined')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Graph Mutations section (defaultOpen=false, need to expand)
	// -----------------------------------------------------------------------

	it('renders graph mutations after expanding section', async () => {
		setupMocks();
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Agentic Platform'));

		const sectionButtons = screen.getAllByRole('button');
		const graphBtn = sectionButtons.find((btn) => btn.querySelector('.font-semibold')?.textContent?.includes('Graph Mutations'));
		expect(graphBtn).toBeTruthy();
		await user.click(graphBtn!);

		await waitFor(() => {
			expect(screen.getByText('insert_task')).toBeTruthy();
			expect(screen.getByText('Missing test coverage')).toBeTruthy();
		});
	});

	it('shows empty state for graph mutations', async () => {
		setupMocks({ mutations: [] });
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Agentic Platform'));

		const sectionButtons = screen.getAllByRole('button');
		const graphBtn = sectionButtons.find((btn) => btn.querySelector('.font-semibold')?.textContent?.includes('Graph Mutations'));
		expect(graphBtn).toBeTruthy();
		await user.click(graphBtn!);

		await waitFor(() => {
			expect(screen.getByText('No graph mutations recorded')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Agent Sessions section (defaultOpen=false)
	// -----------------------------------------------------------------------

	it('renders agent sessions after expanding', async () => {
		setupMocks();
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Agentic Platform'));

		const sectionButtons = screen.getAllByRole('button');
		const sessionsBtn = sectionButtons.find((btn) => btn.querySelector('.font-semibold')?.textContent?.includes('Agent Sessions'));
		expect(sessionsBtn).toBeTruthy();
		await user.click(sessionsBtn!);

		await waitFor(() => {
			expect(screen.getByText('5 steps')).toBeTruthy();
			expect(screen.getByText('8 steps')).toBeTruthy();
		});
	});

	it('shows empty state for sessions', async () => {
		setupMocks({ sessions: [] });
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Agentic Platform'));

		const sectionButtons = screen.getAllByRole('button');
		const sessionsBtn = sectionButtons.find((btn) => btn.querySelector('.font-semibold')?.textContent?.includes('Agent Sessions'));
		expect(sessionsBtn).toBeTruthy();
		await user.click(sessionsBtn!);

		await waitFor(() => {
			expect(screen.getByText('No agent sessions recorded')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Capability Grants section (defaultOpen=false)
	// -----------------------------------------------------------------------

	it('renders capability grants with toggle buttons', async () => {
		setupMocks();
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Agentic Platform'));

		const sectionButtons = screen.getAllByRole('button');
		const grantsBtn = sectionButtons.find((btn) => btn.querySelector('.font-semibold')?.textContent?.includes('Capability Grants'));
		expect(grantsBtn).toBeTruthy();
		await user.click(grantsBtn!);

		await waitFor(() => {
			expect(screen.getByText('backend_dev')).toBeTruthy();
			expect(screen.getByText('can_commit_code')).toBeTruthy();
			expect(screen.getByText('Granted')).toBeTruthy();
			expect(screen.getByText('Denied')).toBeTruthy();
		});
	});

	it('calls upsertCapabilityGrant on toggle click', async () => {
		setupMocks();
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Agentic Platform'));

		const sectionButtons = screen.getAllByRole('button');
		const grantsBtn = sectionButtons.find((btn) => btn.querySelector('.font-semibold')?.textContent?.includes('Capability Grants'));
		expect(grantsBtn).toBeTruthy();
		await user.click(grantsBtn!);

		await waitFor(() => screen.getByText('Granted'));
		await user.click(screen.getByText('Granted'));

		expect(upsertCapabilityGrant).toHaveBeenCalledWith(PROJECT_ID, 'backend_dev', 'can_commit_code', false);
	});

	it('shows default message when no grants', async () => {
		setupMocks({ grants: [] });
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Agentic Platform'));

		const sectionButtons = screen.getAllByRole('button');
		const grantsBtn = sectionButtons.find((btn) => btn.querySelector('.font-semibold')?.textContent?.includes('Capability Grants'));
		expect(grantsBtn).toBeTruthy();
		await user.click(grantsBtn!);

		await waitFor(() => {
			expect(screen.getByText('No custom capability grants — using role defaults')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Refresh button
	// -----------------------------------------------------------------------

	it('calls all fetch functions again on refresh click', async () => {
		setupMocks();
		const user = userEvent.setup();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => screen.getByText('Refresh'));

		vi.clearAllMocks();
		setupMocks();

		await user.click(screen.getByText('Refresh'));

		await waitFor(() => {
			expect(fetchAgenticMetrics).toHaveBeenCalledTimes(1);
			expect(fetchProposals).toHaveBeenCalledTimes(1);
		});
	});

	// -----------------------------------------------------------------------
	// Error resilience
	// -----------------------------------------------------------------------

	it('handles API errors gracefully', async () => {
		setupMocks();
		(fetchAgenticMetrics as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
		render(<AgenticPanel projectId={PROJECT_ID} />);
		// Should not crash — metrics section just won't render
		await waitFor(() => {
			expect(screen.getByText('Agentic Platform')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Header
	// -----------------------------------------------------------------------

	it('renders panel header', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText('Agentic Platform')).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Pending count in section titles
	// -----------------------------------------------------------------------

	it('shows pending count in proposal section title', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText(/Task Proposals.*1 pending/)).toBeTruthy();
		});
	});

	it('shows active count in goals section title', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText(/Execution Goals.*1 active/)).toBeTruthy();
		});
	});

	it('shows active count in sessions section title', async () => {
		setupMocks();
		render(<AgenticPanel projectId={PROJECT_ID} />);
		await waitFor(() => {
			expect(screen.getByText(/Agent Sessions.*1 active/)).toBeTruthy();
		});
	});
});
