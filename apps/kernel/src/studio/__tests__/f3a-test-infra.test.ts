// ---------------------------------------------------------------------------
// F3-a — test infrastructure: strict-scope opt-in, implicit-scope inventory, two-tenant background fixtures.
// Helpers under test do not exist yet; this file defines their contract.
// ---------------------------------------------------------------------------

import pg from "pg";
import { type TestContext, afterAll, beforeAll, describe, expect, it } from "vitest";
import { getProject } from "../db.js";
import { enableImplicitScopeInventory, getImplicitScopeCallers, query, resetImplicitScopeCallers } from "../pg.js";
import { UnscopedQueryError, isImplicitScope, runInTenant, tenantScopeMode } from "../tenancy/tenant-scope.js";
import { cleanupRunningProjects, seedRunningProjects } from "./helpers/background-fixtures.js";
import { itStrict, withStrictScope } from "./helpers/strict-scope.js";
import { TENANT_A, TENANT_B, seedTestTenants, withMigrator } from "./helpers/tenancy.js";

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
const modeBefore = process.env.OSCORPEX_TENANT_SCOPE_MODE;

beforeAll(async () => {
	await seedTestTenants();
	isSuper = await runtimeIsSuperuser();
	await cleanupRunningProjects();
	await seedRunningProjects();
});

afterAll(async () => {
	await cleanupRunningProjects();
	enableImplicitScopeInventory(false);
});

describe("F3-a scenario 1 — itStrict", () => {
	itStrict("unscoped query throws UnscopedQueryError and strict mode is active", async () => {
		expect(tenantScopeMode()).toBe("strict");
		expect(isImplicitScope()).toBe(false);
		await expect(query("SELECT 1 FROM projects LIMIT 1")).rejects.toBeInstanceOf(UnscopedQueryError);
	});

	itStrict("runInTenant(A) sees only A's project (RLS only)", async (ctx: TestContext) => {
		if (isSuper) ctx.skip(); // superuser bypasses RLS
		const fx = await seedRunningProjects();
		const rows = await runInTenant(TENANT_A, () =>
			query<{ id: string }>("SELECT id FROM projects WHERE id = ANY($1)", [[fx.A.projectId, fx.B.projectId]]),
		);
		expect(rows.map((r) => r.id)).toEqual([fx.A.projectId]);
	});

	it("mode is restored after an itStrict test", () => {
		expect(process.env.OSCORPEX_TENANT_SCOPE_MODE).toBe(modeBefore);
		expect(tenantScopeMode()).not.toBe("strict");
	});

	it("mode is restored even when the body throws", async () => {
		await expect(
			withStrictScope(async () => {
				expect(tenantScopeMode()).toBe("strict");
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(process.env.OSCORPEX_TENANT_SCOPE_MODE).toBe(modeBefore);
	});
});

describe("F3-a scenario 2 — plain it keeps the implicit scope", () => {
	it("unscoped-looking query succeeds under the implicit scope", async () => {
		expect(isImplicitScope()).toBe(true);
		await expect(query("SELECT 1 AS one")).resolves.toEqual([{ one: 1 }]);
	});
});

describe("F3-a scenario 3 — implicit scope inventory", () => {
	it("records repo callers as records, deduplicated with a count", async () => {
		resetImplicitScopeCallers();
		enableImplicitScopeInventory(true);
		try {
			await getProject("f3a-no-such-project");
			await getProject("f3a-no-such-project"); // dedupe
			const callers = getImplicitScopeCallers();
			expect(callers.length).toBe(1);
			expect(callers[0].repoFrame).toContain("project-repo");
			expect(callers[0].count).toBe(2);
			expect(callers[0].origin).toBe("test");
		} finally {
			enableImplicitScopeInventory(false);
		}
	});

	it("records nothing when disabled (default)", async () => {
		resetImplicitScopeCallers();
		await getProject("f3a-no-such-project");
		expect(getImplicitScopeCallers()).toEqual([]);
	});
});

describe("F3-a scenario 4 — background fixtures", () => {
	const counts = async (ids: string[]) =>
		withMigrator(async (c) => {
			const r = await c.query(
				`SELECT (SELECT count(*) FROM projects WHERE id = ANY($1))::int AS projects,
				        (SELECT count(*) FROM pipeline_runs WHERE project_id = ANY($1))::int AS runs,
				        (SELECT count(*) FROM project_plans WHERE project_id = ANY($1))::int AS plans,
				        (SELECT count(*) FROM phases ph JOIN project_plans pp ON pp.id = ph.plan_id
				           WHERE pp.project_id = ANY($1))::int AS phases,
				        (SELECT count(*) FROM tasks t JOIN phases ph ON ph.id = t.phase_id
				           JOIN project_plans pp ON pp.id = ph.plan_id WHERE pp.project_id = ANY($1))::int AS tasks`,
				[ids],
			);
			return r.rows[0];
		});

	it("is idempotent: same ids and row counts on a second call", async () => {
		const first = await seedRunningProjects();
		const second = await seedRunningProjects();
		expect(second).toEqual(first);
		expect(first.A.tenantId).toBe(TENANT_A);
		expect(first.B.tenantId).toBe(TENANT_B);
		expect(await counts([first.A.projectId, first.B.projectId])).toEqual({
			projects: 2,
			runs: 2,
			plans: 2,
			phases: 2,
			tasks: 2,
		});
	});

	it("rows are visible to sys_running_project_phases() and sys_running_projects()", async () => {
		const fx = await seedRunningProjects();
		await withMigrator(async (c) => {
			const phases = await c.query("SELECT project_id, phase_id, tenant_id FROM sys_running_project_phases()");
			const projs = await c.query("SELECT project_id, tenant_id FROM sys_running_projects()");
			for (const t of [fx.A, fx.B]) {
				expect(phases.rows).toContainEqual({
					project_id: t.projectId,
					phase_id: t.phaseId,
					tenant_id: t.tenantId,
				});
				expect(projs.rows).toContainEqual({ project_id: t.projectId, tenant_id: t.tenantId });
			}
		});
	});

	it("cleanup leaves 0 rows for those ids", async () => {
		const fx = await seedRunningProjects();
		const ids = [fx.A.projectId, fx.B.projectId];
		await cleanupRunningProjects();
		expect(await counts(ids)).toEqual({ projects: 0, runs: 0, plans: 0, phases: 0, tasks: 0 });
	});
});
