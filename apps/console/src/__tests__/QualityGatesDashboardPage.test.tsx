import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import QualityGatesDashboardPage from '../pages/studio/QualityGatesDashboardPage';
import { StudioApiError } from '../lib/studio-api/base';

vi.mock('../lib/studio-api/quality-gates', () => ({
	getQualityGateReadiness: vi.fn(),
	getQualityGateEvaluations: vi.fn(),
	getQualityGateBlockers: vi.fn(),
	getApprovalState: vi.fn(),
	getReleaseState: vi.fn(),
	getArtifactCompleteness: vi.fn(),
}));

import * as qgApi from '../lib/studio-api/quality-gates';

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/studio/quality-gates/goal-1']}>
			<Routes>
				<Route path="/studio/quality-gates/:goalId" element={<QualityGatesDashboardPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

const readinessBase = {
	ready: false,
	environment: 'production' as const,
	blockingGates: [],
	warnings: [],
	missingEvaluations: [],
	evaluations: [],
	requiredGates: [
		{ id: 'g1', gateType: 'security_scan', required: true, blocking: true, overrideAllowed: false },
	],
};

const approvalBase = {
	goalId: 'goal-1',
	satisfied: true,
	blocked: false,
	missingApprovals: 0,
	pending: [],
	expired: [],
	rejected: [],
	states: [],
};

const releaseBase = {
	allowed: true,
	blocked: false,
	requiresOverride: false,
	rollbackRequired: false,
	blockingReasons: [],
	latestDecision: { decision: 'approved', releaseCandidateId: 'rc-1', createdAt: new Date().toISOString() },
	rollbackTriggers: [],
};

const artifactBase = {
	satisfied: true,
	missingArtifacts: [],
	staleArtifacts: [],
	rejectedArtifacts: [],
	latestArtifacts: [],
	requiredArtifacts: ['security_scan_result'],
	environment: 'production' as const,
};

describe('QualityGatesDashboardPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(qgApi.getQualityGateReadiness).mockResolvedValue(readinessBase);
		vi.mocked(qgApi.getQualityGateEvaluations).mockResolvedValue([]);
		vi.mocked(qgApi.getQualityGateBlockers).mockResolvedValue([]);
		vi.mocked(qgApi.getApprovalState).mockResolvedValue(approvalBase);
		vi.mocked(qgApi.getReleaseState).mockResolvedValue(releaseBase);
		vi.mocked(qgApi.getArtifactCompleteness).mockResolvedValue(artifactBase);
	});

	it('renders loading state', () => {
		vi.mocked(qgApi.getQualityGateReadiness).mockReturnValue(new Promise(() => {}) as never);
		renderPage();
		expect(screen.getByTestId('qg-loading')).toBeInTheDocument();
	});

	it('renders release-ready state', async () => {
		renderPage();
		await waitFor(() => expect(screen.getByTestId('release-summary')).toBeInTheDocument());
		expect(screen.getByText('Allowed')).toBeInTheDocument();
	});

	it('renders blocked state with blocking reasons', async () => {
		vi.mocked(qgApi.getReleaseState).mockResolvedValue({
			...releaseBase,
			allowed: false,
			blocked: true,
			blockingReasons: [{ code: 'blocking_gate', source: 'quality_gate', detail: 'security scan failed' }],
			latestDecision: { decision: 'blocked', releaseCandidateId: 'rc-1', createdAt: new Date().toISOString() },
		});
		renderPage();
		await waitFor(() => expect(screen.getByText('Blocked')).toBeInTheDocument());
		expect(screen.getByText('1')).toBeInTheDocument();
	});

	it('renders missing approvals', async () => {
		vi.mocked(qgApi.getApprovalState).mockResolvedValue({
			...approvalBase,
			satisfied: false,
			missingApprovals: 2,
			pending: [{ request: { id: 'a1', approvalClass: 'human_approval', requiredQuorum: 2 }, missingApprovals: 2, approvedActorIds: [], rejectedActorIds: [] }],
		});
		renderPage();
		await waitFor(() => expect(screen.getByTestId('approval-summary')).toBeInTheDocument());
		expect(screen.getByText(/missing approvals: 2/i)).toBeInTheDocument();
	});

	it('renders missing artifacts', async () => {
		vi.mocked(qgApi.getArtifactCompleteness).mockResolvedValue({
			...artifactBase,
			satisfied: false,
			missingArtifacts: ['rollback_plan'],
		});
		renderPage();
		await waitFor(() => expect(screen.getByTestId('artifact-summary')).toBeInTheDocument());
		expect(screen.getByText(/rollback_plan/)).toBeInTheDocument();
	});

	it('renders rollback required', async () => {
		vi.mocked(qgApi.getReleaseState).mockResolvedValue({
			...releaseBase,
			allowed: false,
			blocked: true,
			rollbackRequired: true,
			rollbackTriggers: [{ id: 'r1', triggerType: 'incident', severity: 'critical', state: 'rollback-required', reason: 'prod outage' }],
		});
		renderPage();
		await waitFor(() => expect(screen.getByTestId('rollback-panel')).toBeInTheDocument());
		expect(screen.getByText(/rollbackRequired: true/i)).toBeInTheDocument();
	});

	it('renders controlled permission error', async () => {
		vi.mocked(qgApi.getQualityGateReadiness).mockRejectedValue(new StudioApiError('Forbidden', 403, { error: 'Forbidden' }));
		renderPage();
		await waitFor(() => expect(screen.getByTestId('qg-error-403')).toBeInTheDocument());
		expect(screen.getByText(/erişim iznin yok/i)).toBeInTheDocument();
	});
});
