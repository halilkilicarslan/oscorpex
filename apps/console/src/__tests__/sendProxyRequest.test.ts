import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendProxyRequest } from '../lib/studio-api/misc';

// F3-0: the API Explorer's user-supplied Authorization targets the APP, not the kernel.
// It must travel in x-oscorpex-upstream-authorization so the console's own credential
// is never confused with (or replaced by) the app's.

describe('sendProxyRequest (F3-0 upstream authorization)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{}'),
      headers: new Headers(),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentHeaders(): Record<string, string> {
    const init = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
    return Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
  }

  it('sends a user-supplied Authorization as x-oscorpex-upstream-authorization', async () => {
    await sendProxyRequest('p1', 'GET', '/api/me', { Authorization: 'Bearer app-token' });
    const h = sentHeaders();
    expect(h['x-oscorpex-upstream-authorization']).toBe('Bearer app-token');
    expect(h.authorization).toBeUndefined();
  });

  it('handles lowercase authorization too', async () => {
    await sendProxyRequest('p1', 'GET', '/api/me', { authorization: 'Bearer lower' });
    const h = sentHeaders();
    expect(h['x-oscorpex-upstream-authorization']).toBe('Bearer lower');
    expect(h.authorization).toBeUndefined();
  });

  it('leaves other headers untouched and adds no upstream header when none supplied', async () => {
    await sendProxyRequest('p1', 'GET', '/api/me', { 'X-Custom': '1' });
    const h = sentHeaders();
    expect(h['x-custom']).toBe('1');
    expect(h['x-oscorpex-upstream-authorization']).toBeUndefined();
  });
});
