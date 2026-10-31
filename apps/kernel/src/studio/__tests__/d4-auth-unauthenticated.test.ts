// ---------------------------------------------------------------------------
// D4 — unauthenticated requests when JWT auth is configured (OSCORPEX_AUTH_ENABLED=true) get 401 regardless
// of OSCORPEX_API_KEY, and the middleware logs no error per request. The misconfiguration case (production,
// auth NOT enabled, no OSCORPEX_API_KEY, no bypass) keeps answering 500.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const errorLog = vi.hoisted(() => vi.fn());
vi.mock("../logger.js", async (orig) => {
	const real = await orig<typeof import("../logger.js")>();
	return {
		...real,
		createLogger: (name: string) => {
			const l = real.createLogger(name);
			return new Proxy(l, {
				get: (t, p, r) => (p === "error" && name.includes("auth") ? errorLog : Reflect.get(t, p, r)),
			});
		},
	};
});

import { studioRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { type SeededUser, removeUsers, seedUser } from "./helpers/identity.js";
import { TENANT_A } from "./helpers/tenancy.js";

const ENV_KEYS = [
	"OSCORPEX_AUTH_ENABLED",
	"OSCORPEX_DEV_NO_AUTH",
	"OSCORPEX_API_KEY",
	"OSCORPEX_ALLOW_LEGACY_API_KEY",
	"NODE_ENV",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
	errorLog.mockClear();
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

const seeded: string[] = [];
afterAll(async () => {
	await removeUsers(seeded);
});

function get(path: string, headers: Record<string, string> = {}) {
	return runOutsideScope(async () => studioRoutes.request(path, { headers }));
}

describe("D4 — unauthenticated requests", () => {
	it("production + auth enabled + no API key: 401, no error log", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const res = await get("/projects");
		expect(res.status).toBe(401);
		expect(errorLog).not.toHaveBeenCalled();
	});

	it("production + auth enabled + invalid bearer token: 401, no error log", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const res = await get("/projects", { Authorization: "Bearer not-a-valid-token" });
		expect(res.status).toBe(401);
		expect(errorLog).not.toHaveBeenCalled();
	});

	it("dev + auth enabled + no API key: 401 (regression)", async () => {
		process.env.NODE_ENV = "test";
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const res = await get("/projects");
		expect(res.status).toBe(401);
	});

	it("production + auth NOT enabled + no API key + no bypass: unchanged (500)", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_DEV_NO_AUTH = "true"; // never honoured in production
		const res = await get("/projects");
		expect(res.status).toBe(500);
	});

	it("production + auth enabled: a valid JWT still reaches the route (200)", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const u: SeededUser = await seedUser({ tenantId: TENANT_A, role: "owner", id: "d4-unauth-user" });
		seeded.push(u.id);
		const res = await get("/auth/me", { Authorization: `Bearer ${u.token}` });
		expect(res.status).toBe(200);
	});
});
