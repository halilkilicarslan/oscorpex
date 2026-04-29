import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '../lib/api';

const encoder = new TextEncoder();

function mockLocalStorageToken(token: string | null) {
	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: vi.fn(() => token),
		},
		configurable: true,
	});
}

function makeStreamResponse(lines: string[]) {
	let index = 0;
	return {
		ok: true,
		body: {
			getReader: () => ({
				read: vi.fn(async () => {
					if (index >= lines.length) return { done: true, value: undefined };
					const value = encoder.encode(lines[index++]);
					return { done: false, value };
				}),
			}),
		},
	} as unknown as Response;
}

function makePendingFetchMock() {
	return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}));
}

describe('streamChat', () => {
	const originalFetch = globalThis.fetch;
	const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalLocalStorage) {
			Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
		} else {
			Reflect.deleteProperty(globalThis, 'localStorage');
		}
	});

	it('attaches Authorization header when token exists', () => {
		mockLocalStorageToken('jwt-token');
		const fetchMock = makePendingFetchMock();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		streamChat('agent-1', 'hello');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/studio/agents/agent-1/stream',
			expect.objectContaining({
				method: 'POST',
				headers: {
					Authorization: 'Bearer jwt-token',
					'Content-Type': 'application/json',
				},
			}),
		);
	});

	it('does not attach Authorization when token missing', () => {
		mockLocalStorageToken(null);
		const fetchMock = makePendingFetchMock();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		streamChat('agent-1', 'hello');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/studio/agents/agent-1/stream',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
			}),
		);
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(init.headers).not.toHaveProperty('Authorization');
	});

	it('preserves AbortController behavior', () => {
		mockLocalStorageToken(null);
		const fetchMock = makePendingFetchMock();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const abort = streamChat('agent-1', 'hello');
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(init.signal?.aborted).toBe(false);
		abort();
		expect(init.signal?.aborted).toBe(true);
	});

	it('continues parsing ReadableStream correctly', async () => {
		mockLocalStorageToken('jwt-token');
		const onEvent = vi.fn();
		const onDone = vi.fn();
		const onError = vi.fn();
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => makeStreamResponse([
			'data: {"type":"message","text":"hello"}\n',
			'data: [DONE]\n',
		]));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		streamChat('agent-1', 'hello', undefined, onEvent, onDone, onError);

		await vi.waitFor(() => {
			expect(onDone).toHaveBeenCalled();
		});
		expect(onEvent).toHaveBeenCalledWith({ type: 'message', text: 'hello' });
		expect(onError).not.toHaveBeenCalled();
	});
});
