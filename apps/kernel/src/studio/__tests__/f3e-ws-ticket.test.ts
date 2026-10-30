// ---------------------------------------------------------------------------
// F3-e — WebSocket ticket auth (plan scenarios 1-7 and the kernel half of 9).
// Real sockets on 127.0.0.1:0, real DB, real auth middleware.
//
// Assumed API (implemented in ws-ticket.ts / ws-server.ts):
//  - src/studio/ws-ticket.ts exports
//      issueWsTicket(identity: { userId, tenantId, role, isPlatformAdmin, tokenExpiresAt?: number /* epoch ms */ })
//        => { ticket: string; expiresIn: 30 }
//      consumeWsTicket(ticket: string): (identity & { tokenExpiresAt?: number }) | null  (single use)
//    The clock is Date.now(): tests age a ticket by spying on Date.now (no injected clock).
//  - POST /ws/ticket (studioRoutes, normal auth + access guard) => 200 { ticket, expiresIn: 30 }.
//    The ticket's tokenExpiresAt is the caller's JWT exp (ms).
//  - Ticket transport: query param `?ticket=<ticket>` on the WS URL (no Sec-WebSocket-Protocol).
//  - ws-server.ts: startWSServer(opts?: { port?: number }) returns the listening http.Server. The upgrade is
//    rejected BEFORE the handshake: 401 for missing/invalid/reused/expired ticket (or deleted user), 403 for a
//    foreign/"null" Origin. A request with no Origin header (non-browser client) is not covered here.
//    Env is read per upgrade (OSCORPEX_CORS_ORIGINS, OSCORPEX_DEV_NO_AUTH, NODE_ENV, HOST).
//  - Errors on subscribe: { type: "error", payload: { message } } — identical for foreign and missing projects.
//  - Expiry / deleted user close the socket (any close code).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LOCAL_TENANT_ID } from "../auth/auth-middleware.js";
import { verifyJwt } from "../auth/jwt.js";
import * as projectAccess from "../auth/project-access.js";
import { studioRoutes } from "../index.js";
import { getWsConfig } from "../performance-config.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { wsManager } from "../ws-manager.js";
import * as wsServerModule from "../ws-server.js";
import { cleanup, registerCleanup, seedDbKey } from "./helpers/f2r3-fixtures.js";
import { type SeededUser, removeUsers, seedUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, seedTestTenants, withMigrator } from "./helpers/tenancy.js";

type Identity = { userId: string; tenantId: string; role: string; isPlatformAdmin: boolean; tokenExpiresAt?: number };
type TicketModule = {
	issueWsTicket(i: Identity): { ticket: string; expiresIn: number };
	consumeWsTicket(t: string): (Identity & { tokenExpiresAt?: number }) | null;
};

async function ticketModule(): Promise<TicketModule> {
	// Dynamic import with a variable path: the module does not exist yet, so the failure is a test failure,
	// not a file-level resolution error that hides the other scenarios.
	const path = fileURLToPath(new URL("../ws-ticket.ts", import.meta.url));
	return (await import(/* @vite-ignore */ path)) as TicketModule;
}

const ENV_KEYS = [
	"OSCORPEX_AUTH_ENABLED",
	"OSCORPEX_DEV_NO_AUTH",
	"OSCORPEX_API_KEY",
	"NODE_ENV",
	"HOST",
	"OSCORPEX_CORS_ORIGINS",
	"OSCORPEX_WS_SESSION_MAX_MS",
] as const;
let saved: Record<string, string | undefined> = {};

const ORIGIN_OK = "http://localhost:5161";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const P_A = "f3e-proj-a";
const P_A2 = "f3e-proj-a2";
const P_B = "f3e-proj-b";
// projects.tenant_id is NOT NULL after F2, so a tenant-less project can only be modelled as a missing one.
const P_NULL = "f3e-proj-null-never-inserted";
const P_LOCAL = "f3e-proj-local";
const LIMIT_PROJECTS = Array.from({ length: 51 }, (_, i) => `f3e-lim-${String(i).padStart(2, "0")}`);

registerCleanup();

let httpServer: import("node:http").Server;
let port = 0;
let userA: SeededUser;
let userB: SeededUser;
let userC: SeededUser;
const extraUsers: string[] = [];

beforeAll(async () => {
	await seedTestTenants();
	userA = await seedUser({ tenantId: TENANT_A, id: "f3e-user-a" });
	userB = await seedUser({ tenantId: TENANT_B, id: "f3e-user-b" });
	userC = await seedUser({ tenantId: TENANT_A, id: "f3e-user-c" });
	await withMigrator(async (c) => {
		const rows: Array<[string, string]> = [
			[P_A, TENANT_A],
			[P_A2, TENANT_A],
			[P_B, TENANT_B],
			[P_LOCAL, LOCAL_TENANT_ID],
			...LIMIT_PROJECTS.map((id): [string, string] => [id, TENANT_A]),
		];
		for (const [id, tenant] of rows) {
			await c.query(
				`INSERT INTO projects (id, name, status, created_at, updated_at, tenant_id)
				 VALUES ($1, $1, 'idle', now(), now(), $2)
				 ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
				[id, tenant],
			);
		}
	});
	const start = (wsServerModule as unknown as { startWSServer: (o?: { port?: number }) => unknown }).startWSServer;
	httpServer = start({ port: 0 }) as import("node:http").Server;
	if (httpServer && !httpServer.listening) await new Promise<void>((r) => httpServer.once("listening", () => r()));
	port = httpServer ? (httpServer.address() as AddressInfo).port : 0;
});

afterAll(async () => {
	wsManager.shutdown();
	await new Promise<void>((r) => (httpServer ? httpServer.close(() => r()) : r()));
	const ids = [P_A, P_A2, P_B, P_LOCAL, ...LIMIT_PROJECTS];
	await withMigrator(async (c) => {
		await c.query("DELETE FROM projects WHERE id = ANY($1)", [ids]);
	});
	await removeUsers(["f3e-user-a", "f3e-user-b", "f3e-user-c", ...extraUsers]);
});

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
	process.env.OSCORPEX_AUTH_ENABLED = "true";
	process.env.NODE_ENV = "test";
});
afterEach(() => {
	vi.restoreAllMocks();
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requestTicket(headers: Record<string, string> = {}) {
	return runOutsideScope(async () => studioRoutes.request("/ws/ticket", { method: "POST", headers }));
}

async function ticketFor(user: SeededUser): Promise<string> {
	const res = await requestTicket({ Authorization: `Bearer ${user.token}` });
	expect(res.status).toBe(200);
	return ((await res.json()) as { ticket: string }).ticket;
}

type Outcome = { ok: true; ws: WebSocket } | { ok: false; status: number };

function connect(query: string, origin: string | null = ORIGIN_OK): Promise<Outcome> {
	return new Promise((resolve) => {
		const headers: Record<string, string> = {};
		if (origin !== null) headers.Origin = origin;
		const ws = new WebSocket(`ws://127.0.0.1:${port}/api/studio/ws${query}`, { headers });
		ws.once("open", () => resolve({ ok: true, ws }));
		ws.once("unexpected-response", (_req, res) => {
			resolve({ ok: false, status: res.statusCode ?? 0 });
			ws.terminate();
		});
		ws.once("error", () => resolve({ ok: false, status: 0 }));
	});
}

const open: WebSocket[] = [];
async function connectTicket(ticket: string, origin: string | null = ORIGIN_OK): Promise<Outcome> {
	const r = await connect(`?ticket=${encodeURIComponent(ticket)}`, origin);
	if (r.ok) open.push(r.ws);
	return r;
}
afterEach(() => {
	for (const ws of open.splice(0)) ws.terminate();
});

function mustOpen(r: Outcome): WebSocket {
	if (!r.ok) throw new Error(`expected an open socket, got HTTP ${r.status}`);
	return r.ws;
}

interface Inbox {
	messages: Array<Record<string, unknown>>;
	closed: Promise<number>;
	waitFor(pred: (m: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown>>;
}
function inbox(ws: WebSocket): Inbox {
	const messages: Array<Record<string, unknown>> = [];
	ws.on("message", (raw) => {
		const parsed = JSON.parse(raw.toString());
		for (const m of Array.isArray(parsed) ? parsed : [parsed]) messages.push(m);
	});
	const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
	return {
		messages,
		closed,
		async waitFor(pred, ms = 3000) {
			const start = Date.now();
			for (;;) {
				const hit = messages.find(pred);
				if (hit) return hit;
				if (Date.now() - start > ms) throw new Error(`timeout; got ${JSON.stringify(messages)}`);
				await sleep(20);
			}
		},
	};
}

const subscribe = (ws: WebSocket, projectId: string) => ws.send(JSON.stringify({ type: "subscribe", projectId }));
const isReplyFor = (projectId: string) => (m: Record<string, unknown>) =>
	m.type === "error" || (m.type === "subscribed" && m.projectId === projectId);

async function subscribeAndWait(ws: WebSocket, box: Inbox, projectId: string): Promise<Record<string, unknown>> {
	const before = box.messages.length;
	subscribe(ws, projectId);
	const start = Date.now();
	for (;;) {
		const hit = box.messages.slice(before).find(isReplyFor(projectId));
		if (hit) return hit;
		if (Date.now() - start > 3000) throw new Error(`no reply to subscribe ${projectId}`);
		await sleep(20);
	}
}

// ---------------------------------------------------------------------------
// 1. Ticket issue
// ---------------------------------------------------------------------------

describe("F3-e 1 — ticket issue", () => {
	it("POST /ws/ticket without credentials is 401", async () => {
		const res = await requestTicket();
		expect(res.status).toBe(401);
	});

	it("a valid JWT gets { ticket, expiresIn: 30 }; the ticket is 32 random bytes, base64url", async () => {
		const res = await requestTicket({ Authorization: `Bearer ${userA.token}` });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ticket: string; expiresIn: number };
		expect(body.expiresIn).toBe(30);
		expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const second = (await (await requestTicket({ Authorization: `Bearer ${userA.token}` })).json()) as {
			ticket: string;
		};
		expect(second.ticket).not.toBe(body.ticket);
	});

	it("the ticket is bound to user, tenant, role, admin flag and the JWT expiry", async () => {
		const { consumeWsTicket } = await ticketModule();
		const identity = consumeWsTicket(await ticketFor(userA));
		expect(identity).toMatchObject({
			userId: userA.id,
			tenantId: TENANT_A,
			role: "owner",
			isPlatformAdmin: false,
		});
		const exp = verifyJwt(userA.token)?.exp as number;
		expect(identity?.tokenExpiresAt).toBe(exp * 1000);
	});

	it("a ticket works once: the second connect with it is 401", async () => {
		const ticket = await ticketFor(userA);
		const first = await connectTicket(ticket);
		expect(first.ok).toBe(true);
		const second = await connectTicket(ticket);
		expect(second).toEqual({ ok: false, status: 401 });
	});

	it("a ticket older than 30 s is rejected (Date.now is the clock)", async () => {
		const ticket = await ticketFor(userA);
		const real = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(real + 31_000);
		const r = await connectTicket(ticket);
		vi.restoreAllMocks();
		expect(r).toEqual({ ok: false, status: 401 });
	});

	it("a ticket just inside the window is accepted", async () => {
		const ticket = await ticketFor(userA);
		const real = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(real + 20_000);
		const r = await connectTicket(ticket);
		vi.restoreAllMocks();
		expect(r.ok).toBe(true);
	});

	it("a ticket of a user deleted after issue is rejected at connect", async () => {
		const gone = await seedUser({ tenantId: TENANT_A, id: "f3e-user-gone" });
		extraUsers.push(gone.id);
		const ticket = await ticketFor(gone);
		await removeUsers([gone.id]);
		const r = await connectTicket(ticket);
		expect(r).toEqual({ ok: false, status: 401 });
	});

	it("the legacy env API key obtains a ticket over HTTP, bound to the local tenant", async () => {
		process.env.OSCORPEX_API_KEY = "f3e-legacy-key";
		const res = await requestTicket({ Authorization: "Bearer f3e-legacy-key" });
		expect(res.status).toBe(200);
		const { consumeWsTicket } = await ticketModule();
		const identity = consumeWsTicket(((await res.json()) as { ticket: string }).ticket);
		expect(identity?.tenantId).toBe(LOCAL_TENANT_ID);
	});
});

// ---------------------------------------------------------------------------
// 2. Connect
// ---------------------------------------------------------------------------

describe("F3-e 2 — connect", () => {
	it("startWSServer({ port: 0 }) returns the listening http.Server", () => {
		expect(httpServer?.listening).toBe(true);
	});

	it("no ticket is 401", async () => {
		expect(await connect("")).toEqual({ ok: false, status: 401 });
	});

	it("an invalid ticket is 401", async () => {
		expect(await connectTicket("A".repeat(43))).toEqual({ ok: false, status: 401 });
	});

	it("the old ?token=<jwt> style is 401", async () => {
		expect(await connect(`?token=${encodeURIComponent(userA.token)}`)).toEqual({ ok: false, status: 401 });
	});

	it("the old ?apiKey=<env key> style is 401 (legacy key path removed from the WS)", async () => {
		process.env.OSCORPEX_API_KEY = "f3e-legacy-key";
		expect(await connect("?apiKey=f3e-legacy-key")).toEqual({ ok: false, status: 401 });
	});

	it("a foreign Origin is 403 even with a valid ticket", async () => {
		const r = await connectTicket(await ticketFor(userA), "http://evil.example");
		expect(r).toEqual({ ok: false, status: 403 });
	});

	it('a "null" Origin is 403', async () => {
		const r = await connectTicket(await ticketFor(userA), "null");
		expect(r).toEqual({ ok: false, status: 403 });
	});

	it("the default allowlist includes http://localhost:5161", async () => {
		const r = await connectTicket(await ticketFor(userA), "http://localhost:5161");
		expect(r.ok).toBe(true);
	});

	it("OSCORPEX_CORS_ORIGINS is honoured per upgrade", async () => {
		process.env.OSCORPEX_CORS_ORIGINS = "https://studio.example.com";
		expect(await connectTicket(await ticketFor(userA), "https://studio.example.com")).toMatchObject({ ok: true });
		expect(await connectTicket(await ticketFor(userA), "http://localhost:5161")).toEqual({
			ok: false,
			status: 403,
		});
	});

	it("binds to 127.0.0.1 outside production when HOST is unset", () => {
		expect((httpServer?.address() as AddressInfo | undefined)?.address).toBe("127.0.0.1");
	});
});

// ---------------------------------------------------------------------------
// 3. Subscribe
// ---------------------------------------------------------------------------

describe("F3-e 3 — subscribe", () => {
	it("own project succeeds", async () => {
		const ws = mustOpen(await connectTicket(await ticketFor(userA)));
		const box = inbox(ws);
		const reply = await subscribeAndWait(ws, box, P_A);
		expect(reply).toMatchObject({ type: "subscribed", projectId: P_A });
	});

	it("B's project, a missing project and a tenant-less project give the identical error", async () => {
		const ws = mustOpen(await connectTicket(await ticketFor(userA)));
		const box = inbox(ws);
		const foreign = await subscribeAndWait(ws, box, P_B);
		const missing = await subscribeAndWait(ws, box, "f3e-does-not-exist");
		const nullTenant = await subscribeAndWait(ws, box, P_NULL);
		expect(foreign.type).toBe("error");
		expect(JSON.stringify(foreign)).toBe(JSON.stringify(missing));
		expect(JSON.stringify(nullTenant)).toBe(JSON.stringify(missing));
		expect(box.messages.some((m) => m.type === "subscribed")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 4. Event isolation
// ---------------------------------------------------------------------------

describe("F3-e 4 — event isolation", () => {
	const evt = (id: string, tenantId: string, type = "task:completed") => ({
		type: "event" as const,
		projectId: P_A,
		payload: { id, projectId: P_A, tenantId, type, payload: {}, timestamp: new Date().toISOString() },
	});

	it("A's socket never receives B's events: mixed batch and transient agent:output", async () => {
		const ws = mustOpen(await connectTicket(await ticketFor(userA)));
		const box = inbox(ws);
		await subscribeAndWait(ws, box, P_A);

		wsManager.broadcastToProject(P_A, evt("e-a1", TENANT_A));
		wsManager.broadcastToProject(P_A, evt("e-b1", TENANT_B));
		wsManager.broadcastToProject(P_A, evt("e-b-out", TENANT_B, "agent:output"));
		wsManager.broadcastToProject(P_A, evt("e-a-out", TENANT_A, "agent:output"));
		wsManager.broadcastToProject(P_A, evt("e-a2", TENANT_A));
		await sleep(200);

		const ids = box.messages
			.filter((m) => m.type === "event")
			.map((m) => (m.payload as { id: string }).id)
			.sort();
		expect(ids).toEqual(["e-a-out", "e-a1", "e-a2"]);
	});
});

// ---------------------------------------------------------------------------
// 5. Session end
// ---------------------------------------------------------------------------

describe("F3-e 5 — session end", () => {
	it("the socket closes when the bound token expiry passes", async () => {
		const { issueWsTicket } = await ticketModule();
		const { ticket } = issueWsTicket({
			userId: userA.id,
			tenantId: TENANT_A,
			role: "owner",
			isPlatformAdmin: false,
			tokenExpiresAt: Date.now() + 500,
		});
		const ws = mustOpen(await connectTicket(ticket));
		const box = inbox(ws);
		const started = Date.now();
		await Promise.race([box.closed, sleep(3000).then(() => Promise.reject(new Error("socket stayed open")))]);
		expect(Date.now() - started).toBeGreaterThan(200);
	});

	it("a ticket whose token already expired does not open a session", async () => {
		const { issueWsTicket } = await ticketModule();
		const { ticket } = issueWsTicket({
			userId: userA.id,
			tenantId: TENANT_A,
			role: "owner",
			isPlatformAdmin: false,
			tokenExpiresAt: Date.now() - 1000,
		});
		expect((await connectTicket(ticket)).ok).toBe(false);
	});

	it("a user deleted mid-session: the socket closes on the next subscribe", async () => {
		const gone = await seedUser({ tenantId: TENANT_A, id: "f3e-user-mid" });
		extraUsers.push(gone.id);
		const ws = mustOpen(await connectTicket(await ticketFor(gone)));
		const box = inbox(ws);
		expect(await subscribeAndWait(ws, box, P_A)).toMatchObject({ type: "subscribed" });
		await removeUsers([gone.id]);
		subscribe(ws, P_A2);
		await Promise.race([box.closed, sleep(3000).then(() => Promise.reject(new Error("socket stayed open")))]);
		expect(box.messages.some((m) => m.type === "subscribed" && m.projectId === P_A2)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 6. Limits
// ---------------------------------------------------------------------------

describe("F3-e 6 — limits", () => {
	it("a message over 64 KB closes the socket (1009)", async () => {
		const ws = mustOpen(await connectTicket(await ticketFor(userA)));
		const box = inbox(ws);
		ws.send(JSON.stringify({ type: "ping", pad: "x".repeat(70 * 1024) }));
		expect(await Promise.race([box.closed, sleep(3000).then(() => -1)])).toBe(1009);
	});

	it("a message just under 64 KB is still served", async () => {
		const ws = mustOpen(await connectTicket(await ticketFor(userA)));
		const box = inbox(ws);
		ws.send(JSON.stringify({ type: "ping", pad: "x".repeat(60 * 1024) }));
		await box.waitFor((m) => m.type === "pong");
	});

	it("the 51st subscription is rejected, the first 50 succeed", async () => {
		const ws = mustOpen(await connectTicket(await ticketFor(userA)));
		const box = inbox(ws);
		for (const id of LIMIT_PROJECTS.slice(0, 50)) {
			expect(await subscribeAndWait(ws, box, id)).toMatchObject({ type: "subscribed", projectId: id });
		}
		const last = await subscribeAndWait(ws, box, LIMIT_PROJECTS[50]);
		expect(last.type).toBe("error");
		expect(box.messages.some((m) => m.type === "subscribed" && m.projectId === LIMIT_PROJECTS[50])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 7. Auth-off dev
// ---------------------------------------------------------------------------

describe("F3-e 7 — auth disabled (dev)", () => {
	beforeEach(() => {
		Reflect.deleteProperty(process.env, "OSCORPEX_AUTH_ENABLED");
	});

	it("without OSCORPEX_DEV_NO_AUTH a ticket-less connect is 401", async () => {
		expect(await connect("")).toEqual({ ok: false, status: 401 });
	});

	it("with OSCORPEX_DEV_NO_AUTH=true outside production the local tenant works without a ticket", async () => {
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		const ws = mustOpen(await connect(""));
		open.push(ws);
		const box = inbox(ws);
		expect(await subscribeAndWait(ws, box, P_LOCAL)).toMatchObject({ type: "subscribed", projectId: P_LOCAL });
		expect((await subscribeAndWait(ws, box, P_A)).type).toBe("error");
	});

	it("with OSCORPEX_DEV_NO_AUTH=true the Origin is still checked", async () => {
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		expect(await connect("", "http://evil.example")).toEqual({ ok: false, status: 403 });
		expect(await connect("", "null")).toEqual({ ok: false, status: 403 });
	});

	it("in production OSCORPEX_DEV_NO_AUTH=true does not open the local tenant (401)", async () => {
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		process.env.NODE_ENV = "production";
		expect(await connect("")).toEqual({ ok: false, status: 401 });
	});
});

// ---------------------------------------------------------------------------
// 9. Regression / legacy removal
// ---------------------------------------------------------------------------

describe("F3-e 9 — legacy removal", () => {
	it("ws-manager and ws-server no longer carry the env-key / URL-token paths", () => {
		const dir = fileURLToPath(new URL("..", import.meta.url));
		for (const file of ["ws-manager.ts", "ws-server.ts"]) {
			const src = readFileSync(`${dir}${file}`, "utf8");
			expect(src, `${file} must not use legacyKeyMatches`).not.toContain("legacyKeyMatches");
			expect(src, `${file} must not read OSCORPEX_API_KEY`).not.toContain("OSCORPEX_API_KEY");
			expect(src, `${file} must not read ?token / ?apiKey`).not.toMatch(/searchParams\.get\(["'](token|apiKey)["']\)/);
		}
	});
});

// ===========================================================================
// Review fix round 1
// Assumed API: WsTicketIdentity gains { authType?: "jwt" | "api-key-db" | "api-key" | "none"; apiKeyId?: string };
// getWsConfig() gains sessionMaxMs (env OSCORPEX_WS_SESSION_MAX_MS, default 900000);
// the per-user ticket cap defaults to 20 outstanding tickets.
// ===========================================================================

async function dbKeyFor(user: SeededUser, scopes: string[]): Promise<{ key: string; id: string }> {
	const key = await seedDbKey(user, scopes);
	return { key, id: cleanup.keys[cleanup.keys.length - 1] };
}

const waitClosed = (box: Inbox, ms = 3000) =>
	Promise.race([box.closed, sleep(ms).then(() => Promise.reject(new Error("socket stayed open")))]);

describe("F3-e r1 item 1 — API-key tickets", () => {
	it("an osx_ key with the projects:read scope gets a ticket recording authType and key id", async () => {
		const k = await dbKeyFor(userC, ["projects:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		expect(res.status).toBe(200);
		const { consumeWsTicket } = await ticketModule();
		const identity = consumeWsTicket(((await res.json()) as { ticket: string }).ticket) as unknown as Record<
			string,
			unknown
		>;
		expect(identity).toMatchObject({ userId: userC.id, tenantId: TENANT_A, authType: "api-key-db", apiKeyId: k.id });
	});

	it("an osx_ key with no scopes (role-only) gets a ticket", async () => {
		const k = await dbKeyFor(userC, []);
		expect((await requestTicket({ Authorization: `Bearer ${k.key}` })).status).toBe(200);
	});

	it("an osx_ key without projects:read in its scopes is 403 and no ticket is stored", async () => {
		const k = await dbKeyFor(userC, ["billing:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		expect(res.status).toBe(403);
		expect(JSON.stringify(await res.json())).not.toMatch(/ticket/i);
	});

	it("a JWT ticket records authType jwt", async () => {
		const { consumeWsTicket } = await ticketModule();
		const identity = consumeWsTicket(await ticketFor(userB)) as unknown as Record<string, unknown>;
		expect(identity.authType).toBe("jwt");
	});

	it("a key deleted mid-session closes the socket on the next subscribe", async () => {
		const k = await dbKeyFor(userC, ["projects:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		const ws = mustOpen(await connectTicket(((await res.json()) as { ticket: string }).ticket));
		const box = inbox(ws);
		expect(await subscribeAndWait(ws, box, P_A)).toMatchObject({ type: "subscribed" });
		await withMigrator((c) => c.query("DELETE FROM api_keys WHERE id = $1", [k.id]));
		subscribe(ws, P_A2);
		await waitClosed(box);
		expect(box.messages.some((m) => m.type === "subscribed" && m.projectId === P_A2)).toBe(false);
	});

	it("a key that expires mid-session closes the socket on the next subscribe", async () => {
		const k = await dbKeyFor(userC, ["projects:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		const ws = mustOpen(await connectTicket(((await res.json()) as { ticket: string }).ticket));
		const box = inbox(ws);
		expect(await subscribeAndWait(ws, box, P_A)).toMatchObject({ type: "subscribed" });
		await withMigrator((c) =>
			c.query("UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE id = $1", [k.id]),
		);
		subscribe(ws, P_A2);
		await waitClosed(box);
	});

	it("a key whose owner lost their role mid-session closes the socket on the next subscribe", async () => {
		const owner = await seedUser({ tenantId: TENANT_A, id: "f3e-user-revoked-sub" });
		extraUsers.push(owner.id);
		const k = await dbKeyFor(owner, ["projects:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		const ws = mustOpen(await connectTicket(((await res.json()) as { ticket: string }).ticket));
		const box = inbox(ws);
		expect(await subscribeAndWait(ws, box, P_A)).toMatchObject({ type: "subscribed" });
		await withMigrator((c) => c.query("DELETE FROM user_roles WHERE user_id = $1", [owner.id]));
		subscribe(ws, P_A2);
		await waitClosed(box);
		expect(box.messages.some((m) => m.type === "subscribed" && m.projectId === P_A2)).toBe(false);
	});

	it("a key ticket redeemed after its owner lost their role is rejected at upgrade (401)", async () => {
		const owner = await seedUser({ tenantId: TENANT_A, id: "f3e-user-revoked-up" });
		extraUsers.push(owner.id);
		const k = await dbKeyFor(owner, ["projects:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		const ticket = ((await res.json()) as { ticket: string }).ticket;
		await withMigrator((c) => c.query("DELETE FROM user_roles WHERE user_id = $1", [owner.id]));
		expect(await connectTicket(ticket)).toEqual({ ok: false, status: 401 });
	});

	it("a still-valid key keeps subscribing", async () => {
		const k = await dbKeyFor(userC, ["projects:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		const ws = mustOpen(await connectTicket(((await res.json()) as { ticket: string }).ticket));
		const box = inbox(ws);
		expect(await subscribeAndWait(ws, box, P_A)).toMatchObject({ type: "subscribed" });
		expect(await subscribeAndWait(ws, box, P_A2)).toMatchObject({ type: "subscribed" });
	});
});

describe("F3-e r1 item 2 — session lifetime cap", () => {
	it("the default cap is 15 minutes", () => {
		expect((getWsConfig() as unknown as { sessionMaxMs: number }).sessionMaxMs).toBe(900_000);
	});

	it("OSCORPEX_WS_SESSION_MAX_MS is read from the environment", () => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = "1234";
		expect((getWsConfig() as unknown as { sessionMaxMs: number }).sessionMaxMs).toBe(1234);
	});

	it("a JWT socket closes at the cap although the token is valid for much longer", async () => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = "500";
		const ws = mustOpen(await connectTicket(await ticketFor(userB)));
		const box = inbox(ws);
		const started = Date.now();
		await waitClosed(box);
		expect(Date.now() - started).toBeGreaterThan(200);
	});

	it("an API-key socket closes at the cap", async () => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = "500";
		const k = await dbKeyFor(userB, ["projects:read"]);
		const res = await requestTicket({ Authorization: `Bearer ${k.key}` });
		const ws = mustOpen(await connectTicket(((await res.json()) as { ticket: string }).ticket));
		await waitClosed(inbox(ws));
	});

	it("a dev (ticket-less) socket closes at the cap", async () => {
		Reflect.deleteProperty(process.env, "OSCORPEX_AUTH_ENABLED");
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		process.env.OSCORPEX_WS_SESSION_MAX_MS = "500";
		const ws = mustOpen(await connect(""));
		open.push(ws);
		await waitClosed(inbox(ws));
	});

	it("the socket closes at the earlier of token expiry and cap (expiry first)", async () => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = "60000";
		const { issueWsTicket } = await ticketModule();
		const { ticket } = issueWsTicket({
			userId: userA.id,
			tenantId: TENANT_A,
			role: "owner",
			isPlatformAdmin: false,
			tokenExpiresAt: Date.now() + 400,
		});
		const ws = mustOpen(await connectTicket(ticket));
		await waitClosed(inbox(ws));
	});

	it("a socket stays open before the cap", async () => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = "60000";
		const ws = mustOpen(await connectTicket(await ticketFor(userB)));
		const box = inbox(ws);
		ws.send(JSON.stringify({ type: "ping" }));
		await box.waitFor((m) => m.type === "pong");
		await sleep(300);
		expect(ws.readyState).toBe(WebSocket.OPEN);
	});
});

describe("F3-e final item 4 — session cap upper bound", () => {
	const DAY = 86_400_000;
	const cap = () => getWsConfig().sessionMaxMs;

	it.each(["Infinity", "1e30", "999999999999999"])("OSCORPEX_WS_SESSION_MAX_MS=%s is clamped to 24 h", (v) => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = v;
		expect(cap()).toBe(DAY);
	});

	it("exactly 24 h is kept", () => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = String(DAY);
		expect(cap()).toBe(DAY);
	});

	it.each(["garbage", "", "NaN", "-5"])("OSCORPEX_WS_SESSION_MAX_MS=%j falls back to the 15 min default", (v) => {
		process.env.OSCORPEX_WS_SESSION_MAX_MS = v;
		expect(cap()).toBe(900_000);
	});
});

describe("F3-e r1 item 5 — ticket abuse limits", () => {
	const ident = (userId: string) => ({ userId, tenantId: TENANT_A, role: "owner", isPlatformAdmin: false });

	it("POST /ws/ticket is rate limited per user (429 after ~30/min); another user is unaffected", async () => {
		const rl = await seedUser({ tenantId: TENANT_A, id: "f3e-user-rl" });
		extraUsers.push(rl.id);
		const statuses: number[] = [];
		for (let i = 0; i < 40; i++) {
			statuses.push((await requestTicket({ Authorization: `Bearer ${rl.token}` })).status);
		}
		expect(statuses[0]).toBe(200);
		expect(statuses).toContain(429);
		expect(statuses.indexOf(429)).toBeGreaterThanOrEqual(25);
		expect(statuses.indexOf(429)).toBeLessThanOrEqual(35);
		const other = await requestTicket({ Authorization: `Bearer ${userB.token}` });
		expect(other.status).toBe(200);
	});

	it("outstanding tickets per user are capped: the oldest of that user is evicted", async () => {
		const { issueWsTicket, consumeWsTicket } = await ticketModule();
		const tickets = Array.from({ length: 25 }, () => issueWsTicket(ident("f3e-cap-user")).ticket);
		expect(consumeWsTicket(tickets[0])).toBeNull();
		expect(consumeWsTicket(tickets[24])).not.toBeNull();
		const alive = tickets.slice(1, 24).filter((t) => consumeWsTicket(t) !== null).length;
		expect(alive).toBeLessThanOrEqual(19);
	});

	it("one user's issuance never evicts another user's ticket", async () => {
		const { issueWsTicket, consumeWsTicket } = await ticketModule();
		const victim = issueWsTicket(ident("f3e-victim-user")).ticket;
		for (let i = 0; i < 60; i++) issueWsTicket(ident("f3e-flood-user"));
		expect(consumeWsTicket(victim)).not.toBeNull();
	});
});

describe("F3-e r1 item 7 — subscribe hardening", () => {
	const bad: Array<[string, unknown]> = [
		["a number", 123],
		["an object", { $ne: null }],
		["an array", ["f3e-proj-a"]],
		["over 128 characters", "a".repeat(129)],
		["with a space", "f3e proj"],
		["with a path traversal", "../etc"],
		["with a quote", "f3e'proj"],
		["with a NUL byte", "f3e\u0000proj"],
	];

	it.each(bad)("a projectId %s gets the same 'Project not found' error and no DB lookup", async (_n, projectId) => {
		const ws = mustOpen(await connectTicket(await ticketFor(userB)));
		const box = inbox(ws);
		const missing = await subscribeAndWait(ws, box, "f3e-does-not-exist");
		const projectSpy = vi.spyOn(projectAccess, "lookupProjectTenant");
		const before = box.messages.length;
		ws.send(JSON.stringify({ type: "subscribe", projectId }));
		const start = Date.now();
		while (box.messages.length === before && Date.now() - start < 3000) await sleep(20);
		const reply = box.messages[before];
		expect(JSON.stringify(reply)).toBe(JSON.stringify(missing));
		expect(projectSpy).not.toHaveBeenCalled();
	});

	it("a 128-character id of allowed characters still reaches the lookup", async () => {
		const ws = mustOpen(await connectTicket(await ticketFor(userB)));
		const box = inbox(ws);
		const projectSpy = vi.spyOn(projectAccess, "lookupProjectTenant");
		await subscribeAndWait(ws, box, `${"a-B_9".repeat(25)}abc`);
		expect(projectSpy).toHaveBeenCalledTimes(1);
	});

	it("an unsubscribe that arrives while the subscribe is pending is honoured", async () => {
		const original = projectAccess.lookupProjectTenant;
		vi.spyOn(projectAccess, "lookupProjectTenant").mockImplementation(async (id: string) => {
			await sleep(300);
			return original(id);
		});
		const ws = mustOpen(await connectTicket(await ticketFor(userA)));
		const box = inbox(ws);
		ws.send(JSON.stringify({ type: "subscribe", projectId: P_A }));
		ws.send(JSON.stringify({ type: "unsubscribe", projectId: P_A }));
		await sleep(700);
		wsManager.broadcastToProject(P_A, {
			type: "event",
			projectId: P_A,
			payload: {
				id: "e-late",
				projectId: P_A,
				tenantId: TENANT_A,
				type: "task:completed",
				payload: {},
				timestamp: new Date().toISOString(),
			},
		});
		await sleep(250);
		expect(box.messages.some((m) => m.type === "event")).toBe(false);
	});
});

describe("F3-e r1 item 8 — no Origin header", () => {
	it("a valid ticket without an Origin header connects", async () => {
		const r = await connectTicket(await ticketFor(userB), null);
		expect(r.ok).toBe(true);
	});

	it("a ticket-less no-Origin connect is still 401", async () => {
		expect(await connect("", null)).toEqual({ ok: false, status: 401 });
	});
});
