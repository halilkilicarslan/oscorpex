// ---------------------------------------------------------------------------
// F2 round 3, item 5 — API key scopes:
//  * POST /auth/api-keys rejects (400/403) any scope the creator's role does not grant, including "*";
//    "platform:admin" only for platform admins.
//  * RBAC: a key's scopes only NARROW access — the request needs both the role permission and the scope.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { requirePermission } from "../auth/rbac.js";
import { authRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import {
	call,
	cleanup,
	mkUser,
	registerCleanup,
	seedDbKey,
	seedProject,
	useAuthEnabledEnv,
} from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();
void cleanup;

let tenantAdmin: SeededUser;
let owner: SeededUser;
let viewer: SeededUser;
let platformAdmin: SeededUser;

beforeAll(async () => {
	tenantAdmin = await mkUser({ tenantId: TENANT_A, role: "admin" });
	owner = await mkUser({ tenantId: TENANT_A, role: "owner" });
	viewer = await mkUser({ tenantId: TENANT_A, role: "viewer" });
	platformAdmin = await mkUser({ tenantId: TENANT_A, role: "owner", admin: true });
});

const createKey = (who: SeededUser, scopes: unknown) =>
	runOutsideScope(async () =>
		authRoutes.request("/api-keys", {
			method: "POST",
			headers: { Authorization: `Bearer ${who.token}`, "content-type": "application/json" },
			body: JSON.stringify({ name: "f2r3", scopes }),
		}),
	);
const keyCount = async (who: SeededUser) =>
	Number(
		(await withMigrator((c) => c.query("SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1", [who.id]))).rows[0]
			.n,
	);
const rejected = (status: number) => status === 400 || status === 403;

describe("POST /auth/api-keys — scopes cannot exceed the creator's role", () => {
	it('tenant admin requesting ["*"] → 400/403 and no key row is stored', async () => {
		const before = await keyCount(tenantAdmin);
		const res = await createKey(tenantAdmin, ["*"]);
		expect(rejected(res.status)).toBe(true);
		expect(await keyCount(tenantAdmin)).toBe(before);
	});

	it("a mix of granted and ungranted scopes is rejected as a whole", async () => {
		const res = await createKey(tenantAdmin, ["projects:read", "billing:write"]);
		expect(rejected(res.status)).toBe(true);
	});

	it('tenant admin requesting a resource wildcard its role does not hold ("projects:*") → rejected', async () => {
		expect(rejected((await createKey(tenantAdmin, ["projects:*"])).status)).toBe(true);
	});

	it("viewer requesting projects:update → rejected", async () => {
		expect(rejected((await createKey(viewer, ["projects:update"])).status)).toBe(true);
	});

	it("unknown / malformed scopes → rejected", async () => {
		expect(rejected((await createKey(tenantAdmin, ["not-a-scope"])).status)).toBe(true);
		expect(rejected((await createKey(tenantAdmin, "projects:read")).status)).toBe(true);
		expect(rejected((await createKey(tenantAdmin, [42])).status)).toBe(true);
	});

	it("scopes the role does grant are accepted (control)", async () => {
		const res = await createKey(tenantAdmin, ["projects:read", "tasks:read"]);
		expect(res.status).toBe(201);
		expect(await keyCount(tenantAdmin)).toBeGreaterThan(0);
		expect((await createKey(owner, ["projects:update"])).status).toBe(201);
		// viewer lacks settings:write → cannot mint keys at all (F2 final items, C)
		expect((await createKey(viewer, ["projects:read"])).status).toBe(403);
	});

	it("platform:admin scope: rejected for a tenant owner, accepted for a platform admin", async () => {
		expect(rejected((await createKey(owner, ["platform:admin"])).status)).toBe(true);
		expect(rejected((await createKey(tenantAdmin, ["platform:admin"])).status)).toBe(true);
		expect((await createKey(platformAdmin, ["platform:admin"])).status).toBe(201);
	});
});

describe("RBAC — scopes only narrow (request needs role permission AND scope)", () => {
	let projectId: string;
	beforeAll(async () => {
		projectId = await seedProject(TENANT_A);
	});
	const withKey = (key: string, method: string, path: string, body?: unknown) =>
		runOutsideScope(async () =>
			(await import("../index.js")).studioRoutes.request(path, {
				method,
				headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);

	it("owner key scoped to projects:read cannot call a projects:update route (role could, scope cannot)", async () => {
		const key = await seedDbKey(owner, ["projects:read"]);
		expect((await withKey(key, "GET", `/projects/${projectId}`)).status).toBe(200);
		expect((await withKey(key, "PATCH", `/projects/${projectId}`, { name: "x" })).status).toBe(403);
	});

	it("viewer key carrying a wider scope (projects:update, seeded directly) is still denied by the role", async () => {
		const key = await seedDbKey(viewer, ["projects:update"]);
		expect((await withKey(key, "PATCH", `/projects/${projectId}`, { name: "x" })).status).toBe(403);
	});

	it('viewer key with scope "*" is still denied write routes', async () => {
		const key = await seedDbKey(viewer, ["*"]);
		expect((await withKey(key, "PATCH", `/projects/${projectId}`, { name: "x" })).status).toBe(403);
	});

	it("owner key with projects:update passes both checks (control)", async () => {
		const key = await seedDbKey(owner, ["projects:update"]);
		expect((await withKey(key, "PATCH", `/projects/${projectId}`, { name: "ok" })).status).not.toBe(403);
	});

	it("keys without scopes keep role-only behaviour (control)", async () => {
		const key = await seedDbKey(viewer, []);
		expect((await withKey(key, "GET", `/projects/${projectId}`)).status).toBe(200);
		expect((await withKey(key, "PATCH", `/projects/${projectId}`, { name: "x" })).status).toBe(403);
	});
});

describe("requirePermission (unit) — api-key-db", () => {
	const run = async (vars: Record<string, unknown>, permission: string) => {
		const app = new Hono();
		app.use("*", async (c, next) => {
			for (const [k, v] of Object.entries(vars)) c.set(k as never, v as never);
			await next();
		});
		app.get("/x", requirePermission(permission), (c) => c.text("ok"));
		return (await app.request("/x")).status;
	};
	const key = (role: string, scopes: string[]) => ({ authType: "api-key-db", userRole: role, apiKeyScopes: scopes });

	it("scope granted but role lacks the permission → 403", async () => {
		expect(await run(key("viewer", ["projects:update"]), "projects:update")).toBe(403);
		expect(await run(key("viewer", ["*"]), "projects:update")).toBe(403);
		expect(await run(key("viewer", ["projects:*"]), "projects:update")).toBe(403);
	});

	it("role grants the permission but scope does not → 403", async () => {
		expect(await run(key("owner", ["projects:read"]), "projects:update")).toBe(403);
	});

	it("both grant → 200 (exact, resource wildcard and * scopes)", async () => {
		expect(await run(key("admin", ["projects:update"]), "projects:update")).toBe(200);
		expect(await run(key("owner", ["projects:*"]), "projects:update")).toBe(200);
		expect(await run(key("owner", ["*"]), "projects:update")).toBe(200);
	});

	it("empty scopes → role only", async () => {
		expect(await run(key("viewer", []), "projects:read")).toBe(200);
		expect(await run(key("viewer", []), "projects:update")).toBe(403);
	});
});
