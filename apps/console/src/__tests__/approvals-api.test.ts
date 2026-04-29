import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	approveApproval,
	getApprovalState,
	getBlockingGates,
	getPendingApprovals,
	getReleaseState,
	rejectApproval,
} from '../lib/studio-api/approvals';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
	return Promise.resolve({
		ok: true,
		status: 200,
		json: () => Promise.resolve({ ok: true, data }),
	} as Response);
}

describe('approvals api client', () => {
	beforeEach(() => {
		mockFetch.mockClear();
	});

	it('getPendingApprovals calls pending endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok([]));
		await getPendingApprovals('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/approvals/pending?goalId=goal-1', expect.any(Object));
	});

	it('getApprovalState calls approval state endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ goalId: 'goal-1' }));
		await getApprovalState('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/approvals/goal-1/state', expect.any(Object));
	});

	it('approveApproval calls approve endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ state: 'approved' }));
		await approveApproval('ap-1', { reason: 'looks good' });
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/approvals/ap-1/approve', expect.any(Object));
	});

	it('rejectApproval calls reject endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ state: 'rejected' }));
		await rejectApproval('ap-1', { reason: 'missing evidence' });
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/approvals/ap-1/reject', expect.any(Object));
	});

	it('getReleaseState calls release state endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ allowed: false }));
		await getReleaseState('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/release/goal-1/state', expect.any(Object));
	});

	it('getBlockingGates calls gate blockers endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok([]));
		await getBlockingGates('goal-1');
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/quality-gates/goal-1/blockers', expect.any(Object));
	});
});
