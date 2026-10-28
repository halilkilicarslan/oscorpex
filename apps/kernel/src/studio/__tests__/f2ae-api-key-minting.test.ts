// ---------------------------------------------------------------------------
// F2 round 3 (final items), C — POST /auth/api-keys minting rules:
//  * requires settings:write (route permission + handler), viewer → 403
//  * an API-key caller may only mint a NON-EMPTY subset of its own key's scopes (empty or extra → 403)
//  * a platform admin's scoped key cannot mint an unscoped key or "platform:admin" unless it holds platform:admin
//  * JWT callers keep the existing rules
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import { getRoutePermission } from "../auth/route-permissions.js";
import { authRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { cleanup, mkUser, registerCleanup, seedDbKey, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();
void cleanup;

let admin: SeededUser;
let viewer: SeededUser;
let developer: SeededUser;
let platformAdmin: SeededUser;

beforeAll(async () => {
	admin = await mkUser({ tenantId: TENANT_A, role: "admin" });
	viewer = await mkUser({ tenantId: TENANT_A, role: "viewer" });
	developer = await mkUser({ tenantId: TENANT_A, role: "developer" });
	platformAdmin = await mkUser({ tenantId: TENANT_A, role: "owner", admin: true });
});

const mintWithJwt = (who: SeededUser, scopes: unknown) =>
	runOutsideScope(async () =>
		authRoutes.request("/api-keys", {
			method: "POST",
			headers: { Authorization: `Bearer ${who.token}`, "content-type": "application/json" },
			body: JSON.stringify({ name: "f2ae", scopes }),
		}),
	);
/** Same handler, authenticated with an API key (authRoutes directly: the studio /auth/* rate limiter is 10/min). */
const mintWithKey = (key: string, scopes: unknown) =>
	runOutsideScope(async () =>
		authRoutes.request("/api-keys", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({ name: "f2ae", scopes }),
		}),
	);
const keyCount = async (who: SeededUser) =>
	Number(
		(await withMigrator((c) => c.query("SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1", [who.id]))).rows[0]
			.n,
	);

describe("POST /auth/api-keys requires settings:write", () => {
	it("route permission matrix: POST /auth/api-keys → settings:write", () => {
		expect(getRoutePermission("/auth/api-keys", "POST")).toBe("settings:write");
	});

	it("viewer → 403 and no key row is stored", async () => {
		const before = await keyCount(viewer);
		expect((await mintWithJwt(viewer, ["projects:read"])).status).toBe(403);
		expect(await keyCount(viewer)).toBe(before);
	});

	it("developer (no settings:write) → 403", async () => {
		expect((await mintWithJwt(developer, ["projects:read"])).status).toBe(403);
	});

	it("admin (holds settings:write) keeps working (control)", async () => {
		expect((await mintWithJwt(admin, ["projects:read"])).status).toBe(201);
	});
});

describe("API-key callers: requested scopes must be a non-empty subset of the key's own scopes", () => {
	const OWN = ["settings:read", "settings:write", "projects:read", "tasks:read"];

	it("empty scope list → 403, no key stored", async () => {
		const key = await seedDbKey(admin, OWN);
		const before = await keyCount(admin);
		expect((await mintWithKey(key, [])).status).toBe(403);
		expect(await keyCount(admin)).toBe(before);
	});

	it("omitted scopes (defaults to unscoped) → 403", async () => {
		const key = await seedDbKey(admin, OWN);
		expect((await mintWithKey(key, undefined)).status).toBe(403);
	});

	it("a scope outside the key's own scopes → 403 (even if the creator's role grants it)", async () => {
		const key = await seedDbKey(admin, OWN);
		expect((await mintWithKey(key, ["projects:read", "projects:update"])).status).toBe(403);
		expect((await mintWithKey(key, ["agents:read"])).status).toBe(403);
	});

	it("a strict subset is accepted (control)", async () => {
		const key = await seedDbKey(admin, OWN);
		expect((await mintWithKey(key, ["projects:read"])).status).toBe(201);
		expect((await mintWithKey(key, ["projects:read", "tasks:read"])).status).toBe(201);
	});
});

describe("platform admin's scoped key cannot escalate", () => {
	const OWN = ["settings:read", "settings:write", "projects:read"];

	it("cannot mint an unscoped key", async () => {
		const key = await seedDbKey(platformAdmin, OWN);
		expect((await mintWithKey(key, [])).status).toBe(403);
	});

	it('cannot mint a "platform:admin" key', async () => {
		const key = await seedDbKey(platformAdmin, OWN);
		expect((await mintWithKey(key, ["platform:admin"])).status).toBe(403);
	});

	it('a key that itself holds "platform:admin" may mint "platform:admin" (control)', async () => {
		const key = await seedDbKey(platformAdmin, [...OWN, "platform:admin"]);
		expect((await mintWithKey(key, ["platform:admin"])).status).toBe(201);
	});
});

describe("JWT callers keep the existing rules", () => {
	it("admin with an empty list → 201 (unscoped key allowed for JWT callers)", async () => {
		expect((await mintWithJwt(admin, [])).status).toBe(201);
	});

	it('admin requesting "*" or a scope its role lacks → 403', async () => {
		expect((await mintWithJwt(admin, ["*"])).status).toBe(403);
		expect((await mintWithJwt(admin, ["billing:write"])).status).toBe(403);
	});

	it('platform admin JWT may mint "platform:admin" (control)', async () => {
		expect((await mintWithJwt(platformAdmin, ["platform:admin"])).status).toBe(201);
	});
});
