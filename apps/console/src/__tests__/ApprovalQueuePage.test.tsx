import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ApprovalQueuePage from '../pages/studio/ApprovalQueuePage';
import { StudioApiError } from '../lib/studio-api/base';

vi.mock('../lib/studio-api/approvals', () => ({
	getPendingApprovals: vi.fn(),
	getApprovalState: vi.fn(),
	getReleaseState: vi.fn(),
	getBlockingGates: vi.fn(),
	getApprovalArtifactCompleteness: vi.fn(),
	approveApproval: vi.fn(),
	rejectApproval: vi.fn(),
}));
vi.mock('../lib/studio-api/artifacts', () => ({
	getArtifacts: vi.fn(),
	registerArtifact: vi.fn(),
	verifyArtifact: vi.fn(),
	rejectArtifact: vi.fn(),
	supersedeArtifact: vi.fn(),
}));

import * as approvalsApi from '../lib/studio-api/approvals';
import * as artifactApi from '../lib/studio-api/artifacts';

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/studio/approvals?goalId=goal-1']}>
			<Routes>
				<Route path="/studio/approvals" element={<ApprovalQueuePage />} />
			</Routes>
		</MemoryRouter>,
	);
}

const pendingItem = {
	id: 'ap-1',
	goalId: 'goal-1',
	approvalClass: 'human_review',
	requiredQuorum: 2,
	requestedBy: 'pm-agent',
	reason: 'prod deploy',
	createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
	state: 'pending',
	metadata: { environment: 'production', missingApprovals: 1 },
} as const;

const approvalState = {
	goalId: 'goal-1',
	satisfied: false,
	blocked: false,
	missingApprovals: 1,
	pending: [{ request: { id: 'ap-1' }, missingApprovals: 1, approvedActorIds: [], rejectedActorIds: [] }],
	expired: [],
	rejected: [],
	states: [{ request: { id: 'ap-1', expiresAt: null }, approvedActorIds: ['alice'], rejectedActorIds: [] }],
};

const releaseState = {
	allowed: false,
	blocked: true,
	requiresOverride: false,
	rollbackRequired: false,
	blockingReasons: [{ code: 'approval_missing', source: 'approval', detail: 'missing approval' }],
	latestDecision: null,
	rollbackTriggers: [],
};

const artifactState = {
	satisfied: false,
	missingArtifacts: ['rollback_plan'],
	staleArtifacts: [],
	rejectedArtifacts: [],
	latestArtifacts: [],
	requiredArtifacts: ['rollback_plan'],
	environment: 'production',
};

describe('ApprovalQueuePage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(approvalsApi.getPendingApprovals).mockResolvedValue([pendingItem] as any);
		vi.mocked(approvalsApi.getApprovalState).mockResolvedValue(approvalState as any);
		vi.mocked(approvalsApi.getReleaseState).mockResolvedValue(releaseState as any);
		vi.mocked(approvalsApi.getBlockingGates).mockResolvedValue([]);
		vi.mocked(approvalsApi.getApprovalArtifactCompleteness).mockResolvedValue(artifactState as any);
		vi.mocked(approvalsApi.approveApproval).mockResolvedValue({ state: 'approved', request: { id: 'ap-1' } } as any);
		vi.mocked(approvalsApi.rejectApproval).mockResolvedValue({ state: 'rejected', request: { id: 'ap-1' } } as any);
		vi.mocked(artifactApi.getArtifacts).mockResolvedValue([
			{ id: 'art-1', goalId: 'goal-1', artifactType: 'rollback_plan', title: 'Rollback Plan', environment: 'production', status: 'rejected' },
		] as any);
		vi.mocked(artifactApi.registerArtifact).mockResolvedValue({ id: 'art-2' } as any);
		vi.mocked(artifactApi.verifyArtifact).mockResolvedValue({ id: 'art-1' } as any);
		vi.mocked(artifactApi.rejectArtifact).mockResolvedValue({ id: 'art-1' } as any);
		vi.mocked(artifactApi.supersedeArtifact).mockResolvedValue({ artifactId: 'art-1', superseded: true });
	});

	it('queue renders loading state', () => {
		vi.mocked(approvalsApi.getPendingApprovals).mockReturnValue(new Promise(() => {}) as any);
		renderPage();
		expect(screen.getByTestId('approval-queue-loading')).toBeInTheDocument();
	});

	it('queue renders pending approvals', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByTestId('approval-queue-table')).toBeInTheDocument());
		expect(screen.getByText('human_review')).toBeInTheDocument();
		expect(screen.getByText('pm-agent')).toBeInTheDocument();
	});

	it('detail drawer opens correctly', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Review'));
		await waitFor(() => expect(screen.getByText('Approval Detail')).toBeInTheDocument());
		expect(screen.getByRole('heading', { name: /Release Impact/i })).toBeInTheDocument();
	});

	it('approve flow requires confirmation', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Review'));
		const approveBtn = await screen.findByText('Confirm Approve');
		expect(approveBtn).toBeDisabled();
		fireEvent.click(screen.getByLabelText(/Release impact bilgisini okudum/i));
		expect(approveBtn).not.toBeDisabled();
		fireEvent.click(approveBtn);
		await waitFor(() => expect(approvalsApi.approveApproval).toHaveBeenCalled());
	});

	it('reject flow requires reason', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Review'));
		const rejectBtn = await screen.findByText('Confirm Reject');
		fireEvent.click(screen.getByLabelText(/Reject kararının release'i bloklayabileceğini anladım/i));
		expect(rejectBtn).toBeDisabled();
		fireEvent.change(screen.getByLabelText(/Rejection reason \(required\)/i), { target: { value: 'missing approval evidence' } });
		expect(rejectBtn).not.toBeDisabled();
		fireEvent.click(rejectBtn);
		await waitFor(() => expect(approvalsApi.rejectApproval).toHaveBeenCalled());
	});

	it('expired approval shows disabled state', async () => {
		vi.mocked(approvalsApi.getPendingApprovals).mockResolvedValue([{ ...pendingItem, state: 'expired' }] as any);
		renderPage();
		await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Review'));
		await waitFor(() => expect(screen.getByTestId('approval-non-actionable')).toBeInTheDocument());
		expect(screen.getByText('Confirm Approve')).toBeDisabled();
	});

	it('permission denied handled', async () => {
		vi.mocked(approvalsApi.getPendingApprovals).mockRejectedValue(new StudioApiError('Forbidden', 403, { error: 'forbidden' }));
		renderPage();
		await waitFor(() => expect(screen.getByTestId('approval-queue-error-403')).toBeInTheDocument());
	});

	it('mutation success refreshes state', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Review'));
		fireEvent.click(await screen.findByLabelText(/Release impact bilgisini okudum/i));
		fireEvent.click(screen.getByText('Confirm Approve'));
		await waitFor(() => expect(approvalsApi.getPendingApprovals).toHaveBeenCalledTimes(3));
	});

	it('approval detail opens artifact drawer and verify action calls api', async () => {
		vi.mocked(approvalsApi.getApprovalArtifactCompleteness).mockResolvedValue({
			...artifactState,
			rejectedArtifacts: [{ id: 'art-1', artifactType: 'rollback_plan', title: 'Rollback Plan' }],
		} as any);
		renderPage();
		await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Review'));
		await waitFor(() => expect(screen.getByText('Verify')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Verify'));
		expect(await screen.findByTestId('artifact-drawer-verify')).toBeInTheDocument();
		fireEvent.click(screen.getByText('Apply verify'));
		await waitFor(() => expect(artifactApi.verifyArtifact).toHaveBeenCalledWith('art-1', expect.any(Object)));
	});
});
