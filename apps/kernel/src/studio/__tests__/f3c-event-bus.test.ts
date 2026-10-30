// ---------------------------------------------------------------------------
// F3-c — tenant-aware event bus, NOTIFY and transient events (plan scenarios 1-8).
// Strict-scope file: hooks and tests run outside the implicit scope (helpers/strict-scope.ts).
//
// Assumed API (not implemented yet):
//  - StudioEvent.tenantId: string, set by the bus; a caller-provided tenantId is ignored.
//  - event-bus.ts exports getEventBusCounters(): { rejected, handlerErrors, scopeErrors, notifyDropped } and
//    resetEventBusCounters().
//  - Handlers run inside runInTenant(event.tenantId); a project/tenant mismatch rejects the event (log.error + counter).
//  - NOTIFY payload is { id } only; the listener callback resolves the tenant with sys_event_tenant(id).
//  - WsCluster.broadcastToProject relay is removed (or at least refuses events without tenantId).
// ---------------------------------------------------------------------------

import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestContext } from "vitest";

const loggers = vi.hoisted(() => new Map<string, Record<string, ReturnType<typeof vi.fn>>>());

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
import { query } from "../pg.js";
import { notifyPlugins, pluginRegistry } from "../plugin-registry.js";
import { InMemoryStateProvider } from "../shared-state.js";
import { currentScope, runAsSystem, runInTenant, tenantScopeMode } from "../tenancy/tenant-scope.js";
import type { EventType, StudioEvent } from "../types.js";
import { sendWebhookNotification } from "../webhook-sender.js";
import { WsCluster } from "../ws-cluster.js";
import { wsManager } from "../ws-manager.js";
import { cleanupRunningProjects, seedRunningProjects } from "./helpers/background-fixtures.js";
import * as strictScope from "./helpers/strict-scope.js";
import { TENANT_A, TENANT_B, seedTestTenants, withMigrator } from "./helpers/tenancy.js";

// File-level strict scope (Part A.1 contract).
const useStrict = (strictScope as Record<string, unknown>).useStrictScopeForFile as (() => void) | undefined;
if (typeof useStrict === "function") useStrict();

type TenantEvent = StudioEvent & { tenantId: string };
type Counters = { rejected: number; handlerErrors: number; scopeErrors: number; notifyDropped: number };
type EmitInput = Omit<StudioEvent, "id" | "timestamp" | "tenantId">;

const bus = eventBus as unknown as {
	emit(data: unknown): void;
	emitTransient(data: unknown): void;
	on(type: EventType, h: (e: TenantEvent) => unknown): () => void;
	onProject(projectId: string, h: (e: TenantEvent) => unknown): () => void;
	initPgListener(): Promise<void>;
};

function counters(): Counters {
	const fn = (eventBusModule as Record<string, unknown>).getEventBusCounters;
	expect(typeof fn, "event-bus.ts must export getEventBusCounters()").toBe("function");
	return (fn as () => Counters)();
}

function resetCounters(): void {
	const fn = (eventBusModule as Record<string, unknown>).resetEventBusCounters;
	expect(typeof fn, "event-bus.ts must export resetEventBusCounters()").toBe("function");
	(fn as () => void)();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

let isSuper = true;
let A: { projectId: string };
let B: { projectId: string };
let listenerCallback: ((payload: unknown) => void) | undefined;
const offs: Array<() => void> = [];
const seededEventIds: string[] = [];

async function runtimeIsSuperuser(): Promise<boolean> {
	const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	try {
		const r = await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
		return r.rows[0]?.rolsuper === true;
	} finally {
		await client.end();
	}
}

/** Insert an event row as the migrator, bypassing the bus (a "foreign process" emit). Returns its id. */
async function seedEventRow(projectId: string, type: EventType = "task:completed"): Promise<string> {
	const id = `f3c-evt-${uid()}`;
	await withMigrator(async (c) => {
		await c.query(
			`INSERT INTO events (id, project_id, type, payload, timestamp, correlation_id)
			 VALUES ($1, $2, $3, '{"title":"foreign"}', now(), $4)`,
			[id, projectId, type, `corr-${id}`],
		);
	});
	seededEventIds.push(id);
	return id;
}

async function storedTenant(eventId: string): Promise<string | null> {
	return withMigrator(async (c) => {
		const r = await c.query<{ t: string | null }>("SELECT sys_event_tenant($1) AS t", [eventId]);
		return r.rows[0]?.t ?? null;
	});
}

async function countStoredEvents(projectId: string, marker: string): Promise<number> {
	return withMigrator(async (c) => {
		const r = await c.query<{ n: string }>(
			"SELECT count(*) AS n FROM events WHERE project_id = $1 AND payload LIKE $2",
			[projectId, `%${marker}%`],
		);
		return Number(r.rows[0].n);
	});
}

/** Collect every event a handler receives, with the scope and (async) DB view it ran with. */
function collector(opts: { readProjects?: boolean } = {}) {
	const seen: Array<{ event: TenantEvent; scope: ReturnType<typeof currentScope>; visibleProjects?: string[] }> = [];
	const handler = async (event: TenantEvent) => {
		const entry: (typeof seen)[number] = { event, scope: currentScope() };
		if (opts.readProjects) {
			const rows = await query<{ id: string }>("SELECT id FROM projects WHERE id = ANY($1) ORDER BY id", [
				[A.projectId, B.projectId],
			]);
			entry.visibleProjects = rows.map((r) => r.id);
		}
		seen.push(entry);
	};
	return { seen, handler };
}

function subscribe<T extends () => void>(off: T): T {
	offs.push(off);
	return off;
}

function emitIn(tenant: string, data: EmitInput & Record<string, unknown>): Promise<void> {
	return runInTenant(tenant, async () => {
		bus.emit(data);
	});
}

beforeAll(async () => {
	await seedTestTenants();
	isSuper = await runtimeIsSuperuser();
	await cleanupRunningProjects();
	const fx = await seedRunningProjects();
	A = fx.A;
	B = fx.B;

	// Capture the listener callback instead of opening a real LISTEN connection.
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
});

afterEach(() => {
	while (offs.length) offs.pop()?.();
});

describe("F3-c — setup sanity", () => {
	it("runs in strict mode outside the implicit scope", () => {
		expect(tenantScopeMode()).toBe("strict");
		expect(currentScope()).toBeUndefined();
	});

	it("captured the pg listener callback", () => {
		expect(typeof listenerCallback).toBe("function");
	});

	it("exposes counters with exactly the four documented keys, zeroed by resetEventBusCounters()", () => {
		resetCounters();
		expect(counters()).toEqual({ rejected: 0, handlerErrors: 0, scopeErrors: 0, notifyDropped: 0 });
	});
});

describe("F3-c scenario 1 — emit in tenant A for A's project", () => {
	it("stores the event with tenant A, stamps tenantId and runs handlers in A's scope (caller tenantId ignored)", async () => {
		const marker = `s1-${uid()}`;
		const { seen, handler } = collector();
		subscribe(bus.on("task:completed", handler));

		await emitIn(TENANT_A, {
			projectId: A.projectId,
			type: "task:completed",
			payload: { marker },
			tenantId: TENANT_B, // forged: must be ignored
		});

		await vi.waitFor(() => expect(seen.filter((s) => s.event.payload.marker === marker)).toHaveLength(1), {
			timeout: 3000,
		});
		const [got] = seen.filter((s) => s.event.payload.marker === marker);
		expect(got.event.tenantId).toBe(TENANT_A);
		expect(got.scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
		expect(await storedTenant(got.event.id)).toBe(TENANT_A);
		expect(await countStoredEvents(A.projectId, marker)).toBe(1);
	});

	it("handler DB reads see only A's data (RLS only)", async (ctx: TestContext) => {
		if (isSuper) ctx.skip(); // superuser bypasses RLS
		const marker = `s1rls-${uid()}`;
		const { seen, handler } = collector({ readProjects: true });
		subscribe(bus.on("task:completed", handler));

		await emitIn(TENANT_A, { projectId: A.projectId, type: "task:completed", payload: { marker } });

		await vi.waitFor(() => expect(seen.filter((s) => s.event.payload.marker === marker)).toHaveLength(1), {
			timeout: 3000,
		});
		const got = seen.find((s) => s.event.payload.marker === marker);
		expect(got?.visibleProjects).toEqual([A.projectId]);
	});
});

describe("F3-c scenario 2 — emit in A's scope for B's project is rejected", () => {
	it("increments rejected, logs an error, stores nothing and triggers no webhook/notification/plugin/handler", async () => {
		resetCounters();
		const marker = `s2-${uid()}`;
		const { seen, handler } = collector();
		subscribe(bus.on("task:completed", handler));
		subscribe(bus.onProject(B.projectId, handler));

		await emitIn(TENANT_A, { projectId: B.projectId, type: "task:completed", payload: { marker, title: "x" } });

		await vi.waitFor(() => expect(counters().rejected).toBe(1), { timeout: 3000 });
		await sleep(250); // give any wrongly-scheduled handler time to run
		expect(loggers.get("event-bus")?.error).toHaveBeenCalled();
		expect(await countStoredEvents(B.projectId, marker)).toBe(0);
		expect(seen).toHaveLength(0);
		expect(sendWebhookNotification).not.toHaveBeenCalled();
		expect(processEventForNotification).not.toHaveBeenCalled();
		expect(notifyPlugins).not.toHaveBeenCalled();
		expect(pluginRegistry.notifyPlugins).not.toHaveBeenCalled();
	});
});

describe("F3-c scenario 3 — system-scope emit resolves the tenant from the project", () => {
	it("tags the event with B (sys_project_tenant) and runs the handler in B's scope", async () => {
		const marker = `s3-${uid()}`;
		const { seen, handler } = collector();
		subscribe(bus.on("task:completed", handler));

		await runAsSystem("f3c-test", async () => {
			bus.emit({ projectId: B.projectId, type: "task:completed", payload: { marker } });
		});

		await vi.waitFor(() => expect(seen.filter((s) => s.event.payload.marker === marker)).toHaveLength(1), {
			timeout: 3000,
		});
		const got = seen.find((s) => s.event.payload.marker === marker);
		expect(got?.event.tenantId).toBe(TENANT_B);
		expect(got?.scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
		expect(await storedTenant(got?.event.id ?? "")).toBe(TENANT_B);
	});
});

describe("F3-c scenario 4 — handler errors are isolated", () => {
	it("a throwing sync handler, an async rejection and a scope error do not stop the other handlers; counters rise", async () => {
		resetCounters();
		const marker = `s4-${uid()}`;
		const ok = vi.fn();
		const later = vi.fn();
		subscribe(
			bus.on("task:completed", () => {
				throw new Error("sync boom");
			}),
		);
		subscribe(
			bus.on("task:completed", async () => {
				throw new Error("async boom");
			}),
		);
		subscribe(
			bus.on("task:completed", async () => {
				// A handler runs inside A's scope: entering another tenant is a scope error.
				await runInTenant(TENANT_B, async () => {});
			}),
		);
		subscribe(bus.on("task:completed", (e) => (e.payload.marker === marker ? ok() : undefined)));
		subscribe(bus.onProject(A.projectId, (e) => (e.payload.marker === marker ? later() : undefined)));

		await emitIn(TENANT_A, { projectId: A.projectId, type: "task:completed", payload: { marker } });

		await vi.waitFor(() => expect(ok).toHaveBeenCalledTimes(1), { timeout: 3000 });
		await vi.waitFor(() => expect(later).toHaveBeenCalledTimes(1), { timeout: 3000 });
		await vi.waitFor(() => expect(counters().handlerErrors).toBeGreaterThanOrEqual(2), { timeout: 3000 });
		expect(counters().scopeErrors).toBeGreaterThanOrEqual(1);
	});
});

describe("F3-c scenario 5 — mixed batches stay per tenant", () => {
	it("A and B events emitted in the same tick: each handler invocation runs in its own event's tenant", async () => {
		const markerA = `s5a-${uid()}`;
		const markerB = `s5b-${uid()}`;
		const { seen, handler } = collector();
		subscribe(bus.on("task:completed", handler));

		await Promise.all([
			emitIn(TENANT_A, { projectId: A.projectId, type: "task:completed", payload: { marker: markerA } }),
			emitIn(TENANT_B, { projectId: B.projectId, type: "task:completed", payload: { marker: markerB } }),
		]);

		await vi.waitFor(
			() => expect(seen.filter((s) => [markerA, markerB].includes(s.event.payload.marker as string))).toHaveLength(2),
			{ timeout: 3000 },
		);
		const a = seen.find((s) => s.event.payload.marker === markerA);
		const b = seen.find((s) => s.event.payload.marker === markerB);
		expect(a?.event.tenantId).toBe(TENANT_A);
		expect(a?.scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
		expect(b?.event.tenantId).toBe(TENANT_B);
		expect(b?.scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
	});

	it("each handler invocation sees only its own tenant's data (RLS only)", async (ctx: TestContext) => {
		if (isSuper) ctx.skip();
		const markerA = `s5ra-${uid()}`;
		const markerB = `s5rb-${uid()}`;
		const { seen, handler } = collector({ readProjects: true });
		subscribe(bus.on("task:completed", handler));

		await Promise.all([
			emitIn(TENANT_A, { projectId: A.projectId, type: "task:completed", payload: { marker: markerA } }),
			emitIn(TENANT_B, { projectId: B.projectId, type: "task:completed", payload: { marker: markerB } }),
		]);

		await vi.waitFor(
			() => expect(seen.filter((s) => [markerA, markerB].includes(s.event.payload.marker as string))).toHaveLength(2),
			{ timeout: 3000 },
		);
		expect(seen.find((s) => s.event.payload.marker === markerA)?.visibleProjects).toEqual([A.projectId]);
		expect(seen.find((s) => s.event.payload.marker === markerB)?.visibleProjects).toEqual([B.projectId]);
	});

	it("ws-manager batching: a mixed batch is filtered per message, each client gets only its own tenant's events", async () => {
		const P = `f3c-shared-${uid()}`;
		const mk = (tenantId: string | null) => {
			const sent: string[] = [];
			const ws = { readyState: 1, send: (d: string) => sent.push(d), on: vi.fn(), close: vi.fn() };
			return { ws, sent, record: { ws, subscriptions: new Set([P]), lastPong: Date.now(), tenantId } };
		};
		const cA = mk(TENANT_A);
		const cB = mk(TENANT_B);
		const clients = (wsManager as unknown as { clients: Map<unknown, unknown> }).clients;
		clients.set(cA.ws, cA.record);
		clients.set(cB.ws, cB.record);
		try {
			const evt = (id: string, tenantId: string) => ({
				type: "event" as const,
				projectId: P,
				payload: {
					id,
					projectId: P,
					tenantId,
					type: "task:completed",
					payload: {},
					timestamp: new Date().toISOString(),
				},
			});
			wsManager.broadcastToProject(P, evt("e-a1", TENANT_A));
			wsManager.broadcastToProject(P, evt("e-b1", TENANT_B));
			wsManager.broadcastToProject(P, evt("e-a2", TENANT_A));
			await sleep(150); // > 50ms flush window

			const ids = (c: { sent: string[] }) =>
				c.sent
					.flatMap((d) => {
						const parsed = JSON.parse(d);
						return Array.isArray(parsed) ? parsed : [parsed];
					})
					.map((m: { payload: { id: string } }) => m.payload.id)
					.sort();
			expect(ids(cA)).toEqual(["e-a1", "e-a2"]);
			expect(ids(cB)).toEqual(["e-b1"]);
		} finally {
			clients.delete(cA.ws);
			clients.delete(cB.ws);
		}
	});
});

describe("F3-c scenario 6 — NOTIFY", () => {
	it("a valid id is delivered once, in the tenant resolved by sys_event_tenant", async () => {
		const id = await seedEventRow(A.projectId);
		const { seen, handler } = collector();
		subscribe(bus.on("task:completed", handler));

		listenerCallback?.({ id });

		await vi.waitFor(() => expect(seen.filter((s) => s.event.id === id)).toHaveLength(1), { timeout: 3000 });
		await sleep(150);
		const got = seen.filter((s) => s.event.id === id);
		expect(got).toHaveLength(1);
		expect(got[0].event.tenantId).toBe(TENANT_A);
		expect(got[0].scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
	});

	it("a forged payload (wrong tenantId/projectId) is ineffective: delivery follows sys_event_tenant(id)", async () => {
		const idB = await seedEventRow(B.projectId);
		const { seen, handler } = collector();
		const wrongProject = vi.fn();
		subscribe(bus.on("task:completed", handler));
		subscribe(bus.onProject(A.projectId, wrongProject));

		listenerCallback?.({ id: idB, projectId: A.projectId, tenantId: TENANT_A, type: "task:completed" });

		await vi.waitFor(() => expect(seen.filter((s) => s.event.id === idB)).toHaveLength(1), { timeout: 3000 });
		await sleep(150);
		const got = seen.find((s) => s.event.id === idB);
		expect(got?.event.projectId).toBe(B.projectId);
		expect(got?.event.tenantId).toBe(TENANT_B);
		expect(got?.scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
		expect(wrongProject).not.toHaveBeenCalled();
	});

	it("an unknown id is dropped and counted (notifyDropped); a malformed payload delivers nothing and does not throw", async () => {
		resetCounters();
		const { seen, handler } = collector();
		subscribe(bus.on("task:completed", handler));

		listenerCallback?.({ id: `f3c-unknown-${uid()}` });

		await vi.waitFor(() => expect(counters().notifyDropped).toBe(1), { timeout: 3000 });
		expect(() => listenerCallback?.({})).not.toThrow();
		await sleep(150);
		expect(seen).toHaveLength(0);
	});

	it("the NOTIFY payload emitted by the bus carries only the id", async () => {
		const listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await listener.connect();
		const payloads: string[] = [];
		listener.on("notification", (m) => {
			if (m.payload) payloads.push(m.payload);
		});
		try {
			await listener.query("LISTEN oscorpex_events");
			const marker = `s6n-${uid()}`;
			const { seen, handler } = collector();
			subscribe(bus.on("task:completed", handler));
			await emitIn(TENANT_A, { projectId: A.projectId, type: "task:completed", payload: { marker } });
			await vi.waitFor(() => expect(seen.filter((s) => s.event.payload.marker === marker)).toHaveLength(1), {
				timeout: 3000,
			});
			const id = seen.find((s) => s.event.payload.marker === marker)?.event.id ?? "";
			await vi.waitFor(() => expect(payloads.some((p) => p.includes(id))).toBe(true), { timeout: 3000 });
			const mine = payloads.filter((p) => p.includes(id)).map((p) => JSON.parse(p));
			expect(mine.length).toBeGreaterThan(0);
			for (const p of mine) expect(Object.keys(p)).toEqual(["id"]);
		} finally {
			await listener.end();
		}
	});
});

describe("F3-c scenario 7 — transient events", () => {
	it("agent:output carries tenantId (caller value ignored) and runs handlers in the event's tenant", async () => {
		const marker = `s7-${uid()}`;
		const { seen, handler } = collector();
		subscribe(bus.on("agent:output", handler));

		await runInTenant(TENANT_A, async () => {
			bus.emitTransient({
				projectId: A.projectId,
				type: "agent:output",
				payload: { marker },
				tenantId: TENANT_B, // forged
			});
		});

		await vi.waitFor(() => expect(seen.filter((s) => s.event.payload.marker === marker)).toHaveLength(1), {
			timeout: 3000,
		});
		const got = seen.find((s) => s.event.payload.marker === marker);
		expect(got?.event.tenantId).toBe(TENANT_A);
		expect(got?.scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
	});

	it("A's and B's transient events reach only subscribers of their own project/tenant", async () => {
		const markerA = `s7a-${uid()}`;
		const markerB = `s7b-${uid()}`;
		const forA = collector();
		const forB = collector();
		subscribe(bus.onProject(A.projectId, forA.handler));
		subscribe(bus.onProject(B.projectId, forB.handler));

		await runInTenant(TENANT_A, async () => {
			bus.emitTransient({ projectId: A.projectId, type: "agent:output", payload: { marker: markerA } });
		});
		await runInTenant(TENANT_B, async () => {
			bus.emitTransient({ projectId: B.projectId, type: "agent:output", payload: { marker: markerB } });
		});

		await vi.waitFor(() => expect(forA.seen).toHaveLength(1), { timeout: 3000 });
		await vi.waitFor(() => expect(forB.seen).toHaveLength(1), { timeout: 3000 });
		expect(forA.seen[0].event.tenantId).toBe(TENANT_A);
		expect(forA.seen[0].scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
		expect(forB.seen[0].event.tenantId).toBe(TENANT_B);
		expect(forB.seen[0].scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
	});

	it("a transient emitted in A's scope for B's project is rejected and reaches nobody", async () => {
		resetCounters();
		const { seen, handler } = collector();
		subscribe(bus.on("agent:output", handler));
		subscribe(bus.onProject(B.projectId, handler));

		await runInTenant(TENANT_A, async () => {
			bus.emitTransient({ projectId: B.projectId, type: "agent:output", payload: { marker: `s7x-${uid()}` } });
		});

		await vi.waitFor(() => expect(counters().rejected).toBe(1), { timeout: 3000 });
		await sleep(150);
		expect(seen).toHaveLength(0);
	});
});

describe("F3-c scenario 8 — notifications get the project's tenant", () => {
	it("a notification created from an A event (through the notification bridge) has tenant A, not NULL", async () => {
		const marker = `s8-${uid()}`;
		await emitIn(TENANT_A, {
			projectId: A.projectId,
			type: "task:completed",
			payload: { marker, title: `Done ${marker}` },
		});

		await vi.waitFor(() => expect(processEventForNotification).toHaveBeenCalled(), { timeout: 3000 });
		const rows = await vi.waitFor(
			async () => {
				const r = await withMigrator((c) =>
					c.query<{ tenant_id: string | null }>(
						"SELECT tenant_id FROM notifications WHERE project_id = $1 AND title LIKE $2",
						[A.projectId, `%${marker}%`],
					),
				);
				expect(r.rows.length).toBeGreaterThan(0);
				return r.rows;
			},
			{ timeout: 3000 },
		);
		for (const row of rows) expect(row.tenant_id).toBe(TENANT_A);
	});

	it("processEventForNotification derives the tenant from the project when called from system scope (B)", async () => {
		const marker = `s8b-${uid()}`;
		const event = {
			id: `f3c-notif-${uid()}`,
			projectId: B.projectId,
			type: "task:completed" as const,
			payload: { title: `Done ${marker}` },
			timestamp: new Date().toISOString(),
		};
		const orig = await vi.importActual<typeof import("../notification-service.js")>("../notification-service.js");
		const notif = await runAsSystem("f3c-test", () => orig.processEventForNotification(event as StudioEvent));
		expect(notif).not.toBeNull();
		expect(notif?.tenantId).toBe(TENANT_B);
	});
});

describe("F3-c ws-cluster — event relay without tenant is removed", () => {
	it("WsCluster no longer exposes the project event relay", () => {
		const cluster = new WsCluster(new InMemoryStateProvider(), "f3c-instance") as unknown as Record<string, unknown>;
		expect(cluster.broadcastToProject).toBeUndefined();
		expect(cluster.subscribeToProject).toBeUndefined();
	});
});
