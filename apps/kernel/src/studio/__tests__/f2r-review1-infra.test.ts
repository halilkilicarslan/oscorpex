// ---------------------------------------------------------------------------
// F2 review round 1 — scope hardening, implicit-scope accounting, query performance,
// pool robustness, payload limits.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accessGuard } from "../auth/access-guard.js";
import { signJwt } from "../auth/jwt.js";
import { authRoutes, studioRoutes } from "../index.js";
import * as kernelPg from "../pg.js";
import { execute, query, withTransaction } from "../pg.js";
import {
	TenantScopeError,
	currentScope,
	enterTenantScopeForTests,
	runAsSystem,
	runAsSystemAtBoundary,
	runInTenant,
	runInTenantAtBoundary,
	runOutsideScope,
} from "../tenancy/tenant-scope.js";
import { type SeededUser, removeUsers, seedUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, TENANT_LOCAL, withMigrator } from "./helpers/tenancy.js";

const ROOT = resolve(__dirname, "../../../../..");
const SRC = resolve(__dirname, "..");
const U = randomUUID().slice(0, 8);
const GUC = "SELECT current_setting('app.current_tenant_id', true) AS t";

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

let ownerA: SeededUser;
let admin: SeededUser;
const userIds: string[] = [];
const projectIds: string[] = [];

beforeAll(async () => {
	ownerA = await seedUser({ tenantId: TENANT_A, id: `f2r-infra-owner-${U}` });
	admin = await seedUser({ tenantId: TENANT_A, id: `f2r-infra-admin-${U}`, admin: true });
	userIds.push(ownerA.id, admin.id);
});
afterAll(async () => {
	await withMigrator(async (c) => {
		if (projectIds.length) await c.query("DELETE FROM projects WHERE id = ANY($1)", [projectIds]);
	});
	await removeUsers(userIds);
});

// ---------------------------------------------------------------------------
// 8. Scope hardening
// ---------------------------------------------------------------------------
describe("*AtBoundary helpers", () => {
	it("throw when an explicit tenant scope is active", async () => {
		await runOutsideScope(() =>
			runInTenant(TENANT_A, async () => {
				await expect(runInTenantAtBoundary(TENANT_A, async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
				await expect(runInTenantAtBoundary(TENANT_B, async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
				await expect(runAsSystemAtBoundary("x", async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
				// the explicit scope is untouched
				expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_A });
			}),
		);
	});

	it("work with no scope", async () => {
		const t = await runOutsideScope(() => runInTenantAtBoundary(TENANT_A, async () => currentScope()));
		expect(t).toEqual({ kind: "tenant", tenantId: TENANT_A });
		const s = await runOutsideScope(() => runAsSystemAtBoundary("boot", async () => currentScope()));
		expect(s).toEqual({ kind: "system", reason: "boot" });
	});

	it("may drop the implicit default test scope (plain test body)", async () => {
		expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL }); // implicit default
		const t = await runInTenantAtBoundary(TENANT_A, async () => currentScope());
		expect(t).toEqual({ kind: "tenant", tenantId: TENANT_A });
		const s = await runAsSystemAtBoundary("sweep", async () => currentScope());
		expect(s).toEqual({ kind: "system", reason: "sweep" });
	});

	it("an explicit runInTenant(LOCAL) is NOT implicit: boundary helpers refuse it", async () => {
		await runOutsideScope(() =>
			runInTenant(TENANT_LOCAL, async () => {
				await expect(runInTenantAtBoundary(TENANT_A, async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
			}),
		);
	});
});

describe("enterTenantScopeForTests", () => {
	it("throws unless VITEST is set", () => {
		const prev = process.env.VITEST;
		Reflect.deleteProperty(process.env, "VITEST");
		try {
			expect(() => enterTenantScopeForTests(TENANT_A)).toThrow();
		} finally {
			if (prev !== undefined) process.env.VITEST = prev;
		}
	});
});

describe("public routes run outside any scope", () => {
	it("accessGuard on a public route sees no scope even when called from the implicit default scope", async () => {
		const store: Record<string, unknown> = {};
		const c: any = {
			req: { path: "/health", method: "GET", header: () => "" },
			set: (k: string, v: unknown) => {
				store[k] = v;
			},
			get: (k: string) => store[k] ?? null,
			json: (body: unknown, status = 200) => ({ body, status }),
		};
		expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL });
		let seen: unknown = "unset";
		await accessGuard(c, async () => {
			seen = currentScope();
		});
		expect(seen).toBeUndefined();
	});
});

describe("source guard — scope-escape helpers have a closed importer set", () => {
	function walk(dir: string, out: string[] = []): string[] {
		for (const name of readdirSync(dir)) {
			if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p, out);
			else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
		}
		return out;
	}
	const files = [join(ROOT, "apps/kernel/src"), join(ROOT, "packages/control-plane/src")].flatMap((d) => walk(d));
	const rel = (f: string) => relative(ROOT, f).replaceAll("\\", "/");
	const importers = (name: string) =>
		files
			.filter((f) => !rel(f).endsWith("studio/tenancy/tenant-scope.ts"))
			.filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, "utf8")))
			.map(rel);

	it("runOutsideScope and enterTenantScopeForTests are not used by production code", () => {
		// The bus-private dispatch boundary is the single, explicit exemption.
		expect(importers("runOutsideScope")).toEqual(["apps/kernel/src/studio/event-bus.ts"]);
		expect(importers("enterTenantScopeForTests")).toEqual([]);
	});

	it("*AtBoundary helpers are used only at request boundaries (auth / routes / observability / middleware / control-plane)", () => {
		const allowed =
			/(apps\/kernel\/src\/studio\/(auth|routes|middleware|control-plane)\/|apps\/kernel\/src\/observability\/)/;
		const bad = [...importers("runInTenantAtBoundary"), ...importers("runAsSystemAtBoundary")].filter(
			(f) => !allowed.test(f),
		);
		expect(bad).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 9. Implicit default scope accounting
// ---------------------------------------------------------------------------
describe("implicit default scope accounting", () => {
	const counter = () =>
		(kernelPg as unknown as { getImplicitScopeQueryCount: () => number }).getImplicitScopeQueryCount();

	it("pg.ts counts queries executed under the implicit default scope", async () => {
		kernelPg.resetUnscopedQueryStats();
		expect(counter()).toBe(0);
		await query("SELECT 1");
		expect(counter()).toBe(1);
		await runOutsideScope(() => runInTenant(TENANT_A, () => query("SELECT 1")));
		expect(counter()).toBe(1); // explicit scopes are not counted
		kernelPg.resetUnscopedQueryStats();
		expect(counter()).toBe(0);
	});

	it("authenticated request paths set their own scope (implicit counter stays 0)", async () => {
		kernelPg.resetUnscopedQueryStats();
		const get = (tok: string, path: string) =>
			studioRoutes.request(path, { headers: { Authorization: `Bearer ${tok}` } }); // NOT wrapped: runs inside the implicit scope
		const paths = [
			"/projects",
			"/templates",
			"/skills",
			"/control-plane/approvals",
			"/agents",
			"/providers",
			"/summary",
		];
		for (const p of paths) {
			const res = await get(ownerA.token, p);
			expect(res.status, p).toBeLessThan(500);
		}
		const created = await studioRoutes.request("/projects", {
			method: "POST",
			headers: { Authorization: `Bearer ${ownerA.token}`, "content-type": "application/json" },
			body: JSON.stringify({ name: "f2r-implicit", description: "implicit scope accounting project" }),
		});
		if (created.status === 201) projectIds.push(((await created.json()) as { id: string }).id);
		expect((await get(admin.token, "/platform/stats")).status).toBe(200);
		expect((await authRoutes.request("/me", { headers: { Authorization: `Bearer ${ownerA.token}` } })).status).toBe(
			200,
		);
		expect(counter()).toBe(0);
	});

	it("DB-API-key authenticated requests also stay out of the implicit scope", async () => {
		kernelPg.resetUnscopedQueryStats();
		const { createHash } = await import("node:crypto");
		const key = `osx_${randomUUID().replaceAll("-", "")}`;
		const id = `f2r-infra-key-${randomUUID()}`;
		await withMigrator((c) =>
			c.query("INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name) VALUES ($1, $2, $3, $4, 'f2r')", [
				id,
				TENANT_A,
				ownerA.id,
				createHash("sha256").update(key).digest("hex"),
			]),
		);
		try {
			const res = await studioRoutes.request("/projects", { headers: { Authorization: `Bearer ${key}` } });
			expect(res.status).toBe(200);
			expect(counter()).toBe(0);
		} finally {
			await withMigrator((c) => c.query("DELETE FROM api_keys WHERE id = $1", [id]));
		}
	});
});

// ---------------------------------------------------------------------------
// 10. Performance: statements per scoped query
// ---------------------------------------------------------------------------
describe("statements sent per query", () => {
	let spy: ReturnType<typeof vi.spyOn>;
	const texts = () =>
		spy.mock.calls.map((c: unknown[]) => {
			const a = c[0] as unknown;
			return typeof a === "string" ? a : String((a as { text?: string })?.text ?? "");
		});
	beforeEach(async () => {
		await runOutsideScope(() => runInTenant(TENANT_A, () => query("SELECT 1"))); // warm the pool
		spy = vi.spyOn(pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown }, "query") as never;
	});
	afterEach(() => spy.mockRestore());

	it("tenant scope: 3 statements — BEGIN+set_config combined, the query, COMMIT", async () => {
		const marker = `SELECT ${Math.floor(Math.random() * 1e6)} AS x`;
		await runOutsideScope(() => runInTenant(TENANT_A, () => query(marker)));
		const t = texts();
		expect(t).toHaveLength(3);
		expect(t[0]).toMatch(/BEGIN/i);
		expect(t[0]).toMatch(/set_config/i);
		expect(t[1]).toBe(marker);
		expect(t[2]).toMatch(/COMMIT/i);
	});

	it("tenant scope: the tenant id is hex-encoded, never interpolated into the SQL as plain text", async () => {
		await runOutsideScope(() => runInTenant(TENANT_A, () => query("SELECT 1")));
		expect(texts()[0]).not.toContain(TENANT_A);
		expect(texts()[0]).toContain(Buffer.from(TENANT_A, "utf8").toString("hex"));
	});

	it("system scope: no transaction — exactly 1 statement", async () => {
		const marker = `SELECT ${Math.floor(Math.random() * 1e6)} AS y`;
		await runOutsideScope(() => runAsSystem("f2r-perf", () => query(marker)));
		expect(texts()).toEqual([marker]);
	});

	it("withTransaction in tenant scope: BEGIN+set_config combined, user statements, COMMIT", async () => {
		await runOutsideScope(() => runInTenant(TENANT_A, () => withTransaction(async (c) => c.query("SELECT 2"))));
		const t = texts();
		expect(t).toHaveLength(3);
		expect(t[0]).toMatch(/BEGIN/i);
		expect(t[0]).toMatch(/set_config/i);
		expect(t[1]).toBe("SELECT 2");
		expect(t[2]).toMatch(/COMMIT/i);
	});

	it("GET /platform/stats does not compute series; /platform/analytics does", async () => {
		await runOutsideScope(async () =>
			studioRoutes.request("/platform/stats", { headers: { Authorization: `Bearer ${admin.token}` } }),
		);
		expect(texts().join("\n")).not.toMatch(/sys_platform_series/);
		spy.mockClear();
		await runOutsideScope(async () =>
			studioRoutes.request("/platform/analytics", { headers: { Authorization: `Bearer ${admin.token}` } }),
		);
		expect(texts().join("\n")).toMatch(/sys_platform_series/);
	});
});

// ---------------------------------------------------------------------------
// 13. Pool robustness
// ---------------------------------------------------------------------------
describe("pool robustness", () => {
	it("a failing ROLLBACK (connection killed mid-transaction) rejects with the original error and leaves the pool usable", async () => {
		for (let i = 0; i < 3; i++) {
			await expect(
				runOutsideScope(() =>
					runInTenant(TENANT_A, () =>
						withTransaction(async (c) => {
							await c.query("SELECT pg_terminate_backend(pg_backend_pid())");
						}),
					),
				),
			).rejects.toThrow();
		}
		// the broken clients were discarded: the next queries work and see the right tenant
		for (let i = 0; i < 25; i++) {
			const rows = await runOutsideScope(() => runInTenant(TENANT_B, () => query<{ t: string }>(GUC)));
			expect(rows[0].t).toBe(TENANT_B);
		}
	});

	it("tenant isolation holds with a pool of max 2 (OSCORPEX_DB_POOL_MAX read at pool creation)", async () => {
		const prev = process.env.OSCORPEX_DB_POOL_MAX;
		process.env.OSCORPEX_DB_POOL_MAX = "2";
		vi.resetModules();
		try {
			const scope = await import("../tenancy/tenant-scope.js");
			const fresh = await import("../pg.js");
			const jobs = Array.from({ length: 40 }, (_, i) => {
				const tenant = i % 2 === 0 ? TENANT_A : TENANT_B;
				return scope.runOutsideScope(() =>
					scope.runInTenant(tenant, async () => {
						if (i % 5 === 0) {
							await expect(
								fresh.withTransaction(async (c) => {
									await c.query(GUC);
									throw new Error(`fail-${i}`);
								}),
							).rejects.toThrow(`fail-${i}`);
						}
						await new Promise((r) => setTimeout(r, Math.random() * 8));
						const rows = await fresh.query<{ t: string }>(GUC);
						const viaTx = await fresh.withTransaction(async (c) => (await c.query(GUC)).rows[0].t);
						return { tenant, seen: rows[0].t, viaTx };
					}),
				);
			});
			const out = await Promise.all(jobs);
			for (const r of out) {
				expect(r.seen).toBe(r.tenant);
				expect(r.viaTx).toBe(r.tenant);
			}
			const stats = fresh.getPoolStats();
			expect(stats?.max).toBe(2);
			await fresh.closePool();
		} finally {
			if (prev === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_DB_POOL_MAX");
			else process.env.OSCORPEX_DB_POOL_MAX = prev;
			vi.resetModules();
		}
	}, 60_000);
});

// ---------------------------------------------------------------------------
// 13. Payload size limits on template agentConfig / phases
// ---------------------------------------------------------------------------
describe("template payload limits", () => {
	let tplId: string;
	const call = (method: string, path: string, body?: unknown) =>
		runOutsideScope(async () =>
			studioRoutes.request(path, {
				method,
				headers: { Authorization: `Bearer ${ownerA.token}`, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);
	beforeAll(async () => {
		tplId = `f2r-tpl-${randomUUID()}`;
		await withMigrator((c) =>
			c.query("INSERT INTO project_templates (id, name, is_public, author_id) VALUES ($1, 'f2r', false, $2)", [
				tplId,
				ownerA.id,
			]),
		);
	});
	afterAll(async () => {
		await withMigrator((c) => c.query("DELETE FROM project_templates WHERE id = $1", [tplId]));
	});

	it("a small agentConfig and phases are accepted", async () => {
		expect(
			(await call("PATCH", `/templates/${tplId}`, { agentConfig: { a: 1 }, phases: [{ name: "p" }] })).status,
		).toBe(200);
	});

	it("an oversized agentConfig is rejected (400/413)", async () => {
		const res = await call("PATCH", `/templates/${tplId}`, { agentConfig: { blob: "x".repeat(2_000_000) } });
		expect([400, 413]).toContain(res.status);
	});

	it("an oversized phases array is rejected (400/413)", async () => {
		const res = await call("PATCH", `/templates/${tplId}`, {
			phases: Array.from({ length: 20_000 }, (_, i) => ({ name: `p${i}` })),
		});
		expect([400, 413]).toContain(res.status);
	});

	it("deeply nested agentConfig is rejected (400/413)", async () => {
		let deep: Record<string, unknown> = { leaf: 1 };
		for (let i = 0; i < 200; i++) deep = { n: deep };
		const res = await call("PATCH", `/templates/${tplId}`, { agentConfig: deep });
		expect([400, 413]).toContain(res.status);
	});
});

// ---------------------------------------------------------------------------
// 13. sys_platform_series: canonical role names in agent usage
// ---------------------------------------------------------------------------
describe("platform analytics agent usage uses canonical role names", () => {
	it("aliases of the same role are merged under the canonical name", async () => {
		const projectId = `f2r-roles-${randomUUID()}`;
		const planId = `f2r-plan-${randomUUID()}`;
		const phaseId = `f2r-phase-${randomUUID()}`;
		projectIds.push(projectId);
		const analytics = async () =>
			(await (
				await runOutsideScope(async () =>
					studioRoutes.request("/platform/analytics", { headers: { Authorization: `Bearer ${admin.token}` } }),
				)
			).json()) as { agentUsage: Array<{ role: string; count: number }> };
		const countFor = (a: { agentUsage: Array<{ role: string; count: number }> }, role: string) =>
			a.agentUsage.find((x) => x.role === role)?.count ?? 0;
		const before = await analytics();
		await withMigrator(async (c) => {
			await c.query(
				"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2r', now(), now(), $2)",
				[projectId, TENANT_A],
			);
			await c.query(
				"INSERT INTO project_plans (id, project_id, status, created_at, tenant_id) VALUES ($1, $2, 'approved', now(), $3)",
				[planId, projectId, TENANT_A],
			);
			await c.query("INSERT INTO phases (id, plan_id, name, status, tenant_id) VALUES ($1, $2, 'p', 'running', $3)", [
				phaseId,
				planId,
				TENANT_A,
			]);
			for (const [i, role] of ["backend_dev", "backend_developer", "backend-dev"].entries()) {
				await c.query(
					"INSERT INTO tasks (id, phase_id, title, assigned_agent, project_id, tenant_id) VALUES ($1, $2, 't', $3, $4, $5)",
					[`f2r-t-${i}-${randomUUID()}`, phaseId, role, projectId, TENANT_A],
				);
			}
		});
		try {
			const after = await analytics();
			expect(countFor(after, "backend-dev") - countFor(before, "backend-dev")).toBe(3);
			expect(after.agentUsage.map((x) => x.role)).not.toContain("backend_dev");
			expect(after.agentUsage.map((x) => x.role)).not.toContain("backend_developer");
		} finally {
			await withMigrator(async (c) => {
				await c.query("DELETE FROM tasks WHERE project_id = $1", [projectId]);
				await c.query("DELETE FROM phases WHERE id = $1", [phaseId]);
				await c.query("DELETE FROM project_plans WHERE id = $1", [planId]);
			});
		}
	});
});

void execute;
void signJwt;
