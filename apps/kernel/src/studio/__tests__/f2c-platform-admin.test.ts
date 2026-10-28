// ---------------------------------------------------------------------------
// F2c — platform admin, mixed-table ownership, approval route split
//
// Runs in both modes (local non-superuser runtime / CI superuser runtime).
// Tests that rely on RLS visibility or DB-level privilege skip themselves under a
// superuser runtime; everything enforced in application code runs in both.
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from "vitest";
import { authMiddleware } from "../auth/auth-middleware.js";
import { signJwt } from "../auth/jwt.js";
import { hasPermission, requirePermission } from "../auth/rbac.js";
import { getRoutePermission, isKnownRoute } from "../auth/route-permissions.js";
import { studioRoutes } from "../index.js";
import { TABLE_CLASSIFICATION } from "../tenancy/table-classification.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { it } from "./helpers/outside-scope.js";
import { TENANT_A, TENANT_B, TENANT_LOCAL, withMigrator } from "./helpers/tenancy.js";

const SRC = resolve(__dirname, "..");
const KERNEL = resolve(__dirname, "../../..");
const CONSOLE = resolve(__dirname, "../../../../console/src");

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
	process.env.OSCORPEX_AUTH_ENABLED = "true";
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const cleanup = {
	users: [] as string[],
	keys: [] as string[],
	projects: [] as string[],
	agentConfigs: [] as string[],
	projectAgents: [] as string[],
	templates: [] as string[],
	skills: [] as string[],
	approvals: [] as string[],
	taskTypes: [] as string[],
};
let isSuper = true;

interface TestUser {
	id: string;
	email: string;
	tenantId: string;
	token: string;
}

async function makeUser(opts: { tenantId: string; admin?: boolean; role?: string }): Promise<TestUser> {
	const id = `f2c-user-${randomUUID()}`;
	const email = `${id}@f2c.test`;
	cleanup.users.push(id);
	await withMigrator(async (c) => {
		await c.query(
			"INSERT INTO users (id, email, password_hash, tenant_id, is_platform_admin) VALUES ($1, $2, 'x', $3, $4)",
			[id, email, opts.tenantId, opts.admin === true],
		);
		await c.query("INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)", [
			id,
			opts.tenantId,
			opts.role ?? "owner",
		]);
	});
	const token = signJwt({ sub: id, email, tenantId: opts.tenantId, role: opts.role ?? "owner" });
	return { id, email, tenantId: opts.tenantId, token };
}

async function makeDbKey(user: TestUser, scopes: string[] = []): Promise<string> {
	const key = `osx_${randomUUID().replaceAll("-", "")}`;
	const id = `f2c-key-${randomUUID()}`;
	cleanup.keys.push(id);
	await withMigrator((c) =>
		c.query(
			"INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name, scopes) VALUES ($1, $2, $3, $4, 'f2c', $5)",
			[id, user.tenantId, user.id, sha(key), scopes],
		),
	);
	return key;
}

let ownerA: TestUser;
let ownerA2: TestUser;
let ownerB: TestUser;
let admin: TestUser;
let viewerA: TestUser;

beforeAll(async () => {
	const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await probe.connect();
	try {
		isSuper =
			(await probe.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]?.rolsuper === true;
	} finally {
		await probe.end();
	}
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
	ownerA = await makeUser({ tenantId: TENANT_A });
	ownerA2 = await makeUser({ tenantId: TENANT_A });
	ownerB = await makeUser({ tenantId: TENANT_B });
	viewerA = await makeUser({ tenantId: TENANT_A, role: "viewer" });
	admin = await makeUser({ tenantId: TENANT_A, admin: true });
});

afterAll(async () => {
	await withMigrator(async (c) => {
		await c.query("DELETE FROM agent_skills WHERE agent_id = ANY($1)", [cleanup.projectAgents]);
		if (cleanup.projectAgents.length)
			await c.query("DELETE FROM project_agents WHERE id = ANY($1)", [cleanup.projectAgents]);
		if (cleanup.approvals.length) {
			await c.query("DELETE FROM approval_events WHERE approval_id = ANY($1)", [cleanup.approvals]);
			await c.query("DELETE FROM approvals WHERE id = ANY($1)", [cleanup.approvals]);
		}
		if (cleanup.keys.length) await c.query("DELETE FROM api_keys WHERE id = ANY($1)", [cleanup.keys]);
		if (cleanup.projects.length) await c.query("DELETE FROM projects WHERE id = ANY($1)", [cleanup.projects]);
		if (cleanup.agentConfigs.length)
			await c.query("DELETE FROM agent_configs WHERE id = ANY($1)", [cleanup.agentConfigs]);
		if (cleanup.templates.length)
			await c.query("DELETE FROM project_templates WHERE id = ANY($1)", [cleanup.templates]);
		if (cleanup.skills.length) await c.query("DELETE FROM skills WHERE id = ANY($1)", [cleanup.skills]);
		if (cleanup.taskTypes.length)
			await c.query("DELETE FROM learning_patterns WHERE task_type = ANY($1)", [cleanup.taskTypes]);
		if (cleanup.users.length) await c.query("DELETE FROM users WHERE id = ANY($1)", [cleanup.users]);
	});
});

function call(user: TestUser | { token: string }, method: string, path: string, body?: unknown) {
	return runOutsideScope(async () =>
		studioRoutes.request(path, {
			method,
			headers: { Authorization: `Bearer ${user.token}`, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

function ctxMock(vars: Record<string, unknown>): any {
	const store: Record<string, unknown> = { ...vars };
	return {
		req: { header: () => undefined },
		get: (k: string) => store[k],
		set: (k: string, v: unknown) => {
			store[k] = v;
		},
		json: (body: unknown, status = 200) => ({ body, status }),
	};
}

function authCtx(authHeader?: string): any {
	const store: Record<string, unknown> = {};
	return {
		req: {
			path: "/projects",
			method: "GET",
			header: (n: string) => (n.toLowerCase() === "authorization" ? authHeader : undefined),
		},
		get: (k: string) => store[k],
		set: (k: string, v: unknown) => {
			store[k] = v;
		},
		json: (body: unknown, status = 200) => ({ body, status }),
		_store: store,
	};
}

const NOT_AUTH_ERR = (s: number) => s !== 401 && s !== 403;

// ---------------------------------------------------------------------------
// 1. isPlatformAdmin resolution + platform:admin permission
// ---------------------------------------------------------------------------

describe("isPlatformAdmin resolution (auth-middleware)", () => {
	it("JWT of a non-admin user → false even with role=owner in the token", async () => {
		const c = authCtx(`Bearer ${ownerA.token}`);
		await authMiddleware(c, async () => {});
		expect(c._store.isPlatformAdmin).toBe(false);
	});

	it("JWT of an admin user → true (read from users.is_platform_admin)", async () => {
		const c = authCtx(`Bearer ${admin.token}`);
		await authMiddleware(c, async () => {});
		expect(c._store.isPlatformAdmin).toBe(true);
	});

	it("JWT whose user no longer exists → not admin", async () => {
		const ghost = signJwt({ sub: `ghost-${randomUUID()}`, email: "g@x.test", tenantId: TENANT_A, role: "owner" });
		const c = authCtx(`Bearer ${ghost}`);
		await authMiddleware(c, async () => {});
		expect(c._store.isPlatformAdmin ?? false).toBe(false);
	});

	it("admin flag revoked in DB takes effect on the next request (not cached in token)", async () => {
		const u = await makeUser({ tenantId: TENANT_A, admin: true });
		let c = authCtx(`Bearer ${u.token}`);
		await authMiddleware(c, async () => {});
		expect(c._store.isPlatformAdmin).toBe(true);
		await withMigrator((cl) => cl.query("UPDATE users SET is_platform_admin = false WHERE id = $1", [u.id]));
		c = authCtx(`Bearer ${u.token}`);
		await authMiddleware(c, async () => {});
		expect(c._store.isPlatformAdmin).toBe(false);
	});

	it("DB API key of an admin user → true; of a normal user → false (system-scope lookup, strict mode)", async () => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		const adminKey = await makeDbKey(admin);
		const userKey = await makeDbKey(ownerA);
		const c1 = authCtx(`Bearer ${adminKey}`);
		await authMiddleware(c1, async () => {});
		expect(c1._store.isPlatformAdmin).toBe(true);
		const c2 = authCtx(`Bearer ${userKey}`);
		await authMiddleware(c2, async () => {});
		expect(c2._store.isPlatformAdmin).toBe(false);
	});

	it("legacy OSCORPEX_API_KEY operator key → true", async () => {
		process.env.OSCORPEX_API_KEY = "f2c-operator-key";
		const c = authCtx("Bearer f2c-operator-key");
		await authMiddleware(c, async () => {});
		expect(c._store.isPlatformAdmin).toBe(true);
	});

	it("dev bypass → true", async () => {
		Reflect.deleteProperty(process.env, "OSCORPEX_AUTH_ENABLED");
		process.env.OSCORPEX_DEV_NO_AUTH = "true";
		const c = authCtx(undefined);
		await authMiddleware(c, async () => {});
		expect(c._store.isPlatformAdmin).toBe(true);
	});
});

describe("platform:admin permission", () => {
	it("no role grants it (hasPermission)", () => {
		for (const r of ["owner", "admin", "developer", "viewer", "billing"]) {
			expect(hasPermission(r, "platform:admin")).toBe(false);
		}
	});

	it("requirePermission: tenant owner → 403", async () => {
		const res: any = await requirePermission("platform:admin")(
			ctxMock({ authType: "jwt", userRole: "owner", isPlatformAdmin: false }),
			async () => {},
		);
		expect(res.status).toBe(403);
	});

	it("requirePermission: isPlatformAdmin → next()", async () => {
		let called = false;
		await requirePermission("platform:admin")(
			ctxMock({ authType: "jwt", userRole: "viewer", isPlatformAdmin: true }),
			async () => {
				called = true;
			},
		);
		expect(called).toBe(true);
	});

	it("requirePermission: API-key scopes ('*' or 'platform:*') never grant it", async () => {
		for (const scopes of [["*"], ["platform:*"], ["platform:admin"]]) {
			const res: any = await requirePermission("platform:admin")(
				ctxMock({ authType: "api-key-db", userRole: "owner", apiKeyScopes: scopes, isPlatformAdmin: false }),
				async () => {},
			);
			expect(res?.status).toBe(403);
		}
	});

	it("requirePermission: legacy env key without the flag is not enough (flag is authoritative)", async () => {
		const res: any = await requirePermission("platform:admin")(
			ctxMock({ authType: "api-key", isPlatformAdmin: false }),
			async () => {},
		);
		expect(res?.status).toBe(403);
	});
});

// ---------------------------------------------------------------------------
// 2. route-permissions: platform-admin tables → platform:admin
// ---------------------------------------------------------------------------

type W = [method: string, path: string];
/** Each global/system table with writer "platform-admin" → its HTTP write routes. */
const PLATFORM_ADMIN_TABLE_ROUTES: Record<string, { routes: W[]; mayBeUnrouted?: true }> = {
	ai_providers: {
		routes: [
			["POST", "/providers"],
			["PUT", "/providers/p1"],
			["PATCH", "/providers/p1"],
			["DELETE", "/providers/p1"],
			["POST", "/providers/p1/default"],
			["POST", "/providers/p1/test"],
			["POST", "/providers/test"],
			["POST", "/providers/default"],
			["PUT", "/providers/fallback-chain"],
		],
	},
	registered_plugins: {
		routes: [
			["POST", "/plugins"],
			["PATCH", "/plugins/p1"],
			["PUT", "/plugins/p1"],
			["DELETE", "/plugins/p1"],
		],
	},
	operator_flags: {
		routes: [
			["POST", "/actions"],
			["POST", "/actions/pause-queue"],
			["POST", "/actions/resume-queue"],
			["POST", "/actions/provider-disable"],
			["POST", "/actions/provider-enable"],
			["POST", "/actions/reset-cooldown"],
		],
	},
	operator_actions: {
		routes: [
			["POST", "/actions/retry-task"],
			["POST", "/actions/cancel-task"],
		],
	},
	provider_runtime_registry: {
		routes: [
			["POST", "/registry"],
			["PUT", "/registry/providers/p1"],
			["POST", "/provider-ops"],
			["POST", "/provider-ops/p1"],
			["PUT", "/cli-usage/providers/p1/settings"],
		],
	},
	capability_snapshots: { routes: [["POST", "/registry/providers/p1"]] },
	team_templates: {
		routes: [
			["POST", "/team-templates"],
			["PUT", "/team-templates/t1"],
			["DELETE", "/team-templates/t1"],
		],
		mayBeUnrouted: true,
	},
	agent_strategies: {
		routes: [
			["POST", "/agent-strategies"],
			["PUT", "/agent-strategies/a1"],
		],
		mayBeUnrouted: true,
	},
};

describe("route-permissions: platform:admin for global/system writes", () => {
	it("route map covers exactly the platform-admin tables in table-classification.ts", () => {
		const fromClassification = Object.entries(TABLE_CLASSIFICATION as Record<string, { writer: string }>)
			.filter(([, v]) => v.writer === "platform-admin")
			.map(([k]) => k)
			.sort();
		expect(Object.keys(PLATFORM_ADMIN_TABLE_ROUTES).sort()).toEqual(fromClassification);
	});

	for (const [table, { routes, mayBeUnrouted }] of Object.entries(PLATFORM_ADMIN_TABLE_ROUTES)) {
		for (const [method, path] of routes) {
			it(`${table}: ${method} ${path} requires platform:admin`, () => {
				const perm = getRoutePermission(path, method);
				if (mayBeUnrouted && perm === undefined) {
					expect(isKnownRoute(path, method)).toBe(false); // default-deny is acceptable for unrouted writers
					return;
				}
				expect(perm).toBe("platform:admin");
			});
		}
	}

	it.each([
		["GET", "/platform/stats"],
		["GET", "/platform/analytics"],
	])("%s %s requires platform:admin", (m, p) => {
		expect(getRoutePermission(p, m)).toBe("platform:admin");
	});

	it("read routes stay readable by tenant roles (GET /providers is not platform:admin)", () => {
		expect(getRoutePermission("/providers", "GET")).not.toBe("platform:admin");
		expect(getRoutePermission("/plugins", "GET")).not.toBe("platform:admin");
	});
});

describe("platform:admin — behavioral (real studio router)", () => {
	it("tenant owner → 403 on POST /providers; admin is allowed", async () => {
		expect((await call(ownerA, "POST", "/providers", {})).status).toBe(403);
		expect(NOT_AUTH_ERR((await call(admin, "POST", "/providers", {})).status)).toBe(true);
	});

	it("tenant owner → 403 on PATCH /plugins/:id; admin gets past authz", async () => {
		const id = `f2c-no-such-plugin-${randomUUID()}`;
		expect((await call(ownerA, "PATCH", `/plugins/${id}`, { enabled: false })).status).toBe(403);
		expect(NOT_AUTH_ERR((await call(admin, "PATCH", `/plugins/${id}`, { enabled: false })).status)).toBe(true);
	});

	it("tenant owner → 403 on an operator flag write; admin gets past authz", async () => {
		expect((await call(ownerA, "POST", "/actions", {})).status).toBe(403);
		expect(NOT_AUTH_ERR((await call(admin, "POST", "/actions", {})).status)).toBe(true);
	});

	it("DB API key with '*' scope of a non-admin user → 403 on POST /providers", async () => {
		const key = await makeDbKey(ownerA, ["*"]);
		expect((await call({ token: key }, "POST", "/providers", {})).status).toBe(403);
	});

	it("legacy operator key may write providers", async () => {
		Reflect.deleteProperty(process.env, "OSCORPEX_AUTH_ENABLED");
		process.env.OSCORPEX_API_KEY = "f2c-operator-key";
		expect(NOT_AUTH_ERR((await call({ token: "f2c-operator-key" }, "POST", "/providers", {})).status)).toBe(true);
	});

	it("GET /platform/stats: owner → 403; admin → 200 aggregates only (no project names/ids)", async () => {
		const pid = `f2c-${randomUUID()}`;
		const pname = `f2c-secret-name-${randomUUID()}`;
		cleanup.projects.push(pid);
		await withMigrator((c) =>
			c.query("INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, $2, now(), now(), $3)", [
				pid,
				pname,
				TENANT_A,
			]),
		);
		expect((await call(ownerA, "GET", "/platform/stats")).status).toBe(403);
		const res = await call(admin, "GET", "/platform/stats");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain(pname);
		expect(text).not.toContain(pid);
		expect(JSON.parse(text).recentProjects ?? []).toEqual([]);
	});

	it("platform stats repo uses sys_platform_stats()", () => {
		expect(readFileSync(join(SRC, "db/platform-stats-repo.ts"), "utf8")).toContain("sys_platform_stats");
	});
});

// ---------------------------------------------------------------------------
// 3. Mixed tables
// ---------------------------------------------------------------------------

describe("agent_configs — presets are platform-admin only", () => {
	async function seedAgentConfig(isPreset: boolean): Promise<string> {
		const id = `f2c-agent-${randomUUID()}`;
		cleanup.agentConfigs.push(id);
		await withMigrator((c) =>
			c.query("INSERT INTO agent_configs (id, name, role, is_preset) VALUES ($1, 'f2c', 'coder', $2)", [
				id,
				isPreset ? 1 : 0,
			]),
		);
		return id;
	}

	it("POST /agents with isPreset=true → 403 for a tenant owner", async () => {
		const res = await call(ownerA, "POST", "/agents", { name: "f2c-preset", role: "coder", isPreset: true });
		expect(res.status).toBe(403);
	});

	it("POST /agents with isPreset=true by platform admin creates a preset", async () => {
		const res = await call(admin, "POST", "/agents", { name: "f2c-preset", role: "coder", isPreset: true });
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; isPreset: boolean };
		cleanup.agentConfigs.push(body.id);
		expect(body.isPreset).toBe(true);
	});

	it("POST /agents (normal) by a tenant owner stays allowed and is never a preset", async () => {
		const res = await call(ownerA, "POST", "/agents", { name: "f2c-normal", role: "coder" });
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; isPreset: boolean };
		cleanup.agentConfigs.push(body.id);
		expect(body.isPreset).toBe(false);
	});

	it("PUT / DELETE on an existing preset → 403 for tenant owner; row untouched", async () => {
		const id = await seedAgentConfig(true);
		expect((await call(ownerA, "PUT", `/agents/${id}`, { name: "hijacked" })).status).toBe(403);
		expect((await call(ownerA, "DELETE", `/agents/${id}`)).status).toBe(403);
		const rows = await withMigrator((c) => c.query("SELECT name FROM agent_configs WHERE id = $1", [id]));
		expect(rows.rows[0]?.name).toBe("f2c");
	});

	it("PUT on a preset by platform admin succeeds", async () => {
		const id = await seedAgentConfig(true);
		const res = await call(admin, "PUT", `/agents/${id}`, { name: "renamed-by-admin" });
		expect(res.status).toBe(200);
	});

	it("PUT on a non-preset by tenant owner succeeds but cannot flip isPreset", async () => {
		const id = await seedAgentConfig(false);
		const res = await call(ownerA, "PUT", `/agents/${id}`, { name: "ok", isPreset: true });
		expect([200, 400, 403]).toContain(res.status);
		const rows = await withMigrator((c) => c.query("SELECT is_preset FROM agent_configs WHERE id = $1", [id]));
		expect(Number(rows.rows[0]?.is_preset)).toBe(0);
	});
});

describe("project_templates — public admin-only, private author-only", () => {
	async function seedTemplate(opts: { isPublic: boolean; authorId: string | null }): Promise<string> {
		const id = `f2c-tpl-${randomUUID()}`;
		cleanup.templates.push(id);
		await withMigrator((c) =>
			c.query("INSERT INTO project_templates (id, name, is_public, author_id) VALUES ($1, 'f2c-tpl', $2, $3)", [
				id,
				opts.isPublic,
				opts.authorId,
			]),
		);
		return id;
	}

	it("create with isPublic=true → 403 for tenant owner", async () => {
		const res = await call(ownerA, "POST", "/templates", { name: "f2c-public", isPublic: true });
		expect(res.status).toBe(403);
	});

	it("create by tenant owner: author is the caller, never the body's authorId", async () => {
		const res = await call(ownerA, "POST", "/templates", { name: "f2c-mine", authorId: ownerB.id });
		expect([201, 400]).toContain(res.status);
		if (res.status === 201) {
			const body = (await res.json()) as { id: string; authorId: string | null; isPublic?: boolean };
			cleanup.templates.push(body.id);
			expect(body.authorId).toBe(ownerA.id);
			const row = await withMigrator((c) =>
				c.query("SELECT author_id FROM project_templates WHERE id = $1", [body.id]),
			);
			expect(row.rows[0].author_id).toBe(ownerA.id);
		}
	});

	it("update to is_public=true → 403 for the (non-admin) author", async () => {
		const id = await seedTemplate({ isPublic: false, authorId: ownerA.id });
		expect((await call(ownerA, "PATCH", `/templates/${id}`, { isPublic: true })).status).toBe(403);
	});

	it("PATCH/DELETE of a private template by someone else → 404, row unchanged", async () => {
		const id = await seedTemplate({ isPublic: false, authorId: ownerA.id });
		expect((await call(ownerA2, "PATCH", `/templates/${id}`, { name: "hijack" })).status).toBe(404);
		expect((await call(ownerB, "PATCH", `/templates/${id}`, { name: "hijack" })).status).toBe(404);
		expect((await call(ownerA2, "DELETE", `/templates/${id}`)).status).toBe(404);
		const row = await withMigrator((c) => c.query("SELECT name FROM project_templates WHERE id = $1", [id]));
		expect(row.rows[0]?.name).toBe("f2c-tpl");
	});

	it("author can PATCH and DELETE their private template", async () => {
		const id = await seedTemplate({ isPublic: false, authorId: ownerA.id });
		expect((await call(ownerA, "PATCH", `/templates/${id}`, { name: "renamed" })).status).toBe(200);
		expect((await call(ownerA, "DELETE", `/templates/${id}`)).status).toBe(200);
		const row = await withMigrator((c) => c.query("SELECT 1 FROM project_templates WHERE id = $1", [id]));
		expect(row.rowCount).toBe(0);
	});

	it("authorId in the PATCH body cannot transfer ownership", async () => {
		const id = await seedTemplate({ isPublic: false, authorId: ownerA.id });
		await call(ownerA, "PATCH", `/templates/${id}`, { name: "x", authorId: ownerA2.id });
		const row = await withMigrator((c) => c.query("SELECT author_id FROM project_templates WHERE id = $1", [id]));
		expect(row.rows[0]?.author_id).toBe(ownerA.id);
	});

	it("list excludes other users' private templates but includes own and public ones", async () => {
		const priv = await seedTemplate({ isPublic: false, authorId: ownerA.id });
		const pub = await seedTemplate({ isPublic: true, authorId: null });
		const ids = async (u: TestUser) =>
			((await (await call(u, "GET", "/templates?limit=200")).json()) as Array<{ id: string }>).map((t) => t.id);
		const asOwner = await ids(ownerA);
		expect(asOwner).toContain(priv);
		expect(asOwner).toContain(pub);
		const asOther = await ids(ownerA2);
		expect(asOther).not.toContain(priv);
		expect(asOther).toContain(pub);
	});

	it("GET /templates/:id of another user's private template → 404 (IDOR); author and platform admin can read it", async () => {
		const id = await seedTemplate({ isPublic: false, authorId: ownerA.id });
		expect((await call(ownerA2, "GET", `/templates/${id}`)).status).toBe(404);
		expect((await call(ownerB, "GET", `/templates/${id}`)).status).toBe(404);
		expect((await call(ownerA, "GET", `/templates/${id}`)).status).toBe(200);
		expect((await call(admin, "GET", `/templates/${id}`)).status).toBe(200);
	});

	it("GET /templates/:id of a public template is readable by any authenticated user", async () => {
		const id = await seedTemplate({ isPublic: true, authorId: ownerA.id });
		for (const u of [ownerA, ownerA2, ownerB, viewerA]) {
			expect((await call(u, "GET", `/templates/${id}`)).status).toBe(200);
		}
	});

	it("platform admin can update/delete a public template", async () => {
		const id = await seedTemplate({ isPublic: true, authorId: null });
		expect((await call(admin, "PATCH", `/templates/${id}`, { name: "by-admin" })).status).toBe(200);
		expect((await call(admin, "DELETE", `/templates/${id}`)).status).toBe(200);
	});
});

describe("skills — global admin-only, personal creator-only", () => {
	async function seedSkill(opts: {
		isGlobal: boolean;
		createdBy: string | null;
		tenantId?: string | null;
	}): Promise<string> {
		const id = `f2c-skill-${randomUUID()}`;
		cleanup.skills.push(id);
		await withMigrator((c) =>
			c.query(
				"INSERT INTO skills (id, name, description, is_global, created_by, tenant_id) VALUES ($1, 'f2c-skill', '', $2, $3, $4)",
				[id, opts.isGlobal, opts.createdBy, opts.tenantId ?? null],
			),
		);
		return id;
	}
	const skillBody = (extra: Record<string, unknown> = {}) => ({ name: "f2c-skill", contentMd: "# x", ...extra });

	it("create is_global=true → 403 for tenant owner; admin allowed", async () => {
		expect((await call(ownerA, "POST", "/skills", skillBody({ isGlobal: true }))).status).toBe(403);
		const res = await call(admin, "POST", "/skills", skillBody({ isGlobal: true }));
		expect(res.status).toBe(201);
		cleanup.skills.push(((await res.json()) as { id: string }).id);
	});

	it("non-global create records the caller as created_by", async () => {
		const res = await call(ownerA, "POST", "/skills", skillBody());
		expect(res.status).toBe(201);
		const id = ((await res.json()) as { id: string }).id;
		cleanup.skills.push(id);
		const row = await withMigrator((c) => c.query("SELECT created_by FROM skills WHERE id = $1", [id]));
		expect(row.rows[0].created_by).toBe(ownerA.id);
	});

	it("PUT/DELETE of a personal skill by someone else is refused; by the creator allowed", async () => {
		const id = await seedSkill({ isGlobal: false, createdBy: ownerA.id, tenantId: TENANT_A });
		expect([403, 404]).toContain((await call(ownerA2, "PUT", `/skills/${id}`, { name: "hijack" })).status);
		expect([403, 404]).toContain((await call(ownerA2, "DELETE", `/skills/${id}`)).status);
		const still = await withMigrator((c) => c.query("SELECT name FROM skills WHERE id = $1", [id]));
		expect(still.rows[0]?.name).toBe("f2c-skill");
		expect((await call(ownerA, "PUT", `/skills/${id}`, { name: "mine" })).status).toBe(200);
		expect((await call(ownerA, "DELETE", `/skills/${id}`)).status).toBe(200);
	});

	it("making an own skill global requires admin", async () => {
		const id = await seedSkill({ isGlobal: false, createdBy: ownerA.id, tenantId: TENANT_A });
		expect((await call(ownerA, "PUT", `/skills/${id}`, { isGlobal: true })).status).toBe(403);
		const row = await withMigrator((c) => c.query("SELECT is_global FROM skills WHERE id = $1", [id]));
		expect(row.rows[0].is_global).toBe(false);
	});

	it("global skill: PUT/DELETE refused for tenant owner (even its 'creator'); allowed for admin", async () => {
		const id = await seedSkill({ isGlobal: true, createdBy: ownerA.id });
		expect([403, 404]).toContain((await call(ownerA, "PUT", `/skills/${id}`, { name: "x" })).status);
		expect([403, 404]).toContain((await call(ownerA, "DELETE", `/skills/${id}`)).status);
		expect((await call(admin, "PUT", `/skills/${id}`, { name: "by-admin" })).status).toBe(200);
	});

	describe("agent skill assignment", () => {
		let skillId: string;
		let agentId: string;
		beforeAll(async () => {
			skillId = await seedSkill({ isGlobal: true, createdBy: null });
			const pid = `f2c-${randomUUID()}`;
			agentId = `f2c-pa-${randomUUID()}`;
			cleanup.projects.push(pid);
			cleanup.projectAgents.push(agentId);
			await withMigrator(async (c) => {
				await c.query(
					"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2c', now(), now(), $2)",
					[pid, TENANT_A],
				);
				await c.query(
					"INSERT INTO project_agents (id, project_id, name, role, created_at) VALUES ($1, $2, 'a', 'coder', now())",
					[agentId, pid],
				);
			});
		});

		it("unknown agent → 404 (POST and DELETE)", async () => {
			const ghost = `f2c-ghost-${randomUUID()}`;
			expect((await call(ownerA, "POST", `/agents/${ghost}/skills`, { skillId })).status).toBe(404);
			expect((await call(ownerA, "DELETE", `/agents/${ghost}/skills/${skillId}`)).status).toBe(404);
		});

		it("agent of own tenant's project → assignment works", async () => {
			expect((await call(ownerA, "POST", `/agents/${agentId}/skills`, { skillId })).status).toBe(200);
			expect((await call(ownerA, "DELETE", `/agents/${agentId}/skills/${skillId}`)).status).toBe(200);
		});

		it("(non-superuser runtime) agent in another tenant's project → 404, nothing assigned", async (ctx) => {
			if (isSuper) return ctx.skip();
			expect((await call(ownerB, "POST", `/agents/${agentId}/skills`, { skillId })).status).toBe(404);
			const rows = await withMigrator((c) => c.query("SELECT 1 FROM agent_skills WHERE agent_id = $1", [agentId]));
			expect(rows.rowCount).toBe(0);
			expect((await call(ownerB, "DELETE", `/agents/${agentId}/skills/${skillId}`)).status).toBe(404);
		});
	});
});

describe("learning promote — tenant check", () => {
	async function seedPattern(tenantId: string): Promise<string> {
		const id = `f2c-lp-${randomUUID()}`;
		const taskType = `f2c-${randomUUID()}`;
		cleanup.taskTypes.push(taskType);
		await withMigrator((c) =>
			c.query(
				`INSERT INTO learning_patterns (id, tenant_id, learning_type, task_type, agent_role, pattern, sample_count, success_rate)
				 VALUES ($1, $2, 'success_pattern', $3, 'backend-dev', '{}', 3, 0.9)`,
				[id, tenantId, taskType],
			),
		);
		return id;
	}

	it("another tenant's pattern → 404 and no global copy is created", async () => {
		const id = await seedPattern(TENANT_A);
		const res = await call(ownerB, "POST", `/learning/promote/${id}`);
		expect(res.status).toBe(404);
		const tt = (await withMigrator((c) => c.query("SELECT task_type FROM learning_patterns WHERE id = $1", [id])))
			.rows[0].task_type;
		const globals = await withMigrator((c) =>
			c.query("SELECT 1 FROM learning_patterns WHERE task_type = $1 AND is_global = true", [tt]),
		);
		expect(globals.rowCount).toBe(0);
	});

	it("own tenant's pattern → promoted", async () => {
		const id = await seedPattern(TENANT_A);
		const res = await call(ownerA, "POST", `/learning/promote/${id}`);
		expect(res.status).toBe(200);
	});

	it("unknown pattern → 404", async () => {
		expect((await call(ownerA, "POST", `/learning/promote/f2c-none-${randomUUID()}`)).status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// 4. Operator command: admin-grant
// ---------------------------------------------------------------------------

describe("admin-grant operator command", () => {
	const migrationUrl = process.env.OSCORPEX_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
	const flag = async (id: string) =>
		(await withMigrator((c) => c.query("SELECT is_platform_admin FROM users WHERE id = $1", [id]))).rows[0]
			?.is_platform_admin;

	it("grant → true, revoke → false, idempotent", async () => {
		const { grantPlatformAdmin, revokePlatformAdmin } = await import("../../../scripts/admin-grant.js");
		const u = await makeUser({ tenantId: TENANT_A });
		expect(await flag(u.id)).toBe(false);
		await grantPlatformAdmin(u.email, { migrationUrl });
		expect(await flag(u.id)).toBe(true);
		await grantPlatformAdmin(u.email, { migrationUrl });
		expect(await flag(u.id)).toBe(true);
		await revokePlatformAdmin(u.email, { migrationUrl });
		expect(await flag(u.id)).toBe(false);
	});

	it("only touches the named user", async () => {
		const { grantPlatformAdmin } = await import("../../../scripts/admin-grant.js");
		const a = await makeUser({ tenantId: TENANT_A });
		const b = await makeUser({ tenantId: TENANT_A });
		await grantPlatformAdmin(a.email, { migrationUrl });
		expect(await flag(b.id)).toBe(false);
	});

	it("unknown email rejects (grant and revoke)", async () => {
		const { grantPlatformAdmin, revokePlatformAdmin } = await import("../../../scripts/admin-grant.js");
		await expect(grantPlatformAdmin(`nobody-${randomUUID()}@f2c.test`, { migrationUrl })).rejects.toThrow();
		await expect(revokePlatformAdmin(`nobody-${randomUUID()}@f2c.test`, { migrationUrl })).rejects.toThrow();
	});

	it("is injection-safe (email passed as a parameter)", async () => {
		const { grantPlatformAdmin } = await import("../../../scripts/admin-grant.js");
		const u = await makeUser({ tenantId: TENANT_A });
		await expect(grantPlatformAdmin("x' OR '1'='1", { migrationUrl })).rejects.toThrow();
		expect(await flag(u.id)).toBe(false);
	});

	it("in production without a migration URL it refuses (no fallback to DATABASE_URL)", async () => {
		const { grantPlatformAdmin } = await import("../../../scripts/admin-grant.js");
		const prev = { n: process.env.NODE_ENV, m: process.env.OSCORPEX_MIGRATION_DATABASE_URL };
		process.env.NODE_ENV = "production";
		Reflect.deleteProperty(process.env, "OSCORPEX_MIGRATION_DATABASE_URL");
		try {
			await expect(grantPlatformAdmin("whoever@f2c.test")).rejects.toThrow();
		} finally {
			process.env.NODE_ENV = prev.n;
			if (prev.m === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_MIGRATION_DATABASE_URL");
			else process.env.OSCORPEX_MIGRATION_DATABASE_URL = prev.m;
		}
	});

	it("(non-superuser runtime) the app role cannot write is_platform_admin", async (ctx) => {
		if (isSuper) return ctx.skip();
		const u = await makeUser({ tenantId: TENANT_A });
		const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			await expect(client.query("UPDATE users SET is_platform_admin = true WHERE id = $1", [u.id])).rejects.toThrow();
		} finally {
			await client.end();
		}
		expect(await flag(u.id)).toBe(false);
	});

	it("package.json has admin:grant / admin:revoke scripts", () => {
		const pkg = JSON.parse(readFileSync(join(KERNEL, "package.json"), "utf8")) as { scripts: Record<string, string> };
		expect(pkg.scripts["admin:grant"]).toContain("admin-grant");
		expect(pkg.scripts["admin:revoke"]).toContain("admin-grant");
	});
});

// ---------------------------------------------------------------------------
// 5. Approval route split
// ---------------------------------------------------------------------------

describe("approval routes: control-plane moved to /control-plane/approvals", () => {
	/** Seeds a pending approval; by default under a fresh TENANT_A project (project-less ones are platform-admin only). */
	async function seedApproval(opts: { projectId?: string | null } = {}): Promise<string> {
		const id = `f2c-appr-${randomUUID()}`;
		cleanup.approvals.push(id);
		let projectId = opts.projectId;
		if (projectId === undefined) projectId = await seedProject(TENANT_A);
		await withMigrator((c) =>
			c.query(
				`INSERT INTO approvals (id, project_id, kind, status, title, description, requested_by, expires_at, escalated)
				 VALUES ($1, $2, 'deploy', 'pending', 'f2c', '', 'someone', now() + interval '1 hour', false)`,
				[id, projectId],
			),
		);
		return id;
	}

	async function seedProject(tenantId: string): Promise<string> {
		const pid = `f2c-appr-proj-${randomUUID()}`;
		cleanup.projects.push(pid);
		await withMigrator((c) =>
			c.query(
				"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2c', now(), now(), $2)",
				[pid, tenantId],
			),
		);
		return pid;
	}

	it("quality-gate GET /approvals/pending is no longer shadowed by control-plane GET /approvals/:id", async () => {
		const res = await call(ownerA, "GET", "/approvals/pending?goalId=f2c-nonexistent-goal");
		const body = (await res.json()) as { ok?: boolean; error?: string; approval?: unknown };
		// control-plane handler would answer { error: "Approval not found" }
		expect(body.error).not.toBe("Approval not found");
		// quality-gate handler: unknown goal → 404 "execution goal not found: <goalId>"
		expect(res.status).toBe(404);
		expect(body.error).toMatch(/execution goal not found/i);
	});

	it("quality-gate POST /approvals/:id/approve and /reject reach the quality-gate handler", async () => {
		for (const verb of ["approve", "reject"]) {
			const res = await call(ownerA, "POST", `/approvals/f2c-none-${randomUUID()}/${verb}`, {});
			const body = (await res.json()) as { error?: string; approval?: unknown };
			expect(res.status).not.toBe(200);
			// control-plane handler answers exactly { error: "Approval not found" } (404)
			expect(body.error).not.toBe("Approval not found");
			expect(body.approval).toBeUndefined();
		}
	});

	it("control-plane list/get live under /control-plane/approvals", async () => {
		const id = await seedApproval();
		const list = await call(ownerA, "GET", "/control-plane/approvals");
		expect(list.status).toBe(200);
		expect(Array.isArray(((await list.json()) as { approvals: unknown[] }).approvals)).toBe(true);
		expect((await call(ownerA, "GET", `/control-plane/approvals/${id}`)).status).toBe(200);
		expect((await call(ownerA, "GET", `/control-plane/approvals/f2c-none-${randomUUID()}`)).status).toBe(404);
	});

	it("approve records the authenticated user as actor; body actor is ignored", async () => {
		const id = await seedApproval();
		const res = await call(ownerA, "POST", `/control-plane/approvals/${id}/approve`, { actor: "spoofed-actor" });
		expect(res.status).toBe(200);
		const row = (await withMigrator((c) => c.query("SELECT approved_by FROM approvals WHERE id = $1", [id]))).rows[0];
		expect(row.approved_by).not.toBe("spoofed-actor");
		expect([ownerA.id, ownerA.email]).toContain(row.approved_by);
		const ev = await withMigrator((c) => c.query("SELECT actor FROM approval_events WHERE approval_id = $1", [id]));
		expect(ev.rows.map((r) => r.actor)).not.toContain("spoofed-actor");
	});

	it("reject records the authenticated user as actor; body actor is ignored", async () => {
		const id = await seedApproval();
		const res = await call(ownerA, "POST", `/control-plane/approvals/${id}/reject`, { actor: "spoofed-actor" });
		expect(res.status).toBe(200);
		const row = (await withMigrator((c) => c.query("SELECT rejected_by FROM approvals WHERE id = $1", [id]))).rows[0];
		expect(row.rejected_by).not.toBe("spoofed-actor");
		expect([ownerA.id, ownerA.email]).toContain(row.rejected_by);
	});

	it("escalate records the authenticated user as actor; body actor is ignored", async () => {
		const id = await seedApproval();
		const res = await call(ownerA, "POST", `/control-plane/approvals/${id}/escalate`, {
			target: "ops",
			actor: "spoofed-actor",
		});
		expect(res.status).toBe(200);
		const ev = await withMigrator((c) => c.query("SELECT actor FROM approval_events WHERE approval_id = $1", [id]));
		expect(ev.rows.length).toBeGreaterThan(0);
		expect(ev.rows.map((r) => r.actor)).not.toContain("spoofed-actor");
		expect(ev.rows.map((r) => r.actor)).toContain(ownerA.id);
	});

	describe("project-less approvals are platform-admin only", () => {
		it("non-admin POST /control-plane/approvals without projectId → 400", async () => {
			const res = await call(ownerA, "POST", "/control-plane/approvals", { kind: "deploy", title: "f2c no project" });
			expect(res.status).toBe(400);
		});

		it("non-admin POST with another tenant's projectId → 404", async () => {
			const foreign = await seedProject(TENANT_B);
			const res = await call(ownerA, "POST", "/control-plane/approvals", {
				projectId: foreign,
				kind: "deploy",
				title: "f2c cross-tenant",
			});
			expect(res.status).toBe(404);
			const rows = await withMigrator((c) => c.query("SELECT id FROM approvals WHERE project_id = $1", [foreign]));
			expect(rows.rows).toHaveLength(0);
		});

		it("platform admin can create, list, get and approve a project-less approval", async () => {
			const created = await call(admin, "POST", "/control-plane/approvals", {
				kind: "deploy",
				title: "f2c projectless",
			});
			expect(created.status).toBe(201);
			const id = ((await created.json()) as { approval: { id: string } }).approval.id;
			cleanup.approvals.push(id);

			const list = await call(admin, "GET", "/control-plane/approvals");
			expect(list.status).toBe(200);
			expect(((await list.json()) as { approvals: { id: string }[] }).approvals.map((a) => a.id)).toContain(id);
			expect((await call(admin, "GET", `/control-plane/approvals/${id}`)).status).toBe(200);

			const approved = await call(admin, "POST", `/control-plane/approvals/${id}/approve`, {});
			expect(approved.status).toBe(200);
			const row = (await withMigrator((c) => c.query("SELECT status FROM approvals WHERE id = $1", [id]))).rows[0];
			expect(row.status).toBe("approved");
		});

		it("tenant user does not see a project-less approval in list or get (404), and cannot decide it", async () => {
			const id = await seedApproval({ projectId: null });
			const list = await call(ownerA, "GET", "/control-plane/approvals");
			expect(((await list.json()) as { approvals: { id: string }[] }).approvals.map((a) => a.id)).not.toContain(id);
			expect((await call(ownerA, "GET", `/control-plane/approvals/${id}`)).status).toBe(404);
			expect((await call(ownerA, "POST", `/control-plane/approvals/${id}/approve`, {})).status).toBe(404);
			const row = (await withMigrator((c) => c.query("SELECT status FROM approvals WHERE id = $1", [id]))).rows[0];
			expect(row.status).toBe("pending");
		});
	});

	it("viewer cannot decide control-plane approvals", async () => {
		const id = await seedApproval();
		expect((await call(viewerA, "POST", `/control-plane/approvals/${id}/approve`, {})).status).toBe(403);
	});

	it("route-permissions cover the new paths", () => {
		const paths: W[] = [
			["GET", "/control-plane/approvals"],
			["GET", "/control-plane/approvals/a1"],
			["POST", "/control-plane/approvals"],
			["POST", "/control-plane/approvals/a1/approve"],
			["POST", "/control-plane/approvals/a1/reject"],
			["POST", "/control-plane/approvals/a1/escalate"],
			["POST", "/control-plane/approvals/expire-stale"],
		];
		for (const [m, p] of paths) {
			expect(isKnownRoute(p, m), `${m} ${p}`).toBe(true);
			expect(getRoutePermission(p, m), `${m} ${p}`).toBeTruthy();
		}
		expect(getRoutePermission("/control-plane/approvals/a1/approve", "POST")).toBe("control-plane:operate");
	});

	it("old root-level control-plane approval paths no longer map to control-plane permissions", () => {
		expect(getRoutePermission("/approvals/a1/approve", "POST")).toBe("approvals:decide");
		expect(getRoutePermission("/approvals/pending", "GET")).toBe("approvals:read");
	});

	it("console client calls /control-plane/approvals/…", () => {
		const src = readFileSync(join(CONSOLE, "lib/studio-api/control-plane.ts"), "utf8");
		expect(src).toContain("/api/studio/control-plane/approvals");
		expect(src).not.toMatch(/\/api\/studio\/approvals(?!\/pending)/);
	});
});

// ---------------------------------------------------------------------------
// 6. last_used_at runs in the key's tenant scope
// ---------------------------------------------------------------------------

describe("DB API key last_used_at", () => {
	it("(non-superuser runtime) is updated after an authenticated request", async (ctx) => {
		if (isSuper) return ctx.skip();
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		const key = await makeDbKey(ownerA);
		const keyId = cleanup.keys[cleanup.keys.length - 1];
		const res = await call({ token: key }, "GET", "/projects");
		expect(res.status).toBe(200);
		let last: unknown = null;
		for (let i = 0; i < 30 && !last; i++) {
			await new Promise((r) => setTimeout(r, 100));
			last = (await withMigrator((c) => c.query("SELECT last_used_at FROM api_keys WHERE id = $1", [keyId]))).rows[0]
				?.last_used_at;
		}
		expect(last).toBeTruthy();
	});
});
