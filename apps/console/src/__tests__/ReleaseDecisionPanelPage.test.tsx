import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReleaseDecisionPanelPage from '../pages/studio/ReleaseDecisionPanelPage';
import { StudioApiError } from '../lib/studio-api/base';

vi.mock('../lib/studio-api/releases', () => ({
	getReleaseState: vi.fn(),
	getBlockingGates: vi.fn(),
	getApprovalState: vi.fn(),
	getArtifactCompleteness: vi.fn(),
	getQualityGateReadiness: vi.fn(),
	evaluateRelease: vi.fn(),
	applyManualOverride: vi.fn(),
	triggerRollback: vi.fn(),
}));

import * as releasesApi from '../lib/studio-api/releases';

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/studio/releases/goal-1']}>
			<Routes>
				<Route path="/studio/releases/:goalId" element={<ReleaseDecisionPanelPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

const releaseStateBase = {
	allowed: false,
	blocked: true,
	requiresOverride: true,
	rollbackRequired: false,
	blockingReasons: [{ code: 'blocking_gate', source: 'quality_gate', detail: 'coverage warning', overrideAllowed: true }],
	latestDecision: { decision: 'blocked', releaseCandidateId: 'rc-1', createdAt: new Date().toISOString() },
	rollbackTriggers: [],
};

describe('ReleaseDecisionPanelPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(releasesApi.getReleaseState).mockResolvedValue(releaseStateBase as any);
		vi.mocked(releasesApi.getBlockingGates).mockResolvedValue([
			{ gateType: 'coverage', reason: 'coverage low', overrideAllowed: true },
		] as any);
		vi.mocked(releasesApi.getApprovalState).mockResolvedValue({ satisfied: true, blocked: false, pending: [], expired: [], rejected: [], states: [], goalId: 'goal-1', missingApprovals: 0 } as any);
		vi.mocked(releasesApi.getArtifactCompleteness).mockResolvedValue({ satisfied: true, missingArtifacts: [], staleArtifacts: [], rejectedArtifacts: [], latestArtifacts: [], requiredArtifacts: [], environment: 'production' } as any);
		vi.mocked(releasesApi.getQualityGateReadiness).mockResolvedValue({ environment: 'production', ready: false, blockingGates: [], warnings: [], missingEvaluations: [], evaluations: [], requiredGates: [] } as any);
		vi.mocked(releasesApi.evaluateRelease).mockResolvedValue({ releaseCandidateId: 'rc-1', decision: 'blocked' });
		vi.mocked(releasesApi.applyManualOverride).mockResolvedValue({ releaseCandidateId: 'rc-1', decision: 'overridden' });
		vi.mocked(releasesApi.triggerRollback).mockResolvedValue({ id: 'rb-1' });
	});

	it('release summary renders', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByTestId('release-summary')).toBeInTheDocument());
		expect(screen.getByText(/requiresOverride/i)).toBeInTheDocument();
	});

	it('blocking reasons visible', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByTestId('blocking-reasons')).toBeInTheDocument());
		expect(screen.getByText(/coverage warning/i)).toBeInTheDocument();
	});

	it('override allowed state renders', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByTestId('override-eligibility')).toBeInTheDocument());
		expect(screen.getByText(/override possible: true/i)).toBeInTheDocument();
	});

	it('override forbidden state and hard-fail explanation visible', async () => {
		vi.mocked(releasesApi.getReleaseState).mockResolvedValue({
			...releaseStateBase,
			blockingReasons: [{ code: 'security_scan_hard_fail', source: 'quality_gate', overrideAllowed: false }],
		} as any);
		renderPage();
		await waitFor(() => expect(screen.getByTestId('override-hard-fail')).toBeInTheDocument());
		expect(screen.getByTestId('override-eligibility')).toHaveTextContent('override forbidden: true');
	});

	it('mandatory reason enforced', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByTestId('override-action')).toBeInTheDocument());
		const section = screen.getByTestId('override-action');
		const btn = screen.getByText('Apply Manual Override');
		fireEvent.change(within(section).getByPlaceholderText('releaseCandidateId'), { target: { value: 'rc-1' } });
		fireEvent.change(within(section).getByPlaceholderText('gateEvaluationId'), { target: { value: 'ge-1' } });
		fireEvent.click(screen.getByLabelText(/Override riskini ve release etkisini anladım/i));
		expect(btn).toBeDisabled();
	});

	it('future expiresAt enforced', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByTestId('override-action')).toBeInTheDocument());
		const section = screen.getByTestId('override-action');
		fireEvent.change(within(section).getByPlaceholderText('Override reason (mandatory)'), { target: { value: 'reason text' } });
		fireEvent.change(within(section).getByTestId('override-expires-at'), { target: { value: '2000-01-01T10:00' } });
		expect(screen.getByTestId('override-expiry-error')).toBeInTheDocument();
	});

	it('evaluate action refreshes state', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByText('Re-Evaluate')).toBeInTheDocument());
		fireEvent.click(screen.getByText('Re-Evaluate'));
		await waitFor(() => expect(releasesApi.evaluateRelease).toHaveBeenCalledWith('goal-1'));
	});

	it('rollback required visible', async () => {
		vi.mocked(releasesApi.getReleaseState).mockResolvedValue({
			...releaseStateBase,
			rollbackRequired: true,
			rollbackTriggers: [{ id: 'rb-1', triggerType: 'incident', severity: 'critical', state: 'rollback-required', reason: 'prod issue' }],
		} as any);
		renderPage();
		await waitFor(() => expect(screen.getByTestId('rollback-risk')).toBeInTheDocument());
		expect(screen.getByText(/Release proceed şu an tehlikeli/i)).toBeInTheDocument();
	});

	it('permission denied handled', async () => {
		vi.mocked(releasesApi.getReleaseState).mockRejectedValue(new StudioApiError('Forbidden', 403, { error: 'forbidden' }));
		renderPage();
		await waitFor(() => expect(screen.getByTestId('release-panel-error-403')).toBeInTheDocument());
	});
});
