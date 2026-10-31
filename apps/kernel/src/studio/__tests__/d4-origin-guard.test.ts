// ---------------------------------------------------------------------------
// D4 review — Origin guard for unsafe methods under /api/studio: a browser Origin outside the allowlist
// (OSCORPEX_CORS_ORIGINS) is refused with 403 before the handler runs; no Origin (API clients) and allowed
// Origins are handled normally; reads are CORS's job. Assumed placement: middleware on studioRoutes.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { studioRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { withMigrator } from "./helpers/tenancy.js";

const ALLOWED = "https://console.d4.test";
const ENV_KEYS = [
	"OSCORPEX_AUTH_ENABLED",
	"OSCORPEX_DEV_NO_AUTH",
	"OSCORPEX_API_KEY",
	"OSCORPEX_CORS_ORIGINS",
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

function send(method: string, path: string, origin?: string, body?: unknown) {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (origin !== undefined) headers.origin = origin;
	return runOutsideScope(async () =>
		studioRoutes.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
	);
}

// the guard's absence lets register create a real user + tenant: remove whatever this suite created
afterAll(async () => {
	await withMigrator(async (c) => {
		const t = await c.query("SELECT tenant_id FROM users WHERE email LIKE 'd4-origin-%@d4.test'");
		const ids = t.rows.map((r: { tenant_id: string }) => r.tenant_id);
		await c.query(
			"DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'd4-origin-%@d4.test')",
		);
		await c.query("DELETE FROM users WHERE email LIKE 'd4-origin-%@d4.test'");
		if (ids.length) await c.query("DELETE FROM tenants WHERE id = ANY($1)", [ids]).catch(() => undefined);
	});
});

describe("unsafe methods with a foreign Origin", () => {
	it.each([
		["POST", "/projects"],
		["PUT", "/projects/x"],
		["PATCH", "/projects/x"],
		["DELETE", "/projects/x"],
	])("%s %s -> 403", async (method, path) => {
		expect((await send(method, path, "http://evil.example", {})).status).toBe(403);
	});

	it("Origin: null -> 403", async () => {
		expect((await send("POST", "/projects", "null", {})).status).toBe(403);
	});

	it("register with a foreign Origin is refused before the handler: no user row", async () => {
		const email = `d4-origin-${Math.random().toString(36).slice(2)}@d4.test`;
		const res = await send("POST", "/auth/register", "http://evil.example", {
			email,
			password: "Sup3r-secret-pass!",
			displayName: "x",
			tenantName: `d4-${Math.random().toString(36).slice(2)}`,
		});
		expect(res.status).toBe(403);
		const rows = await withMigrator(
			async (c) => (await c.query("SELECT 1 FROM users WHERE email = $1", [email])).rowCount,
		);
		expect(rows).toBe(0);
	});
});

describe("other requests are handled normally", () => {
	it.each([
		["allowed Origin", ALLOWED],
		["no Origin", undefined],
	])("%s: POST reaches normal handling (not 403)", async (_n, origin) => {
		expect((await send("POST", "/projects", origin, {})).status).toBe(401);
	});

	it("allowed Origin: register reaches the handler (400 for an empty body)", async () => {
		expect((await send("POST", "/auth/register", ALLOWED, {})).status).toBe(400);
	});

	it("GET with a foreign Origin is not blocked by the guard", async () => {
		expect((await send("GET", "/projects", "http://evil.example")).status).toBe(401);
	});
});
