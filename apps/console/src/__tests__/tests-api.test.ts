// ---------------------------------------------------------------------------
// Oscorpex — tests API client: the run request carries no filesystem path (I0 review B3)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTestRun } from '../lib/studio-api/tests';

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'r1' }), { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function lastRequest(): { url: string; body: Record<string, unknown> } {
	const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
	return { url, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> };
}

describe('triggerTestRun', () => {
	it('sends { taskId } only; the project id travels in the URL', async () => {
		await (triggerTestRun as (projectId: string, taskId?: string) => Promise<unknown>)('proj-1', 'task-9');
		const { url, body } = lastRequest();
		expect(url).toMatch(/\/tests\/run\/proj-1$/);
		expect(body).toEqual({ taskId: 'task-9' });
		expect(body).not.toHaveProperty('repoPath');
	});

	it('sends an empty object when no task is given', async () => {
		await (triggerTestRun as (projectId: string) => Promise<unknown>)('proj-1');
		const { body } = lastRequest();
		expect(body).toEqual({});
		expect(body).not.toHaveProperty('repoPath');
	});
});
