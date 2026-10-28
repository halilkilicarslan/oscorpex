// ---------------------------------------------------------------------------
// Access Guard — Route Permission Matrix Tests
// ---------------------------------------------------------------------------

import { afterEach, beforeAll, beforeEach, describe, expect, vi } from "vitest";
import { it } from "./helpers/outside-scope.js";
import { accessGuard } from "../auth/access-guard.js";
import { signJwt } from "../auth/jwt.js";
import { currentScope } from "../tenancy/tenant-scope.js";
import { seedUser } from "./helpers/identity.js";
import { TENANT_A } from "./helpers/tenancy.js";

const LOCAL_TENANT = "00000000-0000-0000-0000-000000000001";

// F2b: authentication is derived from the Authorization header only — the mock no longer
// pre-populates authType/userId/tenantId (the middleware must establish them itself).
function makeCtx(opts: { path: string; method?: string; token?: string }): any {
	const store: Record<string, unknown> = {};
	return {
		req: {
			path: opts.path,
			method: opts.method ?? "GET",
			header: (name: string) => (name.toLowerCase() === "authorization" && opts.token ? `Bearer ${opts.token}` : ""),
		},
		set: (key: string, value: unknown) => {
			store[key] = value;
		},
		get: (key: string) => store[key] ?? null,
		json: (body: unknown, status = 200) => ({ body, status }),
	};
}

const tokens: Record<string, string> = {};
beforeAll(async () => {
	for (const role of ["owner", "viewer"]) tokens[role] = (await seedUser({ tenantId: TENANT_A, role })).token;
});
function jwt(role: string): string {
	return tokens[role];
}

const ENV_KEYS = ["OSCORPEX_AUTH_ENABLED", "OSCORPEX_DEV_NO_AUTH", "OSCORPEX_API_KEY"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe("accessGuard — route permission matrix", () => {
	it("allows public route without auth (and without tenant scope)", async () => {
		const c = makeCtx({ path: "/health" });
		let scope: unknown = "unset";
		const next = vi.fn(async () => {
			scope = currentScope();
		});
		await accessGuard(c, next);
		expect(next).toHaveBeenCalled();
		expect(scope).toBeUndefined();
	});

	it("denies unknown route (default deny)", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const c = makeCtx({ path: "/unknown/mystery", token: jwt("owner") });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((result as any).status).toBe(403);
		expect((result as any).body.error).toContain("unknown route");
	});

	it("denies known route without auth when auth is enabled (401 from authentication)", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const c = makeCtx({ path: "/projects", method: "GET" });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((result as any).status).toBe(401);
	});

	it("denies known route when no auth is configured and no explicit dev bypass", async () => {
		const c = makeCtx({ path: "/projects", method: "GET" });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((result as any).status).toBe(401);
	});

	it("allows known route in dev mode (OSCORPEX_DEV_NO_AUTH=true) inside the local tenant scope", async () => {
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		const c = makeCtx({ path: "/projects", method: "GET" });
		let scope: unknown;
		const next = vi.fn(async () => {
			scope = currentScope();
		});
		await accessGuard(c, next);
		expect(next).toHaveBeenCalled();
		expect(scope).toEqual({ kind: "tenant", tenantId: LOCAL_TENANT });
	});

	it("denies known mutating route without proper permission", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		// viewer does NOT have projects:create
		const c = makeCtx({ path: "/projects", method: "POST", token: jwt("viewer") });
		const next = vi.fn();
		const result = await accessGuard(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((result as any).status).toBe(403);
	});

	it("allows known mutating route with proper permission, running next() in the request tenant scope", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const c = makeCtx({ path: "/projects", method: "POST", token: jwt("owner") });
		let scope: unknown;
		const next = vi.fn(async () => {
			scope = currentScope();
		});
		await accessGuard(c, next);
		expect(next).toHaveBeenCalled();
		expect(scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
	});

	it("does not leave a scope behind after the guard returns", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		await accessGuard(makeCtx({ path: "/projects", token: jwt("owner") }), vi.fn());
		expect(currentScope()).toBeUndefined();
	});
});
