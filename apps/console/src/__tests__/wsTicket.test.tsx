// ---------------------------------------------------------------------------
// F3-e scenario 8 — both console WebSocket clients fetch a one-time ticket
// (POST /api/studio/ws/ticket with the normal auth headers) before connecting and on every
// reconnect; no token or API key appears in the WebSocket URL.
// Black-box: fetch and WebSocket are mocked; the ticket travels as the `ticket` query param.
// ---------------------------------------------------------------------------

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioWebSocket } from "../hooks/useStudioWebSocket";
import { streamAgentOutputWS } from "../lib/studio-api/pipeline";

const JWT = "jwt.secret.value";

class MockWebSocket {
	static instances: MockWebSocket[] = [];
	static OPEN = 1;
	static CONNECTING = 0;
	static CLOSING = 2;
	static CLOSED = 3;
	readyState = 0;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((e: MessageEvent<string>) => void) | null = null;
	sent: string[] = [];
	url: string;
	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.readyState = 3;
	}
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	drop() {
		this.readyState = 3;
		this.onclose?.();
	}
}

let ticketCounter = 0;
let fetchMock: ReturnType<typeof vi.fn>;
let order: string[];

beforeEach(() => {
	vi.useFakeTimers();
	ticketCounter = 0;
	order = [];
	MockWebSocket.instances = [];
	vi.spyOn(window.localStorage, "getItem").mockImplementation((key: string) => (key === "oscorpex_token" ? JWT : null));
	fetchMock = vi.fn(async () => {
		order.push("fetch");
		ticketCounter += 1;
		return {
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: async () => ({ ticket: `ticket-${ticketCounter}`, expiresIn: 30 }),
			text: async () => JSON.stringify({ ticket: `ticket-${ticketCounter}`, expiresIn: 30 }),
		} as unknown as Response;
	});
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal(
		"WebSocket",
		new Proxy(MockWebSocket, {
			construct(target, args) {
				order.push("ws");
				return new target(...(args as [string]));
			},
		}),
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const flush = () =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
const ticketCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/studio/ws/ticket"));

function expectCleanUrl(url: string) {
	expect(url).not.toContain(JWT);
	expect(url).not.toMatch(/[?&](token|apiKey)=/);
}

describe("F3-e 8 — useStudioWebSocket ticket flow", () => {
	it("fetches a ticket (POST, normal auth headers) before opening the socket; URL has the ticket, no token", async () => {
		renderHook(() => useStudioWebSocket("p-1"));
		await flush();

		expect(ticketCalls()).toHaveLength(1);
		const [, init] = ticketCalls()[0] as [string, RequestInit];
		expect(init.method).toBe("POST");
		expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${JWT}`);

		expect(MockWebSocket.instances).toHaveLength(1);
		expect(order.indexOf("fetch")).toBeLessThan(order.indexOf("ws"));
		const url = MockWebSocket.instances[0].url;
		expect(url).toContain("ticket=ticket-1");
		expectCleanUrl(url);
	});

	it("fetches a NEW ticket on every reconnect", async () => {
		renderHook(() => useStudioWebSocket("p-1"));
		await flush();
		MockWebSocket.instances[0].open();
		MockWebSocket.instances[0].drop();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_100);
		});

		expect(ticketCalls()).toHaveLength(2);
		expect(MockWebSocket.instances).toHaveLength(2);
		expect(MockWebSocket.instances[1].url).toContain("ticket=ticket-2");
		expect(MockWebSocket.instances[1].url).not.toContain("ticket=ticket-1");
		expectCleanUrl(MockWebSocket.instances[1].url);
	});

	it("does not open a socket (and does not leak the token) when the ticket request fails", async () => {
		fetchMock.mockImplementation(
			async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" }) as unknown as Response,
		);
		renderHook(() => useStudioWebSocket("p-1"));
		await flush();
		expect(MockWebSocket.instances).toHaveLength(0);
	});
});

describe("F3-e 8 — streamAgentOutputWS ticket flow", () => {
	it("fetches a ticket before connecting; URL has the ticket, no token", async () => {
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {});
		await flush();

		expect(ticketCalls()).toHaveLength(1);
		const [, init] = ticketCalls()[0] as [string, RequestInit];
		expect(init.method).toBe("POST");
		expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${JWT}`);
		expect(MockWebSocket.instances).toHaveLength(1);
		expect(order.indexOf("fetch")).toBeLessThan(order.indexOf("ws"));
		expect(MockWebSocket.instances[0].url).toContain("ticket=ticket-1");
		expectCleanUrl(MockWebSocket.instances[0].url);
		stop();
	});

	it("fetches a new ticket on every reconnect", async () => {
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {});
		await flush();
		MockWebSocket.instances[0].open();
		MockWebSocket.instances[0].drop();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_100);
		});

		expect(ticketCalls()).toHaveLength(2);
		expect(MockWebSocket.instances).toHaveLength(2);
		expect(MockWebSocket.instances[1].url).toContain("ticket=ticket-2");
		expectCleanUrl(MockWebSocket.instances[1].url);
		stop();
	});
});

// ---------------------------------------------------------------------------
// Review fix round 1 (items 3 and 9)
// ---------------------------------------------------------------------------

const failTicket = (status: number) =>
	fetchMock.mockImplementation(async () => {
		order.push("fetch");
		return { ok: false, status, headers: new Headers(), json: async () => ({}), text: async () => "" } as unknown as Response;
	});
const advance = (ms: number) =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});

describe("F3-e r1 item 3 — no VITE_API_KEY fallback", () => {
	const ENV_KEY = "env-api-key-value";
	beforeEach(() => {
		vi.mocked(window.localStorage.getItem).mockImplementation(() => null);
		vi.stubEnv("VITE_API_KEY", ENV_KEY);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const expectNoAuth = () => {
		expect(ticketCalls()).toHaveLength(1);
		const [, init] = ticketCalls()[0] as [string, RequestInit];
		expect(new Headers(init.headers).get("Authorization")).toBeNull();
		expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(ENV_KEY);
	};

	it("streamAgentOutputWS: with no stored token the ticket request carries no Authorization header and the URL no key", async () => {
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {});
		await flush();
		expectNoAuth();
		expect(MockWebSocket.instances).toHaveLength(1);
		expect(MockWebSocket.instances[0].url).not.toContain(ENV_KEY);
		expect(MockWebSocket.instances[0].url).not.toMatch(/[?&](token|apiKey)=/);
		stop();
	});

	it("useStudioWebSocket: with no stored token the ticket request carries no Authorization header and the URL no key", async () => {
		renderHook(() => useStudioWebSocket("p-1"));
		await flush();
		expectNoAuth();
		expect(MockWebSocket.instances).toHaveLength(1);
		expect(MockWebSocket.instances[0].url).not.toContain(ENV_KEY);
	});

	it("an ordinary API call without a token sends no Authorization header either", async () => {
		const { getAgentRunHistory } = await import("../lib/studio-api/pipeline");
		await getAgentRunHistory("p-1", "agent-1").catch(() => undefined);
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
		expect(new Headers(init?.headers).get("Authorization")).toBeNull();
		expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(ENV_KEY);
	});
});

describe("F3-e r1 item 9 — ticket failures", () => {
	it("useStudioWebSocket: a 401 from /ws/ticket stops retrying", async () => {
		failTicket(401);
		renderHook(() => useStudioWebSocket("p-1"));
		await flush();
		expect(ticketCalls()).toHaveLength(1);
		await advance(120_000);
		expect(ticketCalls()).toHaveLength(1);
		expect(MockWebSocket.instances).toHaveLength(0);
	});

	it("streamAgentOutputWS: a 401 from /ws/ticket stops retrying", async () => {
		failTicket(401);
		const onError = vi.fn();
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {}, onError);
		await flush();
		expect(ticketCalls()).toHaveLength(1);
		await advance(120_000);
		expect(ticketCalls()).toHaveLength(1);
		expect(MockWebSocket.instances).toHaveLength(0);
		stop();
	});

	it("useStudioWebSocket: other failures back off exponentially", async () => {
		failTicket(500);
		renderHook(() => useStudioWebSocket("p-1"));
		await flush();
		expect(ticketCalls()).toHaveLength(1);
		await advance(500);
		expect(ticketCalls()).toHaveLength(1);
		await advance(600); // t = 1.1 s: first retry after the 1 s base delay
		expect(ticketCalls()).toHaveLength(2);
		await advance(1_000); // next delay is 2 s, not yet due
		expect(ticketCalls()).toHaveLength(2);
		await advance(1_100);
		expect(ticketCalls()).toHaveLength(3);
	});

	it("streamAgentOutputWS: other failures back off exponentially", async () => {
		failTicket(503);
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {}, () => {});
		await flush();
		expect(ticketCalls()).toHaveLength(1);
		await advance(500);
		expect(ticketCalls()).toHaveLength(1);
		await advance(600);
		expect(ticketCalls()).toHaveLength(2);
		await advance(1_000);
		expect(ticketCalls()).toHaveLength(2);
		await advance(1_100);
		expect(ticketCalls()).toHaveLength(3);
		stop();
	});
});

describe("F3-e r1 item 9 — streamAgentOutputWS builds the URL from the page location", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses wss and the page host under https", async () => {
		vi.stubGlobal("location", { protocol: "https:", hostname: "studio.example.com", host: "studio.example.com" });
		vi.stubGlobal("WebSocket", MockWebSocket);
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {});
		await flush();
		expect(MockWebSocket.instances).toHaveLength(1);
		expect(MockWebSocket.instances[0].url).toMatch(/^wss:\/\/studio\.example\.com:\d+\/api\/studio\/ws\?/);
		stop();
	});

	it("uses ws and the page host under http", async () => {
		vi.stubGlobal("location", { protocol: "http:", hostname: "192.168.1.20", host: "192.168.1.20:5161" });
		vi.stubGlobal("WebSocket", MockWebSocket);
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {});
		await flush();
		expect(MockWebSocket.instances[0].url).toMatch(/^ws:\/\/192\.168\.1\.20:\d+\/api\/studio\/ws\?/);
		stop();
	});
});

// ---------------------------------------------------------------------------
// Final fix round, item 5 — 401 and 403 from /ws/ticket are terminal: no retry, and exactly one
// `studio:api:error` window event (detail.status) per failure sequence, so no repeated forbidden toast.
// ---------------------------------------------------------------------------

describe.each([401, 403])("F3-e final — a %i from /ws/ticket", (status) => {
	let events: Array<{ status?: number }>;
	const onApiError = (e: Event) => events.push((e as CustomEvent).detail ?? {});
	beforeEach(() => {
		events = [];
		window.addEventListener("studio:api:error", onApiError);
	});
	afterEach(() => {
		window.removeEventListener("studio:api:error", onApiError);
	});
	const forStatus = () => events.filter((e) => e.status === status);

	it("useStudioWebSocket: stops retrying and dispatches studio:api:error once", async () => {
		failTicket(status);
		renderHook(() => useStudioWebSocket("p-1"));
		await flush();
		await advance(120_000);
		expect(ticketCalls()).toHaveLength(1);
		expect(MockWebSocket.instances).toHaveLength(0);
		expect(forStatus()).toHaveLength(1);
	});

	it("streamAgentOutputWS: stops retrying and dispatches studio:api:error once", async () => {
		failTicket(status);
		const stop = streamAgentOutputWS("p-1", "agent-1", () => {}, () => {});
		await flush();
		await advance(120_000);
		expect(ticketCalls()).toHaveLength(1);
		expect(MockWebSocket.instances).toHaveLength(0);
		expect(forStatus()).toHaveLength(1);
		stop();
	});
});
