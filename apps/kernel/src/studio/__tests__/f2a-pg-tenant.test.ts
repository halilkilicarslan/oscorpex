// ---------------------------------------------------------------------------
// F2a — pg.ts tenant-scoped queries, pool-leak checks, control-plane bridge,
// source guard and micro-benchmark.
//
// Runs in two modes (see plan F2):
//  - local: runtime login is NOT superuser → RLS applies → isolation tests run
//  - CI:    runtime login is superuser → isolation tests skip themselves;
//           GUC-propagation tests must still pass.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect } from "vitest";
import * as controlPlanePg from "../../../../../packages/control-plane/src/pg.js";
import * as kernelPg from "../pg.js";
import { execute, query, queryOne, withTransaction } from "../pg.js";
import { UnscopedQueryError, currentScope, runAsSystem, runInTenant } from "../tenancy/tenant-scope.js";
import { it } from "./helpers/outside-scope.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

const GUC = "SELECT current_setting('app.current_tenant_id', true) AS t";

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

let isSuper = true;
const projectIds: string[] = [];
const prevMode = process.env.OSCORPEX_TENANT_SCOPE_MODE;

async function seedTenants(): Promise<void> {
	await withMigrator(async (c) => {
		for (const [id, slug] of [
			[TENANT_A, "test-tenant-a"],
			[TENANT_B, "test-tenant-b"],
		]) {
			await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
				id,
				slug,
				slug,
			]);
		}
	});
}

async function seedProject(tenantId: string): Promise<string> {
	const id = `f2a-${randomUUID()}`;
	projectIds.push(id);
	await withMigrator((c) =>
		c.query("INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2a', now(), now(), $2)", [
			id,
			tenantId,
		]),
	);
	return id;
}

beforeAll(async () => {
	isSuper = await runtimeIsSuperuser();
	await seedTenants();
});

afterEach(() => {
	if (prevMode === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_TENANT_SCOPE_MODE");
	else process.env.OSCORPEX_TENANT_SCOPE_MODE = prevMode;
});

afterAll(async () => {
	if (projectIds.length > 0) {
		await withMigrator((c) => c.query("DELETE FROM projects WHERE id = ANY($1)", [projectIds]));
	}
});

describe("pg.ts exports", () => {
	it("no longer exports getPool or a raw client API", () => {
		const names = Object.keys(kernelPg);
		expect(names).not.toContain("getPool");
		expect(names).not.toContain("withClient");
		expect(names).not.toContain("getClient");
		expect(names).not.toContain("connect");
	});
});

describe("GUC propagation (both modes)", () => {
	it("tenant scope sets app.current_tenant_id for query()", async () => {
		const rows = await runInTenant(TENANT_A, () => query<{ t: string }>(GUC));
		expect(rows[0].t).toBe(TENANT_A);
	});

	it("queryOne() and execute() run inside the tenant scope", async () => {
		await runInTenant(TENANT_B, async () => {
			expect((await queryOne<{ t: string }>(GUC))?.t).toBe(TENANT_B);
			const r = await execute("SELECT set_config('app.f2a_probe', '1', true)");
			expect(r.rowCount).toBe(1);
		});
	});

	it("GUC is cleared after the scope (any pooled connection)", async () => {
		await runInTenant(TENANT_A, () => query(GUC));
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "warn";
		for (let i = 0; i < 15; i++) {
			const rows = await query<{ t: string | null }>(GUC);
			expect(rows[0].t === null || rows[0].t === "").toBe(true);
		}
	});

	it("system scope sets an empty setting", async () => {
		const rows = await runAsSystem("f2a-test", () => query<{ t: string | null }>(GUC));
		expect(rows[0].t ?? "").toBe("");
	});

	it("strict mode throws UnscopedQueryError before any SQL", async () => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		expect(currentScope()).toBeUndefined();
		await expect(query("SELECT 1")).rejects.toBeInstanceOf(UnscopedQueryError);
		await expect(queryOne("SELECT 1")).rejects.toBeInstanceOf(UnscopedQueryError);
		await expect(execute("SELECT 1")).rejects.toBeInstanceOf(UnscopedQueryError);
		await expect(withTransaction(async () => 1)).rejects.toBeInstanceOf(UnscopedQueryError);
	});

	it("strict mode: invalid SQL is not even sent (error is the scope error, not a pg error)", async () => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		await expect(query("THIS IS NOT SQL")).rejects.toBeInstanceOf(UnscopedQueryError);
	});

	it("warn mode runs unscoped queries", async () => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "warn";
		const rows = await query<{ x: number }>("SELECT 1 AS x");
		expect(rows[0].x).toBe(1);
	});

	it("strict mode still allows scoped and system queries", async () => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		expect((await runInTenant(TENANT_A, () => query<{ t: string }>(GUC)))[0].t).toBe(TENANT_A);
		await expect(runAsSystem("f2a", () => query("SELECT 1"))).resolves.toHaveLength(1);
	});

	it("sys_* functions work in system scope", async () => {
		const pid = await seedProject(TENANT_A);
		const row = await runAsSystem("f2a", () => queryOne<{ t: string }>("SELECT sys_project_tenant($1) AS t", [pid]));
		expect(row?.t).toBe(TENANT_A);
	});
});

describe("withTransaction in tenant scope", () => {
	it("every statement on the client sees the tenant", async () => {
		const seen = await runInTenant(TENANT_A, () =>
			withTransaction(async (client) => {
				const a = await client.query(GUC);
				const b = await client.query(GUC);
				return [a.rows[0].t, b.rows[0].t];
			}),
		);
		expect(seen).toEqual([TENANT_A, TENANT_A]);
	});

	it("SAVEPOINT rollback keeps the tenant", async () => {
		const after = await runInTenant(TENANT_B, () =>
			withTransaction(async (client) => {
				await client.query("SAVEPOINT sp1");
				await client.query("SELECT set_config('app.f2a_probe', 'x', true)");
				await client.query("ROLLBACK TO SAVEPOINT sp1");
				return (await client.query(GUC)).rows[0].t;
			}),
		);
		expect(after).toBe(TENANT_B);
	});

	it("errors roll back and propagate; tenant is cleared afterwards", async () => {
		const pid = `f2a-${randomUUID()}`;
		projectIds.push(pid);
		await expect(
			runInTenant(TENANT_A, () =>
				withTransaction(async (client) => {
					await client.query(
						"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'x', now(), now(), $2)",
						[pid, TENANT_A],
					);
					throw new Error("rollback-me");
				}),
			),
		).rejects.toThrow("rollback-me");
		const rows = await withMigrator((c) => c.query("SELECT 1 FROM projects WHERE id = $1", [pid]));
		expect(rows.rowCount).toBe(0);
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "warn";
		const g = await query<{ t: string | null }>(GUC);
		expect(g[0].t === null || g[0].t === "").toBe(true);
	});

	it("a failed statement inside withTransaction does not poison the pool", async () => {
		await expect(
			runInTenant(TENANT_A, () => withTransaction((client) => client.query("SELECT * FROM no_such_table_f2a"))),
		).rejects.toThrow();
		const rows = await runInTenant(TENANT_A, () => query<{ t: string }>(GUC));
		expect(rows[0].t).toBe(TENANT_A);
	});

	it("a failing query() in tenant scope rolls back and releases the connection", async () => {
		for (let i = 0; i < 25; i++) {
			await expect(runInTenant(TENANT_A, () => query("SELECT * FROM no_such_table_f2a"))).rejects.toThrow();
		}
		expect((await runInTenant(TENANT_A, () => query<{ t: string }>(GUC)))[0].t).toBe(TENANT_A);
	});
});

describe("pool leak / interleaving", () => {
	it("30 interleaved A/B queries (some failing in withTransaction) only see their own tenant", async () => {
		const jobs = Array.from({ length: 30 }, (_, i) => {
			const tenant = i % 2 === 0 ? TENANT_A : TENANT_B;
			return runInTenant(tenant, async () => {
				if (i % 5 === 0) {
					await expect(
						withTransaction(async (client) => {
							await client.query(GUC);
							throw new Error(`fail-${i}`);
						}),
					).rejects.toThrow(`fail-${i}`);
				}
				await new Promise((r) => setTimeout(r, Math.random() * 10));
				const rows = await query<{ t: string }>(GUC);
				const viaTx = await withTransaction(async (c) => (await c.query(GUC)).rows[0].t);
				return { tenant, seen: rows[0].t, viaTx };
			});
		});
		const results = await Promise.all(jobs);
		for (const r of results) {
			expect(r.seen).toBe(r.tenant);
			expect(r.viaTx).toBe(r.tenant);
		}
	});
});

describe("row isolation through pg.ts (non-superuser runtime only)", () => {
	it("tenant scopes see only their own projects; unscoped sees none", async (ctx) => {
		if (isSuper) return ctx.skip();
		const a = await seedProject(TENANT_A);
		const b = await seedProject(TENANT_B);
		const sql = "SELECT id FROM projects WHERE id = ANY($1)";

		const asA = await runInTenant(TENANT_A, () => query<{ id: string }>(sql, [[a, b]]));
		expect(asA.map((r) => r.id)).toEqual([a]);
		const asB = await runInTenant(TENANT_B, () => query<{ id: string }>(sql, [[a, b]]));
		expect(asB.map((r) => r.id)).toEqual([b]);

		process.env.OSCORPEX_TENANT_SCOPE_MODE = "warn";
		const none = await query<{ id: string }>(sql, [[a, b]]);
		expect(none).toHaveLength(0);
	});

	it("system scope sees no rows on RLS tables", async (ctx) => {
		if (isSuper) return ctx.skip();
		const a = await seedProject(TENANT_A);
		const rows = await runAsSystem("f2a", () => query("SELECT id FROM projects WHERE id = $1", [a]));
		expect(rows).toHaveLength(0);
	});

	it("tenant A cannot insert a row for tenant B through pg.ts", async (ctx) => {
		if (isSuper) return ctx.skip();
		const id = `f2a-${randomUUID()}`;
		projectIds.push(id);
		await expect(
			runInTenant(TENANT_A, () =>
				execute(
					"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'x', now(), now(), $2)",
					[id, TENANT_B],
				),
			),
		).rejects.toThrow();
	});
});

describe("control-plane bridge", () => {
	it("initPool/getPool are gone; initDb is exported", () => {
		const names = Object.keys(controlPlanePg);
		expect(names).toContain("initDb");
		expect(names).not.toContain("initPool");
		expect(names).not.toContain("getPool");
	});

	it("control-plane queries inside runInTenant see the tenant after initDb(kernel helpers)", async () => {
		const cp = controlPlanePg as unknown as {
			initDb: (h: {
				query: typeof query;
				queryOne: typeof queryOne;
				execute: typeof execute;
				withTransaction: typeof withTransaction;
			}) => void;
			query: typeof query;
			queryOne: typeof queryOne;
			execute: typeof execute;
		};
		cp.initDb({ query, queryOne, execute, withTransaction });
		const rows = await runInTenant(TENANT_A, () => cp.query<{ t: string }>(GUC));
		expect(rows[0].t).toBe(TENANT_A);
		const one = await runInTenant(TENANT_B, () => cp.queryOne<{ t: string }>(GUC));
		expect(one?.t).toBe(TENANT_B);
	});
});

describe("source guard (static)", () => {
	const kernelSrc = resolve(__dirname, "../../..");
	const cpSrc = resolve(__dirname, "../../../../../packages/control-plane/src");
	const root = resolve(__dirname, "../../../../..");

	function walk(dir: string, out: string[] = []): string[] {
		for (const name of readdirSync(dir)) {
			if (name === "node_modules" || name === "dist") continue;
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p, out);
			else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
		}
		return out;
	}

	function stripComments(src: string): string {
		return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	}

	const files = [...walk(kernelSrc), ...walk(cpSrc)].filter((f) => {
		const rel = relative(root, f).replaceAll("\\", "/");
		return !/\.test\.ts$/.test(rel) && !rel.includes("/__tests__/");
	});
	const rel = (f: string) => relative(root, f).replaceAll("\\", "/");
	const PG_TS = "apps/kernel/src/studio/pg.ts";
	const LISTENER = "apps/kernel/src/studio/pg-listener.ts";

	it("scans a meaningful number of files", () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it("no getPool( outside pg.ts", () => {
		const bad = files.filter((f) => rel(f) !== PG_TS && /\bgetPool\s*\(/.test(stripComments(readFileSync(f, "utf8"))));
		expect(bad.map(rel)).toEqual([]);
	});

	it("no pool .connect( outside pg.ts", () => {
		const re = /\b(?:pool|_pool|pgPool|getPool\(\))\s*\.\s*connect\s*\(/i;
		const bad = files.filter((f) => rel(f) !== PG_TS && re.test(stripComments(readFileSync(f, "utf8"))));
		expect(bad.map(rel)).toEqual([]);
	});

	it("no new Pool( outside pg.ts / pg-listener.ts", () => {
		const re = /new\s+(?:pg\.)?Pool\s*\(/;
		const bad = files.filter(
			(f) => rel(f) !== PG_TS && rel(f) !== LISTENER && re.test(stripComments(readFileSync(f, "utf8"))),
		);
		expect(bad.map(rel)).toEqual([]);
	});

	it("no session-level tenant GUC (SET app.current_tenant_id / set_config(..., false))", () => {
		const setRe = /\bSET\s+(?:SESSION\s+)?app\.current_tenant_id\b/i;
		const cfgRe = /set_config\s*\(\s*['"]app\.current_tenant_id['"]\s*,[^)]*,\s*false\s*\)/i;
		const bad = files.filter((f) => {
			const s = stripComments(readFileSync(f, "utf8"));
			return setRe.test(s) || cfgRe.test(s);
		});
		expect(bad.map(rel)).toEqual([]);
	});
});

describe("micro-benchmark: tenant scope overhead", () => {
	const N = 200;
	const pct = (xs: number[], p: number) =>
		[...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

	async function time(fn: () => Promise<unknown>): Promise<number[]> {
		const out: number[] = [];
		for (let i = 0; i < N; i++) {
			const t0 = performance.now();
			await fn();
			out.push(performance.now() - t0);
		}
		return out;
	}

	it("records p50/p95 with and without tenant scope; p50 overhead < 10ms", async () => {
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "warn";
		await time(() => query("SELECT 1")); // warm-up
		const base = await time(() => query("SELECT 1"));
		const scoped = await time(() => runInTenant(TENANT_A, () => query("SELECT 1")));
		const b50 = pct(base, 0.5);
		const s50 = pct(scoped, 0.5);
		console.info(
			`[f2a-bench] unscoped p50=${b50.toFixed(2)}ms p95=${pct(base, 0.95).toFixed(2)}ms | ` +
				`tenant p50=${s50.toFixed(2)}ms p95=${pct(scoped, 0.95).toFixed(2)}ms | overhead p50=${(s50 - b50).toFixed(2)}ms`,
		);
		expect(s50 - b50).toBeLessThan(10);
	});
});
