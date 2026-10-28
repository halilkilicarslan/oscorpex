// ---------------------------------------------------------------------------
// F2b — auth ↔ tenant-scope wiring
//  - accessGuard runs the downstream handler in runInTenant(request tenant)
//  - removal of setTenantContext / withTenantTransaction / withTenantFilter
//  - boot-time auth mode resolution
//  - JWT / legacy key / DB API key (sys_api_key_lookup) semantics
//  - /api/auth and /api/observability under strict scope mode
//  - strict-mode end-to-end through the REAL studio router
//
// Runs in both modes (local non-superuser runtime / CI superuser runtime).
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, vi } from "vitest";
import { resolveAuthMode } from "../../boot-phases/auth-config-phase.js";
import { observabilityRoutes } from "../../observability/index.js";
import { accessGuard } from "../auth/access-guard.js";
import { authMiddleware } from "../auth/auth-middleware.js";
import { signJwt, verifyJwt } from "../auth/jwt.js";
import { authRoutes, studioRoutes } from "../index.js";
import * as kernelPg from "../pg.js";
import { currentScope } from "../tenancy/tenant-scope.js";
import { seedUser } from "./helpers/identity.js";
import { it } from "./helpers/outside-scope.js";
import { TENANT_A, TENANT_B, TENANT_LOCAL, withMigrator } from "./helpers/tenancy.js";

const SRC = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const ENV_KEYS = [
	"OSCORPEX_AUTH_ENABLED",
	"OSCORPEX_DEV_NO_AUTH",
	"OSCORPEX_API_KEY",
	"OSCORPEX_TENANT_SCOPE_MODE",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(opts: { path?: string; method?: string; token?: string; rawAuth?: string }): any {
	const store: Record<string, unknown> = {};
	const auth = opts.rawAuth ?? (opts.token ? `Bearer ${opts.token}` : "");
	return {
		req: {
			path: opts.path ?? "/projects",
			method: opts.method ?? "GET",
			header: (name: string) => (name.toLowerCase() === "authorization" ? auth : ""),
		},
		set: (k: string, v: unknown) => {
			store[k] = v;
		},
		get: (k: string) => store[k] ?? null,
		json: (body: unknown, status = 200) => ({ body, status }),
		_store: store,
	};
}

// Real users (identity is verified against the DB): fixed ids per tenant, seeded in beforeAll
const jwtFor = (tenantId: string, role = "owner") =>
	signJwt({ sub: `u-${tenantId}`, email: `u-${tenantId}@f2r.test`, tenantId, role });
let adminJwt = "";

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

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// Fixtures cleaned in afterAll
const cleanup = {
	tenants: [] as string[],
	users: [] as string[],
	keys: [] as string[],
	projects: [] as string[],
	emails: [] as string[],
};
let isSuper = true;

beforeAll(async () => {
	isSuper = await runtimeIsSuperuser();
	for (const t of [TENANT_A, TENANT_B]) await seedUser({ tenantId: t, id: `u-${t}` });
	adminJwt = (await seedUser({ tenantId: TENANT_A, id: "f2r-b-admin", admin: true })).token;
	await withMigrator(async (c) => {
		for (const [id, slug] of [
			[TENANT_A, "test-tenant-a"],
			[TENANT_B, "test-tenant-b"],
			[TENANT_LOCAL, "local"],
		]) {
			await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
				id,
				slug,
				slug,
			]);
		}
	});
});

afterAll(async () => {
	await withMigrator(async (c) => {
		if (cleanup.keys.length) await c.query("DELETE FROM api_keys WHERE id = ANY($1)", [cleanup.keys]);
		if (cleanup.projects.length) await c.query("DELETE FROM projects WHERE id = ANY($1)", [cleanup.projects]);
		if (cleanup.emails.length) await c.query("DELETE FROM users WHERE email = ANY($1)", [cleanup.emails]);
		if (cleanup.users.length) await c.query("DELETE FROM users WHERE id = ANY($1)", [cleanup.users]);
		if (cleanup.tenants.length) await c.query("DELETE FROM tenants WHERE id = ANY($1)", [cleanup.tenants]);
	});
});

async function seedKey(opts: {
	tenantId: string | null;
	role?: string;
	expiresAt?: string | null;
}): Promise<{ key: string; id: string; userId: string }> {
	const key = `osx_${randomUUID().replaceAll("-", "")}`;
	const id = `f2b-key-${randomUUID()}`;
	const userId = `f2b-user-${randomUUID()}`;
	cleanup.keys.push(id);
	cleanup.users.push(userId);
	await withMigrator(async (c) => {
		await c.query("INSERT INTO users (id, email, password_hash, tenant_id) VALUES ($1, $2, 'x', $3)", [
			userId,
			`${userId}@f2b.test`,
			opts.tenantId,
		]);
		if (opts.tenantId) {
			await c.query("INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)", [
				userId,
				opts.tenantId,
				opts.role ?? "owner",
			]);
		}
		await c.query(
			"INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name, expires_at) VALUES ($1, $2, $3, $4, 'f2b', $5)",
			[id, opts.tenantId, userId, sha(key), opts.expiresAt ?? null],
		);
	});
	return { key, id, userId };
}

// ---------------------------------------------------------------------------
// 1. accessGuard scope (covered further in access-guard-matrix/sse tests)
// ---------------------------------------------------------------------------

describe("accessGuard — tenant scope", () => {
	it("JWT: handler and later middleware run in the JWT tenant scope", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const seen: unknown[] = [];
		const next = vi.fn(async () => {
			seen.push(currentScope());
			await new Promise((r) => setTimeout(r, 5));
			seen.push(currentScope());
		});
		await accessGuard(makeCtx({ token: jwtFor(TENANT_A) }), next);
		expect(next).toHaveBeenCalled();
		expect(seen).toEqual([
			{ kind: "tenant", tenantId: TENANT_A },
			{ kind: "tenant", tenantId: TENANT_A },
		]);
	});

	it("concurrent requests for different tenants keep their own scope", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const run = async (tid: string) => {
			let s: unknown;
			await accessGuard(
				makeCtx({ token: jwtFor(tid) }),
				vi.fn(async () => {
					await new Promise((r) => setTimeout(r, Math.random() * 10));
					s = currentScope();
				}),
			);
			return s;
		};
		const res = await Promise.all(Array.from({ length: 20 }, (_, i) => run(i % 2 ? TENANT_A : TENANT_B)));
		res.forEach((s, i) => expect(s).toEqual({ kind: "tenant", tenantId: i % 2 ? TENANT_A : TENANT_B }));
	});

	it("legacy OSCORPEX_API_KEY maps to the local tenant scope", async () => {
		process.env.OSCORPEX_API_KEY = "legacy-key-f2b";
		let scope: unknown;
		await accessGuard(
			makeCtx({ rawAuth: "Bearer legacy-key-f2b" }),
			vi.fn(async () => {
				scope = currentScope();
			}),
		);
		expect(scope).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL });
	});

	it("downstream errors propagate and do not leak the scope", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		await expect(
			accessGuard(
				makeCtx({ token: jwtFor(TENANT_A) }),
				vi.fn(async () => {
					throw new Error("handler-boom");
				}),
			),
		).rejects.toThrow("handler-boom");
		expect(currentScope()).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 2. Removed APIs (static)
// ---------------------------------------------------------------------------

describe("removed session-level tenant APIs", () => {
	it("pg.ts no longer exports setTenantContext / withTenantTransaction", () => {
		const names = Object.keys(kernelPg);
		expect(names).not.toContain("setTenantContext");
		expect(names).not.toContain("withTenantTransaction");
	});

	it("auth-middleware.ts no longer references setTenantContext", () => {
		expect(read("auth/auth-middleware.ts")).not.toMatch(/setTenantContext/);
	});

	it("tenant-context.ts no longer defines withTenantFilter / isTenantIsolationEnabled", () => {
		const src = read("auth/tenant-context.ts");
		expect(src).not.toMatch(/export\s+function\s+withTenantFilter/);
		expect(src).not.toMatch(/export\s+function\s+isTenantIsolationEnabled/);
	});

	it("auth-middleware resolves DB API keys via sys_api_key_lookup, not a direct api_keys query", () => {
		const src = read("auth/auth-middleware.ts");
		expect(src).toContain("sys_api_key_lookup");
		expect(src).not.toMatch(/FROM\s+api_keys/i);
		expect(src).not.toMatch(/JOIN\s+user_roles/i);
	});
});

// ---------------------------------------------------------------------------
// 3. resolveAuthMode (pure)
// ---------------------------------------------------------------------------

describe("resolveAuthMode", () => {
	it("defaults: everything off", () => {
		expect(resolveAuthMode({})).toEqual({ authEnabled: false, devNoAuth: false, production: false });
	});

	it("auth enabled", () => {
		expect(resolveAuthMode({ OSCORPEX_AUTH_ENABLED: "true" })).toEqual({
			authEnabled: true,
			devNoAuth: false,
			production: false,
		});
	});

	it("dev no-auth (non-production)", () => {
		expect(resolveAuthMode({ OSCORPEX_DEV_NO_AUTH: "true", NODE_ENV: "development" })).toEqual({
			authEnabled: false,
			devNoAuth: true,
			production: false,
		});
	});

	it("production + auth enabled", () => {
		expect(resolveAuthMode({ NODE_ENV: "production", OSCORPEX_AUTH_ENABLED: "true" })).toEqual({
			authEnabled: true,
			devNoAuth: false,
			production: true,
		});
	});

	it("throws when DEV_NO_AUTH and AUTH_ENABLED are both true", () => {
		expect(() => resolveAuthMode({ OSCORPEX_DEV_NO_AUTH: "true", OSCORPEX_AUTH_ENABLED: "true" })).toThrow();
	});

	it("throws when DEV_NO_AUTH=true in production (even with auth disabled)", () => {
		expect(() => resolveAuthMode({ NODE_ENV: "production", OSCORPEX_DEV_NO_AUTH: "true" })).toThrow();
	});

	it("only the literal string 'true' enables flags", () => {
		expect(resolveAuthMode({ OSCORPEX_DEV_NO_AUTH: "1", OSCORPEX_AUTH_ENABLED: "yes" })).toEqual({
			authEnabled: false,
			devNoAuth: false,
			production: false,
		});
	});
});

// ---------------------------------------------------------------------------
// 4. JWT / legacy key rules
// ---------------------------------------------------------------------------

describe("authMiddleware — tenant rules", () => {
	it("auth enabled: JWT carrying the local tenant id is rejected with 401", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const c = makeCtx({ token: jwtFor(TENANT_LOCAL) });
		const next = vi.fn();
		const res = await authMiddleware(c, next);
		expect(next).not.toHaveBeenCalled();
		expect((res as unknown as { status: number }).status).toBe(401);
	});

	it("auth enabled: JWT for a regular tenant is accepted", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const c = makeCtx({ token: jwtFor(TENANT_A) });
		const next = vi.fn(async () => {});
		await authMiddleware(c, next);
		expect(next).toHaveBeenCalled();
		expect(c._store.tenantId).toBe(TENANT_A);
	});

	it("legacy OSCORPEX_API_KEY sets tenantId to the local tenant", async () => {
		process.env.OSCORPEX_API_KEY = "legacy-key-f2b";
		const c = makeCtx({ rawAuth: "Bearer legacy-key-f2b" });
		await authMiddleware(
			c,
			vi.fn(async () => {}),
		);
		expect(c._store.authType).toBe("api-key");
		expect(c._store.tenantId).toBe(TENANT_LOCAL);
	});
});

// ---------------------------------------------------------------------------
// 5. DB API keys through sys_api_key_lookup (works in strict mode: system scope)
// ---------------------------------------------------------------------------

describe("DB API key resolution (osx_…)", () => {
	beforeEach(() => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
	});

	it("valid key → request runs in that key's tenant scope", async () => {
		const { key, userId } = await seedKey({ tenantId: TENANT_A, role: "developer" });
		const c = makeCtx({ rawAuth: `Bearer ${key}` });
		let scope: unknown;
		const next = vi.fn(async () => {
			scope = currentScope();
		});
		const res = await accessGuard(c, next);
		expect(res).toBeUndefined();
		expect(next).toHaveBeenCalled();
		expect(scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
		expect(c._store.authType).toBe("api-key-db");
		expect(c._store.userId).toBe(userId);
		expect(c._store.tenantId).toBe(TENANT_A);
		expect(c._store.userRole).toBe("developer");
	});

	it("expired key → 401", async () => {
		const { key } = await seedKey({ tenantId: TENANT_A, expiresAt: new Date(Date.now() - 3600_000).toISOString() });
		const next = vi.fn();
		const res = await accessGuard(makeCtx({ rawAuth: `Bearer ${key}` }), next);
		expect(next).not.toHaveBeenCalled();
		expect((res as any).status).toBe(401);
	});

	it("key whose lookup returns a NULL tenant → 401", async () => {
		const { key } = await seedKey({ tenantId: null });
		const next = vi.fn();
		const res = await accessGuard(makeCtx({ rawAuth: `Bearer ${key}` }), next);
		expect(next).not.toHaveBeenCalled();
		expect((res as any).status).toBe(401);
	});

	it("unknown key → 401", async () => {
		const next = vi.fn();
		const res = await accessGuard(makeCtx({ rawAuth: `Bearer osx_${randomUUID()}` }), next);
		expect(next).not.toHaveBeenCalled();
		expect((res as any).status).toBe(401);
	});

	it("key for tenant B cannot be used to act as tenant A", async () => {
		const { key } = await seedKey({ tenantId: TENANT_B });
		let scope: unknown;
		await accessGuard(
			makeCtx({ rawAuth: `Bearer ${key}` }),
			vi.fn(async () => {
				scope = currentScope();
			}),
		);
		expect(scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
	});
});

// ---------------------------------------------------------------------------
// 6. /api/auth routes under strict scope mode
// ---------------------------------------------------------------------------

describe("/api/auth under OSCORPEX_TENANT_SCOPE_MODE=strict", () => {
	beforeEach(() => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
	});

	const post = (path: string, body: unknown) =>
		authRoutes.request(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	it("register then login succeed (system scope, not unscoped)", async () => {
		const email = `f2b-${randomUUID()}@example.com`;
		const password = "S3cure-passw0rd!";
		cleanup.emails.push(email);

		const reg = await post("/register", { email, password, displayName: "F2b" });
		expect(reg.status).toBe(201);
		const regBody = (await reg.json()) as { token: string };
		const tid = verifyJwt(regBody.token)?.tenantId;
		expect(tid).toBeTruthy();
		if (tid) cleanup.tenants.push(tid);

		const login = await post("/login", { email, password });
		expect(login.status).toBe(200);
		const loginBody = (await login.json()) as { token: string };
		expect(verifyJwt(loginBody.token)?.tenantId).toBe(tid);
	});

	it("login with wrong password → 401 (not 500)", async () => {
		const res = await post("/login", { email: `nobody-${randomUUID()}@example.com`, password: "x" });
		expect(res.status).toBe(401);
	});

	it("DELETE /api-keys/:id of another tenant → 404 and the key still exists", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const { id } = await seedKey({ tenantId: TENANT_B });
		const res = await authRoutes.request(`/api-keys/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${jwtFor(TENANT_A)}` },
		});
		expect(res.status).toBe(404);
		const still = await withMigrator((c) => c.query("SELECT 1 FROM api_keys WHERE id = $1", [id]));
		expect(still.rowCount).toBe(1);
	});

	it("DELETE /api-keys/:id of the caller's own tenant → 200 and the key is gone", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const { id } = await seedKey({ tenantId: TENANT_A });
		const res = await authRoutes.request(`/api-keys/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${jwtFor(TENANT_A)}` },
		});
		expect(res.status).toBe(200);
		const gone = await withMigrator((c) => c.query("SELECT 1 FROM api_keys WHERE id = $1", [id]));
		expect(gone.rowCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 7. /api/observability requires auth
// ---------------------------------------------------------------------------

describe("/api/observability auth", () => {
	it("unauthenticated request → 401 when auth is enabled", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const res = await observabilityRoutes.request("/logs");
		expect(res.status).toBe(401);
	});

	it("invalid token → 401 when auth is enabled", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const res = await observabilityRoutes.request("/logs", { headers: { Authorization: "Bearer not-a-jwt" } });
		expect(res.status).toBe(401);
	});

	it("platform-admin request works, also in strict scope mode", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		const res = await observabilityRoutes.request("/logs", { headers: { Authorization: `Bearer ${adminJwt}` } });
		expect(res.status).toBe(200);
	});

	it("CORS preflight is not blocked by auth", async () => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		const res = await observabilityRoutes.request("/logs", {
			method: "OPTIONS",
			headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" },
		});
		expect(res.status).toBeLessThan(300);
	});
});

// ---------------------------------------------------------------------------
// 8. Strict-mode end-to-end through the REAL studio router
// ---------------------------------------------------------------------------

describe("strict-mode e2e via studioRoutes", () => {
	beforeEach(() => {
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
	});

	it("authenticated GET /projects succeeds (guard scope covers handler + budgetGuard)", async () => {
		const res = await studioRoutes.request("/projects", { headers: { Authorization: `Bearer ${jwtFor(TENANT_A)}` } });
		expect(res.status).toBe(200);
		expect(Array.isArray(await res.json())).toBe(true);
	});

	it("unauthenticated GET /projects → 401 (never reaches SQL)", async () => {
		const res = await studioRoutes.request("/projects");
		expect(res.status).toBe(401);
	});

	it("(non-superuser runtime) lists only the caller tenant's projects", async (ctx) => {
		if (isSuper) return ctx.skip();
		const a = `f2b-${randomUUID()}`;
		const b = `f2b-${randomUUID()}`;
		cleanup.projects.push(a, b);
		await withMigrator(async (c) => {
			for (const [id, t] of [
				[a, TENANT_A],
				[b, TENANT_B],
			]) {
				await c.query(
					"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2b', now(), now(), $2)",
					[id, t],
				);
			}
		});
		const res = await studioRoutes.request("/projects", { headers: { Authorization: `Bearer ${jwtFor(TENANT_A)}` } });
		const ids = ((await res.json()) as Array<{ id: string }>).map((p) => p.id);
		expect(ids).toContain(a);
		expect(ids).not.toContain(b);
	});

	it("dev bypass (OSCORPEX_DEV_NO_AUTH=true, auth disabled) also works in strict mode", async () => {
		Reflect.deleteProperty(process.env, "OSCORPEX_AUTH_ENABLED");
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		const res = await studioRoutes.request("/projects");
		expect(res.status).toBe(200);
	});
});
