import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getArtifactCompleteness,
	getArtifacts,
	registerArtifact,
	rejectArtifact,
	supersedeArtifact,
	verifyArtifact,
} from '../lib/studio-api/artifacts';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
	return Promise.resolve({
		ok: true,
		status: 200,
		json: () => Promise.resolve({ ok: true, data }),
	} as Response);
}

describe('artifacts api client', () => {
	beforeEach(() => {
		mockFetch.mockClear();
	});

	it('maps register endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ id: 'art-1' }));
		await registerArtifact({
			goalId: 'goal-1',
			artifactType: 'rollback_plan',
			title: 'Rollback Plan',
			environment: 'production',
		});
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/artifacts/register', expect.any(Object));
	});

	it('maps verify endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ id: 'art-1' }));
		await verifyArtifact('art-1', { reason: 'validated' });
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/artifacts/art-1/verify', expect.any(Object));
	});

	it('maps reject endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ id: 'art-1' }));
		await rejectArtifact('art-1', { reason: 'invalid checksum' });
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/artifacts/art-1/reject', expect.any(Object));
	});

	it('maps supersede endpoint', async () => {
		mockFetch.mockReturnValueOnce(ok({ artifactId: 'art-1', superseded: true }));
		await supersedeArtifact('art-1', { reason: 'newer artifact available' });
		expect(mockFetch).toHaveBeenCalledWith('/api/studio/artifacts/art-1/supersede', expect.any(Object));
	});

	it('maps artifact readers', async () => {
		mockFetch.mockReturnValueOnce(ok([])).mockReturnValueOnce(ok({ satisfied: true }));
		await getArtifacts('goal-1');
		await getArtifactCompleteness('goal-1');
		expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/studio/artifacts/goal-1', expect.any(Object));
		expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/studio/artifacts/goal-1/completeness', expect.any(Object));
	});
});
