// ---------------------------------------------------------------------------
// D4 final — the console's real auth path is the ROOT /api/auth mount (and /api/observability), outside studioRoutes.
// Assumed contract: boot-phases/http-phase.ts exports buildHttpApp(): Hono (all mounts + /health, no listening);
// it applies originGuard() to /api/* (every method except GET/HEAD/OPTIONS is unsafe) and a 10/min rate limiter
// to POST /api/auth/login and /api/auth/register only. The limiter store is module-level, so tests isolate by a
// unique socket address per test.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHttpApp } from "../../boot-phases/http-phase.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { withMigrator } from "./helpers/tenancy.js";

const ALLOWED = "https://console.d4root.test";
const ENV_KEYS = [
	"OSCORPEX_AUTH_ENABLED",
	"OSCORPEX_DEV_NO_AUTH",
	"OSCORPEX_API_KEY",
	"OSCORPEX_CORS_ORIGINS",
	"OSCORPEX_TRUSTED_PROXY",
	"NODE_ENV",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
	process.env.NODE_ENV = "test";
	process.env.OSCORPEX_AUTH_ENABLED = "true";
	process.env.OSCORPEX_CORS_ORIGINS = ALLOWED;
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

afterAll(async () => {
	await withMigrator(async (c) => {
		const t = await c.query("SELECT tenant_id FROM users WHERE email LIKE 'd4-root-%@d4.test'");
		const ids = t.rows.map((r: { tenant_id: string }) => r.tenant_id);
		await c.query(
			"DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'd4-root-%@d4.test')",
		);
		await c.query("DELETE FROM users WHERE email LIKE 'd4-root-%@d4.test'");
		if (ids.length) await c.query("DELETE FROM tenants WHERE id = ANY($1)", [ids]).catch(() => undefined);
	});
});

let seq = 0;
const uniqueIp = () => `10.44.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`;

function send(method: string, path: string, o: { origin?: string; body?: unknown; ip?: string } = {}) {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (o.origin !== undefined) headers.origin = o.origin;
	const app = buildHttpApp();
	return runOutsideScope(async () =>
		app.request(
			path,
			{ method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) },
			{ incoming: { socket: { remoteAddress: o.ip ?? uniqueIp() } } },
		),
	);
}

describe("root /api/auth/register", () => {
	it("foreign Origin -> 403 and no user row", async () => {
		const email = `d4-root-${Math.random().toString(36).slice(2)}@d4.test`;
		const res = await send("POST", "/api/auth/register", {
			origin: "http://evil.example",
			body: {
				email,
				password: "Sup3r-secret-pass!",
				displayName: "x",
				tenantName: `d4r-${Math.random().toString(36).slice(2)}`,
			},
		});
		expect(res.status).toBe(403);
		const rows = await withMigrator(
			async (c) => (await c.query("SELECT 1 FROM users WHERE email = $1", [email])).rowCount,
		);
		expect(rows).toBe(0);
	});

	it.each([
		["allowed Origin", ALLOWED],
		["no Origin", undefined],
	])("%s -> not 403 (handler reached: 400 for an empty body)", async (_n, origin) => {
		const res = await send("POST", "/api/auth/register", { origin, body: {} });
		expect(res.status).not.toBe(403);
		expect(res.status).toBe(400);
	});
});

describe("other mounts", () => {
	it("a mutating /api/observability route with a foreign Origin -> 403", async () => {
		expect(
			(await send("POST", "/api/observability/feedbacks", { origin: "http://evil.example", body: {} })).status,
		).toBe(403);
	});

	it("a custom method on an .all() route under /api/studio with a foreign Origin -> 403", async () => {
		const res = await send("PROPFIND", "/api/studio/projects/p1/app/proxy/x", { origin: "http://evil.example" });
		expect(res.status).toBe(403);
	});

	it("/health is untouched", async () => {
		expect((await send("GET", "/health", { origin: "http://evil.example" })).status).toBe(200);
	});
});

describe("rate limits on the root auth mount", () => {
	it("the 11th POST /api/auth/login from one client within a minute -> 429", async () => {
		const ip = uniqueIp();
		const statuses: number[] = [];
		for (let i = 0; i < 11; i++) statuses.push((await send("POST", "/api/auth/login", { ip, body: {} })).status);
		expect(statuses.slice(0, 10)).not.toContain(429);
		expect(statuses[10]).toBe(429);
	});

	it("the 11th POST /api/auth/register from one client within a minute -> 429", async () => {
		const ip = uniqueIp();
		const statuses: number[] = [];
		for (let i = 0; i < 11; i++) statuses.push((await send("POST", "/api/auth/register", { ip, body: {} })).status);
		expect(statuses.slice(0, 10)).not.toContain(429);
		expect(statuses[10]).toBe(429);
	});

	it("GET /api/auth/me is not limited at 10/min (12 GETs)", async () => {
		const ip = uniqueIp();
		const statuses: number[] = [];
		for (let i = 0; i < 12; i++) statuses.push((await send("GET", "/api/auth/me", { ip })).status);
		expect(statuses).not.toContain(429);
	});
});
