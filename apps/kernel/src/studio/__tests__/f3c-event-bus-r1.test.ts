// ---------------------------------------------------------------------------
// F3-c review fix round 1 — contract for platform events, WS auth, handler registration, NOTIFY hardening,
// bridge scope errors, unscoped emits, ordering/caching, ws-cluster relay and notification tenancy.
// Strict-scope file: hooks and tests run outside the implicit scope (helpers/strict-scope.ts).
//
// Choices:
//  - Events table timestamps live in `events.timestamp` (there is no created_at column): "older than 30 s" is
//    measured against it.
//  - DB errors during the NOTIFY re-read reuse `notifyDropped` (the existing counters test pins the four keys).
//  - Platform-safe WS types: `provider:degraded` only. cross-project-learning.ts:269 emits `task:completed` on
//    "__global__" with `{ learningPatternsPromoted, tenantId }`: tenant-derived content, never sent to tenant clients.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const loggers = vi.hoisted(() => new Map<string, Record<string, ReturnType<typeof vi.fn>>>());
const dbHooks = vi.hoisted(() => ({
	projectTenant: new Map<string, string | null>(),
	projectTenantCalls: [] as string[],
	eventTenantError: false,
}));

vi.mock("../logger.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../logger.js")>();
	return {
		...orig,
		createLogger: (name: string) => {
			let l = loggers.get(name);
			if (!l) {
				const self: Record<string, unknown> = {};
				for (const k of ["info", "warn", "error", "debug", "trace", "fatal"]) self[k] = vi.fn();
				self.child = () => self;
				l = self as Record<string, ReturnType<typeof vi.fn>>;
				loggers.set(name, l);
			}
			return l;
		},
	};
});

vi.mock("../db.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../db.js")>();
	return {
		...orig,
		getProjectTenantId: vi.fn(async (projectId: string) => {
			dbHooks.projectTenantCalls.push(projectId);
			if (dbHooks.projectTenant.has(projectId)) return dbHooks.projectTenant.get(projectId) ?? null;
			return orig.getProjectTenantId(projectId);
		}),
		getEventTenantId: vi.fn(async (eventId: string) => {
			if (dbHooks.eventTenantError) throw new Error("db down");
			return orig.getEventTenantId(eventId);
		}),
	};
});

vi.mock("../webhook-sender.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../webhook-sender.js")>();
	return { ...orig, sendWebhookNotification: vi.fn(async () => {}) };
});

vi.mock("../plugin-registry.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../plugin-registry.js")>();
	return {
		...orig,
		notifyPlugins: vi.fn(async () => {}),
		pluginRegistry: Object.assign(Object.create(Object.getPrototypeOf(orig.pluginRegistry)), orig.pluginRegistry, {
			notifyPlugins: vi.fn(async () => {}),
		}),
	};
});

vi.mock("../notification-service.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../notification-service.js")>();
	return { ...orig, processEventForNotification: vi.fn(orig.processEventForNotification) };
});

import { registerNotificationBridge } from "../composition/register-notification-bridge.js";
import { registerPluginBridge } from "../composition/register-plugin-bridge.js";
import { registerWebhookBridge } from "../composition/register-webhook-bridge.js";
import * as eventBusModule from "../event-bus.js";
import { eventBus } from "../event-bus.js";
import { processEventForNotification } from "../notification-service.js";
import { pgListener } from "../pg-listener.js";
import { notifyPlugins, pluginRegistry } from "../plugin-registry.js";
import { InMemoryStateProvider } from "../shared-state.js";
import { TenantScopeError, currentScope, runAsSystem, runInTenant } from "../tenancy/tenant-scope.js";
import type { EventType, StudioEvent } from "../types.js";
import { sendWebhookNotification } from "../webhook-sender.js";
import { WsCluster } from "../ws-cluster.js";
import { wsManager } from "../ws-manager.js";
import { cleanupRunningProjects, seedRunningProjects } from "./helpers/background-fixtures.js";
import * as strictScope from "./helpers/strict-scope.js";
import { TENANT_A, TENANT_B, TENANT_LOCAL, seedTestTenants, withMigrator } from "./helpers/tenancy.js";

const useStrict = (strictScope as Record<string, unknown>).useStrictScopeForFile as (() => void) | undefined;
if (typeof useStrict === "function") useStrict();

type TenantEvent = StudioEvent & { tenantId?: string };
type EmitInput = Record<string, unknown>;

const bus = eventBus as unknown as {
	emit(data: EmitInput): void;
	emitTransient(data: EmitInput): void;
	emitAsync(data: EmitInput): Promise<StudioEvent>;
	on(type: EventType, h: (e: TenantEvent) => unknown): () => void;
	onProject(projectId: string, h: (e: TenantEvent) => unknown): () => void;
	initPgListener(): Promise<void>;
};

const counters = () => eventBusModule.getEventBusCounters() as ReturnType<typeof eventBusModule.getEventBusCounters>;
const resetCounters = () => eventBusModule.resetEventBusCounters();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

let A: { projectId: string };
let B: { projectId: string };
let listenerCallback: ((payload: unknown) => void) | undefined;
const offs: Array<() => void> = [];
const seededEventIds: string[] = [];
const subscribe = <T extends () => void>(off: T): T => {
	offs.push(off);
	return off;
};

async function seedEventRow(projectId: string, ageSeconds: number): Promise<string> {
	const id = `f3c-r1-evt-${uid()}`;
	await withMigrator(async (c) => {
		await c.query(
			`INSERT INTO events (id, project_id, type, payload, timestamp, correlation_id)
			 VALUES ($1, $2, 'task:completed', '{"title":"foreign"}', now() - ($3 || ' seconds')::interval, $4)`,
			[id, projectId, String(ageSeconds), `corr-${id}`],
		);
	});
	seededEventIds.push(id);
	return id;
}

function emitIn(tenant: string, data: EmitInput): Promise<void> {
	return runInTenant(tenant, async () => {
		bus.emit(data);
	});
}

/** Minimal WebSocket stand-in registered straight into the manager. */
function fakeWs() {
	const sent: string[] = [];
	const ws = Object.assign(new EventEmitter(), {
		readyState: 1,
		send: (d: string) => {
			sent.push(d);
		},
		close: vi.fn(),
		ping: vi.fn(),
		terminate: vi.fn(),
	});
	return { ws, sent };
}

type WsInternals = {
	clients: Map<unknown, { tenantId: string | null; subscriptions: Set<string>; pingTimer?: NodeJS.Timeout }>;
	wss: EventEmitter;
	_doSubscribe(record: unknown, projectId: string): void;
	_unsubscribe(record: unknown, projectId: string): void;
};
const wsi = wsManager as unknown as WsInternals;

function messagesOf(sent: string[]): Array<{ payload: { type: string; payload: Record<string, unknown> } }> {
	return sent.flatMap((d) => {
		const parsed = JSON.parse(d);
		return Array.isArray(parsed) ? parsed : [parsed];
	});
}

beforeAll(async () => {
	await seedTestTenants();
	await cleanupRunningProjects();
	const fx = await seedRunningProjects();
	A = fx.A;
	B = fx.B;

	vi.spyOn(pgListener, "start").mockResolvedValue(undefined);
	const onNotification = vi.spyOn(pgListener, "onNotification");
	await bus.initPgListener();
	listenerCallback = onNotification.mock.calls.at(-1)?.[0] as ((payload: unknown) => void) | undefined;

	registerNotificationBridge();
	registerWebhookBridge();
	registerPluginBridge();
});

afterAll(async () => {
	await withMigrator(async (c) => {
		await c.query("DELETE FROM notifications WHERE project_id = ANY($1)", [[A.projectId, B.projectId]]);
		if (seededEventIds.length) await c.query("DELETE FROM events WHERE id = ANY($1)", [seededEventIds]);
		await c.query("DELETE FROM events WHERE project_id = ANY($1)", [[A.projectId, B.projectId]]);
	});
	await cleanupRunningProjects();
});

beforeEach(() => {
	vi.mocked(sendWebhookNotification).mockClear();
	vi.mocked(notifyPlugins).mockClear();
	vi.mocked(pluginRegistry.notifyPlugins).mockClear();
	vi.mocked(processEventForNotification).mockClear();
	for (const l of loggers.values()) for (const f of Object.values(l)) if ("mockClear" in f) f.mockClear();
	dbHooks.projectTenant.clear();
	dbHooks.projectTenantCalls.length = 0;
	dbHooks.eventTenantError = false;
	resetCounters();
});

afterEach(() => {
	while (offs.length) offs.pop()?.();
	vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 1. __global__ platform events
// ---------------------------------------------------------------------------
describe("R1-1 — __global__ platform events", () => {
	it("are not rejected, dispatch to bus handlers outside any scope, and reach plugin-bridge handlers", async () => {
		const seen: Array<{ event: TenantEvent; scope: ReturnType<typeof currentScope> }> = [];
		subscribe(bus.on("provider:degraded", (event) => void seen.push({ event, scope: currentScope() })));

		await runAsSystem("f3c-r1", async () => {
			bus.emitTransient({ projectId: "__global__", type: "provider:degraded", payload: { provider: "claude" } });
		});

		await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 3000 });
		expect(seen[0].scope).toBeUndefined();
		expect(counters().rejected).toBe(0);
		expect(loggers.get("event-bus")?.error).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(pluginRegistry.notifyPlugins).toHaveBeenCalled(), { timeout: 3000 });
		const forwarded = vi.mocked(pluginRegistry.notifyPlugins).mock.calls.map((c) => c[0] as { projectId: string });
		expect(forwarded.some((e) => e.projectId === "__global__")).toBe(true);
	});

	it("emit() (persisting path) on __global__ is not rejected either", async () => {
		const seen: TenantEvent[] = [];
		subscribe(bus.on("provider:degraded", (e) => void seen.push(e)));
		await runAsSystem("f3c-r1", async () => {
			bus.emit({ projectId: "__global__", type: "provider:degraded", payload: { provider: "codex" } });
		});
		await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 3000 });
		expect(counters().rejected).toBe(0);
	});

	it("WS: tenant clients of any tenant get provider:degraded but never the learning-promotion event", async () => {
		const cA = fakeWs();
		const cB = fakeWs();
		const recA = { ws: cA.ws, subscriptions: new Set<string>(), lastPong: Date.now(), tenantId: TENANT_A };
		const recB = { ws: cB.ws, subscriptions: new Set<string>(), lastPong: Date.now(), tenantId: TENANT_B };
		wsi.clients.set(cA.ws, recA);
		wsi.clients.set(cB.ws, recB);
		wsi._doSubscribe(recA, "__global__");
		wsi._doSubscribe(recB, "__global__");
		try {
			await runAsSystem("f3c-r1", async () => {
				bus.emitTransient({ projectId: "__global__", type: "provider:degraded", payload: { provider: "claude" } });
				// cross-project-learning.ts:269 — carries tenantId + counts; tenant-derived, must stay server-side
				bus.emitTransient({
					projectId: "__global__",
					type: "task:completed",
					payload: { learningPatternsPromoted: 2, tenantId: TENANT_B },
				});
			});
			await sleep(300);
			for (const c of [cA, cB]) {
				const events = messagesOf(c.sent).map((m) => m.payload);
				expect(events.map((e) => e.type)).toContain("provider:degraded");
				expect(JSON.stringify(events)).not.toContain("learningPatternsPromoted");
			}
		} finally {
			wsi._unsubscribe(recA, "__global__");
			wsi._unsubscribe(recB, "__global__");
			wsi.clients.delete(cA.ws);
			wsi.clients.delete(cB.ws);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. WS env API key and null-tenant clients
// ---------------------------------------------------------------------------
describe("R1-2 — WS legacy API key and null tenant", () => {
	function connect(apiKey?: string) {
		const c = fakeWs();
		wsi.wss.emit("connection", c.ws, { apiKey, headers: {}, url: "/ws" });
		return c;
	}
	function drop(c: ReturnType<typeof fakeWs>) {
		c.ws.emit("close");
		wsi.clients.delete(c.ws);
	}

	it("accepts the env key and maps it to LOCAL_TENANT_ID (non-production)", () => {
		vi.stubEnv("OSCORPEX_AUTH_ENABLED", "true");
		vi.stubEnv("OSCORPEX_API_KEY", "r1-secret-key");
		const c = connect("r1-secret-key");
		try {
			expect(c.ws.close).not.toHaveBeenCalled();
			expect(wsi.clients.get(c.ws)?.tenantId).toBe(TENANT_LOCAL);
		} finally {
			drop(c);
		}
	});

	it("rejects the env key in production unless OSCORPEX_ALLOW_LEGACY_API_KEY=true", () => {
		vi.stubEnv("OSCORPEX_AUTH_ENABLED", "true");
		vi.stubEnv("OSCORPEX_API_KEY", "r1-secret-key");
		vi.stubEnv("NODE_ENV", "production");
		const denied = connect("r1-secret-key");
		try {
			expect(denied.ws.close).toHaveBeenCalled();
			expect(wsi.clients.has(denied.ws)).toBe(false);
		} finally {
			drop(denied);
		}

		vi.stubEnv("OSCORPEX_ALLOW_LEGACY_API_KEY", "true");
		const allowed = connect("r1-secret-key");
		try {
			expect(allowed.ws.close).not.toHaveBeenCalled();
			expect(wsi.clients.get(allowed.ws)?.tenantId).toBe(TENANT_LOCAL);
		} finally {
			drop(allowed);
		}
	});

	it("rejects a wrong key (same length, same prefix, shorter) ", () => {
		vi.stubEnv("OSCORPEX_AUTH_ENABLED", "true");
		vi.stubEnv("OSCORPEX_API_KEY", "r1-secret-key");
		for (const bad of ["r1-secret-kez", "r1-secret-ke", "r1-secret-key-and-more", ""]) {
			const c = connect(bad);
			try {
				expect(c.ws.close, `key "${bad}"`).toHaveBeenCalled();
				expect(wsi.clients.has(c.ws)).toBe(false);
			} finally {
				drop(c);
			}
		}
	});

	it("compares the key in constant time (shares the HTTP legacy-key helpers, no === on the secret)", () => {
		const src = readFileSync(join(__dirname, "..", "ws-manager.ts"), "utf8");
		expect(src).not.toMatch(/apiKey\s*===\s*envApiKey/);
		expect(src).toMatch(/timingSafeEqual|legacyKeyMatches/);
		expect(src).toMatch(/legacyKeyAllowed|OSCORPEX_ALLOW_LEGACY_API_KEY/);
	});

	it("with auth disabled the client tenant is LOCAL_TENANT_ID", () => {
		vi.stubEnv("OSCORPEX_AUTH_ENABLED", "false");
		const c = connect();
		try {
			expect(wsi.clients.get(c.ws)?.tenantId).toBe(TENANT_LOCAL);
		} finally {
			drop(c);
		}
	});

	it("a client with a null tenant receives no events at all", async () => {
		const P = `f3c-r1-null-${uid()}`;
		const c = fakeWs();
		wsi.clients.set(c.ws, { ws: c.ws, subscriptions: new Set([P]), lastPong: Date.now(), tenantId: null } as never);
		try {
			wsManager.broadcastToProject(P, {
				type: "event",
				projectId: P,
				payload: { id: "e1", projectId: P, tenantId: TENANT_A, type: "task:completed", payload: {} },
			});
			wsManager.broadcastToProject(P, { type: "event", projectId: P, payload: { id: "e2", type: "task:completed" } });
			await sleep(150);
			expect(c.sent).toEqual([]);
		} finally {
			wsi.clients.delete(c.ws);
		}
	});
});

// ---------------------------------------------------------------------------
// 3. Handler registration
// ---------------------------------------------------------------------------
describe("R1-3 — handler registration", () => {
	it("on() throws inside a tenant scope (boot-time only)", async () => {
		const off = vi.fn();
		await expect(
			runInTenant(TENANT_A, async () => {
				off.mockImplementation(bus.on("task:completed", () => {}));
			}),
		).rejects.toBeInstanceOf(TenantScopeError);
		off();
	});

	it("an onProject() handler registered in tenant A's scope never receives B's events", async () => {
		const got: TenantEvent[] = [];
		await runInTenant(TENANT_A, async () => {
			subscribe(bus.onProject(B.projectId, (e) => void got.push(e)));
		});
		const gotA: TenantEvent[] = [];
		await runInTenant(TENANT_A, async () => {
			subscribe(bus.onProject(A.projectId, (e) => void gotA.push(e)));
		});

		const marker = `r1-3-${uid()}`;
		await emitIn(TENANT_B, { projectId: B.projectId, type: "task:completed", payload: { marker } });
		await emitIn(TENANT_A, { projectId: A.projectId, type: "task:completed", payload: { marker } });

		await vi.waitFor(() => expect(gotA.filter((e) => e.payload.marker === marker)).toHaveLength(1), { timeout: 3000 });
		await sleep(200);
		expect(got).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 4. Tenant-less events run outside any scope, not as system
// ---------------------------------------------------------------------------
describe("R1-4 — tenant-less dispatch", () => {
	it("a handler of a project-less event observes currentScope() === undefined (not system)", async () => {
		const scopes: Array<ReturnType<typeof currentScope>> = [];
		subscribe(bus.on("provider:degraded", () => void scopes.push(currentScope())));

		await runAsSystem("f3c-r1", async () => {
			bus.emit({ projectId: "", type: "provider:degraded", payload: { provider: "claude" } });
		});

		await vi.waitFor(() => expect(scopes).toHaveLength(1), { timeout: 3000 });
		expect(scopes[0]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 5. NOTIFY hardening
// ---------------------------------------------------------------------------
describe("R1-5 — NOTIFY hardening", () => {
	it("a fresh event is still delivered (control)", async () => {
		const id = await seedEventRow(A.projectId, 1);
		const seen: TenantEvent[] = [];
		subscribe(bus.on("task:completed", (e) => void (e.id === id && seen.push(e))));
		listenerCallback?.({ id });
		await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 3000 });
	});

	it("an id whose event is older than 30 s is dropped and counted (no replay)", async () => {
		const id = await seedEventRow(A.projectId, 120);
		const seen: TenantEvent[] = [];
		subscribe(bus.on("task:completed", (e) => void (e.id === id && seen.push(e))));
		listenerCallback?.({ id });
		await vi.waitFor(() => expect(counters().notifyDropped).toBe(1), { timeout: 3000 });
		await sleep(150);
		expect(seen).toEqual([]);
	});

	it("a DB error during the re-read is counted in notifyDropped (and nothing is delivered)", async () => {
		const id = await seedEventRow(A.projectId, 1);
		const seen: TenantEvent[] = [];
		subscribe(bus.on("task:completed", (e) => void (e.id === id && seen.push(e))));
		dbHooks.eventTenantError = true;
		listenerCallback?.({ id });
		await vi.waitFor(() => expect(counters().notifyDropped).toBe(1), { timeout: 3000 });
		expect(seen).toEqual([]);
	});

	it("pg-listener does not log an unbounded untrusted payload", async () => {
		const junk = `NOT-JSON-${"x".repeat(5000)}`;
		vi.spyOn(pg.Client.prototype, "connect").mockResolvedValue(undefined as never);
		vi.spyOn(pg.Client.prototype, "query").mockResolvedValue({} as never);
		vi.spyOn(pg.Client.prototype, "end").mockResolvedValue(undefined as never);
		const realStart = vi.mocked(pgListener.start);
		realStart.mockRestore();
		try {
			await pgListener.start();
			const client = (pgListener as unknown as { client: EventEmitter | null }).client;
			expect(client).not.toBeNull();
			client?.emit("notification", { channel: "oscorpex_events", payload: junk });
			const logged = Object.values(loggers.get("pg-listener") ?? {})
				.flatMap((f) => (f.mock ? f.mock.calls : []))
				.map((args) => args.map((a: unknown) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
			expect(logged.join("\n")).not.toContain(junk);
			for (const line of logged) expect(line.length).toBeLessThan(1000);
		} finally {
			await pgListener.stop();
			vi.restoreAllMocks();
			vi.spyOn(pgListener, "start").mockResolvedValue(undefined);
		}
	});
});

// ---------------------------------------------------------------------------
// 6. Bridges propagate scope errors
// ---------------------------------------------------------------------------
describe("R1-6 — bridges do not swallow TenantScopeError", () => {
	async function expectScopeError(arm: () => void, called: () => unknown): Promise<void> {
		arm();
		await emitIn(TENANT_A, {
			projectId: A.projectId,
			type: "task:completed",
			payload: { title: `r1-6-${uid()}` },
		});
		await vi.waitFor(() => expect(called()).toBeTruthy(), { timeout: 3000 });
		await vi.waitFor(() => expect(counters().scopeErrors).toBeGreaterThanOrEqual(1), { timeout: 3000 });
	}

	it("notification bridge", async () => {
		await expectScopeError(
			() => vi.mocked(processEventForNotification).mockRejectedValueOnce(new TenantScopeError("scope")),
			() => vi.mocked(processEventForNotification).mock.calls.length,
		);
	});

	it("webhook bridge", async () => {
		await expectScopeError(
			() => vi.mocked(sendWebhookNotification).mockRejectedValueOnce(new TenantScopeError("scope")),
			() => vi.mocked(sendWebhookNotification).mock.calls.length,
		);
	});

	it("plugin bridge", async () => {
		await expectScopeError(
			() => vi.mocked(pluginRegistry.notifyPlugins).mockRejectedValueOnce(new TenantScopeError("scope")),
			() => vi.mocked(pluginRegistry.notifyPlugins).mock.calls.length,
		);
	});
});

// ---------------------------------------------------------------------------
// 8. Unscoped emit
// ---------------------------------------------------------------------------
describe("R1-8 — unscoped emit", () => {
	it("warn mode: the unscoped-emit warning is throttled per site", async () => {
		vi.stubEnv("OSCORPEX_TENANT_SCOPE_MODE", "warn");
		for (let i = 0; i < 5; i++) {
			bus.emitTransient({ projectId: A.projectId, type: "agent:output", payload: { i } });
		}
		await sleep(150);
		const warns = (loggers.get("event-bus")?.warn.mock.calls ?? []).filter((args) =>
			args.some((a: unknown) => typeof a === "string" && /outside a tenant/i.test(a)),
		);
		expect(warns.length).toBeLessThanOrEqual(1);
	});

	it("strict mode: a fire-and-forget emit does not throw out of emit/emitTransient; it is rejected and counted", async () => {
		const seen: TenantEvent[] = [];
		subscribe(bus.on("agent:output", (e) => void seen.push(e)));
		expect(() => bus.emit({ projectId: A.projectId, type: "agent:output", payload: {} })).not.toThrow();
		expect(() => bus.emitTransient({ projectId: A.projectId, type: "agent:output", payload: {} })).not.toThrow();
		await vi.waitFor(() => expect(counters().rejected).toBe(2), { timeout: 3000 });
		await sleep(150);
		expect(seen).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 9. Ordering and caching
// ---------------------------------------------------------------------------
describe("R1-9 — ordering and tenant lookup caching", () => {
	it("repeated system-scope emits for one project do at most one project-tenant lookup within the TTL", async () => {
		dbHooks.projectTenantCalls.length = 0;
		await runAsSystem("f3c-r1", async () => {
			for (let i = 0; i < 3; i++) {
				await bus.emitAsync({ projectId: A.projectId, type: "task:completed", payload: { i, title: "r1-9" } });
			}
		});
		expect(dbHooks.projectTenantCalls.filter((p) => p === A.projectId).length).toBeLessThanOrEqual(1);
	});

	it("events of one project keep their emission order across the tenant-scope and system-scope paths", async () => {
		const order: string[] = [];
		subscribe(bus.onProject(A.projectId, (e) => void order.push(String(e.payload.n))));
		// warm the tenant path so it resolves faster than the system path
		await runInTenant(TENANT_A, async () => {
			bus.emitTransient({ projectId: A.projectId, type: "agent:output", payload: { n: "warm" } });
		});
		await vi.waitFor(() => expect(order).toEqual(["warm"]), { timeout: 3000 });
		order.length = 0;

		const emitters = [
			(n: string) =>
				runAsSystem("f3c-r1", async () =>
					bus.emitTransient({ projectId: A.projectId, type: "agent:output", payload: { n } }),
				),
			(n: string) =>
				runInTenant(TENANT_A, async () =>
					bus.emitTransient({ projectId: A.projectId, type: "agent:output", payload: { n } }),
				),
		];
		const expected: string[] = [];
		for (let i = 0; i < 6; i++) {
			expected.push(`e${i}`);
			void emitters[i % 2](`e${i}`);
		}
		await vi.waitFor(() => expect(order).toHaveLength(6), { timeout: 3000 });
		expect(order).toEqual(expected);
	});
});

// ---------------------------------------------------------------------------
// 10. ws-cluster relay removed (plan F3-c: ws-cluster.ts:172-188)
// ---------------------------------------------------------------------------
describe("R1-10 — ws-cluster event relay is removed", () => {
	it("WsCluster no longer exposes broadcastToProject / subscribeToProject", () => {
		const cluster = new WsCluster(new InMemoryStateProvider(), "f3c-r1-instance") as unknown as Record<string, unknown>;
		expect(cluster.broadcastToProject).toBeUndefined();
		expect(cluster.subscribeToProject).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 11. notification-service tenancy
// ---------------------------------------------------------------------------
describe("R1-11 — notification-service derives the tenant from the project", () => {
	const realService = () => vi.importActual<typeof import("../notification-service.js")>("../notification-service.js");
	const eventFor = (projectId: string, title: string, tenantId?: string) =>
		({
			id: `f3c-r1-notif-${uid()}`,
			projectId,
			type: "task:completed",
			payload: { title },
			timestamp: new Date().toISOString(),
			...(tenantId ? { tenantId } : {}),
		}) as StudioEvent;

	it("a project whose tenant is NULL is skipped and nothing is written", async () => {
		const title = `r1-11-null-${uid()}`;
		dbHooks.projectTenant.set(A.projectId, null);
		const svc = await realService();
		// event.tenantId must not rescue the missing project tenant
		const result = await runAsSystem("f3c-r1", () =>
			svc.processEventForNotification(eventFor(A.projectId, title, TENANT_A)),
		).catch((err: unknown) => err);
		expect(result).toBeNull();
		const rows = await withMigrator((c) =>
			c.query("SELECT id FROM notifications WHERE project_id = $1 AND title LIKE $2", [A.projectId, `%${title}%`]),
		);
		expect(rows.rows).toHaveLength(0);
	});

	it("the written tenant comes from the project, not from a mismatching event.tenantId", async () => {
		const title = `r1-11-mismatch-${uid()}`;
		const svc = await realService();
		const result = await runAsSystem("f3c-r1", () =>
			svc.processEventForNotification(eventFor(A.projectId, title, TENANT_B)),
		).catch((err: unknown) => err);
		expect(result).not.toBeInstanceOf(Error);
		expect((result as { tenantId?: string } | null)?.tenantId).toBe(TENANT_A);
		const rows = await withMigrator((c) =>
			c.query<{ tenant_id: string }>("SELECT tenant_id FROM notifications WHERE project_id = $1 AND title LIKE $2", [
				A.projectId,
				`%${title}%`,
			]),
		);
		expect(rows.rows.map((r) => r.tenant_id)).toEqual([TENANT_A]);
	});
});
