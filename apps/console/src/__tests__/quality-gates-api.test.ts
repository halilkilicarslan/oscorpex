import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getApprovalState,
	getArtifactCompleteness,
	getQualityGateBlockers,
	getQualityGateEvaluations,
	getQualityGateReadiness,
	getReleaseState,
} from '../lib/studio-api/quality-gates';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
	return Promise.resolve({
		ok: true,
		status: 200,
		json: () => Promise.resolve({ ok: true, data }),
	} as Response);
}

describe('quality-gates api client', () => {
	beforeEach(() => {
		mockFetch.mockClear();
	});

	it('getQualityGateReadiness calls readiness endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ ready: true }));
		await getQualityGateReadiness('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/quality-gates/goal-1/readiness', expect.any(Object));
	});

	it('getQualityGateEvaluations calls evaluations endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok([]));
		await getQualityGateEvaluations('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/quality-gates/goal-1/evaluations', expect.any(Object));
	});

	it('getQualityGateBlockers calls blockers endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok([]));
		await getQualityGateBlockers('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/quality-gates/goal-1/blockers', expect.any(Object));
	});

	it('getApprovalState calls approval state endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ satisfied: false }));
		await getApprovalState('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/approvals/goal-1/state', expect.any(Object));
	});

	it('getReleaseState calls release state endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ blocked: true }));
		await getReleaseState('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/release/goal-1/state', expect.any(Object));
	});

	it('getArtifactCompleteness calls artifact completeness endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ satisfied: false }));
		await getArtifactCompleteness('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/artifacts/goal-1/completeness', expect.any(Object));
	});
});
