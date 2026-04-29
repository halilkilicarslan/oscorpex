import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applyManualOverride,
	evaluateRelease,
	getApprovalState,
	getArtifactCompleteness,
	getBlockingGates,
	getQualityGateReadiness,
	getReleaseState,
	triggerRollback,
} from '../lib/studio-api/releases';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
	return Promise.resolve({
		ok: true,
		status: 200,
		json: () => Promise.resolve({ ok: true, data }),
	} as Response);
}

describe('releases api client', () => {
	beforeEach(() => mockFetch.mockClear());

	it('maps getReleaseState', async () => {
		mockFetch.mockReturnValueOnce(ok({ allowed: false }));
		await getReleaseState('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/release/goal-1/state', expect.any(Object));
	});

	it('maps evaluateRelease', async () => {
		mockFetch.mockReturnValueOnce(ok({ decision: 'blocked' }));
		await evaluateRelease('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/release/goal-1/evaluate', expect.any(Object));
	});

	it('maps applyManualOverride', async () => {
		mockFetch.mockReturnValueOnce(ok({ decision: 'overridden' }));
		await applyManualOverride('goal-1', {
			releaseCandidateId: 'rc-1',
			gateEvaluationId: 'ge-1',
			reason: 'coverage warning',
			expiresAt: new Date(Date.now() + 3600000).toISOString(),
		});
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/release/goal-1/override', expect.any(Object));
	});

	it('maps triggerRollback', async () => {
		mockFetch.mockReturnValueOnce(ok({ id: 'rb-1' }));
		await triggerRollback('goal-1', {
			releaseCandidateId: 'rc-1',
			triggerType: 'incident',
			severity: 'critical',
			source: 'release-panel',
			reason: 'prod issue',
		});
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/release/goal-1/rollback', expect.any(Object));
	});

	it('maps dependency readers', async () => {
		mockFetch
			.mockReturnValueOnce(ok([]))
			.mockReturnValueOnce(ok({ satisfied: false }))
			.mockReturnValueOnce(ok({ satisfied: false }))
			.mockReturnValueOnce(ok({ ready: false }));
		await getBlockingGates('goal-1');
		await getApprovalState('goal-1');
		await getArtifactCompleteness('goal-1');
		await getQualityGateReadiness('goal-1');
		expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/studio/quality-gates/goal-1/blockers', expect.any(Object));
		expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/studio/approvals/goal-1/state', expect.any(Object));
		expect(mockFetch).toHaveBeenNthCalledWith(3, '/api/studio/artifacts/goal-1/completeness', expect.any(Object));
		expect(mockFetch).toHaveBeenNthCalledWith(4, '/api/studio/quality-gates/goal-1/readiness', expect.any(Object));
	});
});
