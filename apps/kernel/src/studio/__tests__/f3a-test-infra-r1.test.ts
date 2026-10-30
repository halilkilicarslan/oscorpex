// ---------------------------------------------------------------------------
// F3-a review fix round 1 — inventory records, report writer, itStrict hardening, superuser skip, fixture safety.
// ---------------------------------------------------------------------------

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import pg from "pg";
import { type TestContext, afterAll, beforeAll, describe, expect, it } from "vitest";
import { getProject } from "../db.js";
import {
	enableImplicitScopeInventory,
	getImplicitScopeCallers,
	getImplicitScopeQueryCount,
	query,
	resetImplicitScopeCallers,
} from "../pg.js";
import { currentScope, isImplicitScope } from "../tenancy/tenant-scope.js";
import { cleanupRunningProjects, seedRunningProjects } from "./helpers/background-fixtures.js";
import * as strictScope from "./helpers/strict-scope.js";
const { itStrict } = strictScope;
import { seedTestTenants, withMigrator } from "./helpers/tenancy.js";

const MODE_ENV = "OSCORPEX_TENANT_SCOPE_MODE";
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const THIS_FILE_REL = "apps/kernel/src/studio/__tests__/f3a-test-infra-r1.test.ts";
const sandbox = mkdtempSync(join(tmpdir(), "f3a-r1-"));

/** Script compiled under a filename outside __tests__: its frames are "production-like" callers. */
function script<T>(name: string, code: string): T {
	return new vm.Script(code, { filename: join(sandbox, name) }).runInThisContext() as T;
}

let implicitPending: Promise<unknown>;
let releaseImplicit: () => void = () => {};
let implicitAtHook = false;

beforeAll(async () => {
	await seedTestTenants();
	await cleanupRunningProjects();
	await seedRunningProjects();
	// beforeAll holds the implicit scope; a promise reaction registered here keeps it.
	implicitAtHook = isImplicitScope();
	const gate = new Promise<void>((res) => {
		releaseImplicit = res;
	});
	implicitPending = gate.then(() => query("SELECT 1 AS from_before_all"));
});

afterAll(async () => {
	enableImplicitScopeInventory(false);
	resetImplicitScopeCallers();
	await cleanupRunningProjects();
	rmSync(sandbox, { recursive: true, force: true });
});

describe("F3-a r1 item 1 — inventory records", () => {
	it("same repo function from the test and from a detached timer → two records (test + detached/timer)", async () => {
		resetImplicitScopeCallers();
		enableImplicitScopeInventory(true);
		try {
			await getProject("f3a-r1-none");
			const schedule = script<(f: (id: string) => Promise<unknown>) => Promise<unknown>>(
				"detached-timer.js",
				"(function (f) { return new Promise(function (res) { setTimeout(function () { res(f('f3a-r1-none')); }, 5); }); })",
			);
			await schedule(getProject);

			const records = getImplicitScopeCallers();
			expect(records).toHaveLength(2);
			const [first, second] = records;
			expect(first.origin).toBe("detached");
			expect(first.trigger).toBe("timer");
			expect(second.origin).toBe("test");
			expect(first.repoFrame).toBe(second.repoFrame);
			expect(first.repoFrame).toContain("db/");
			expect(second.entryFrame).toContain(THIS_FILE_REL);
			expect(first.entryFrame).toContain("detached-timer.js");
			for (const r of records) {
				expect(r.count).toBe(1);
				for (const f of [r.repoFrame, r.entryFrame]) {
					expect(f).not.toMatch(/:\d+:\d+/);
				}
				expect(r.repoFrame).not.toContain(REPO_ROOT);
				expect(r.entryFrame.includes(REPO_ROOT)).toBe(false);
			}
		} finally {
			enableImplicitScopeInventory(false);
		}
	});

	it("a repeated call increments count instead of adding a record", async () => {
		resetImplicitScopeCallers();
		enableImplicitScopeInventory(true);
		try {
			await getProject("f3a-r1-none");
			await getProject("f3a-r1-none");
			await getProject("f3a-r1-none");
			const records = getImplicitScopeCallers();
			expect(records).toHaveLength(1);
			expect(records[0].count).toBe(3);
		} finally {
			enableImplicitScopeInventory(false);
		}
	});

	it("captures a deep stack: a test frame under 30 recursive frames still yields origin 'test'", async () => {
		resetImplicitScopeCallers();
		enableImplicitScopeInventory(true);
		try {
			const deep = script<(n: number, f: () => Promise<unknown>) => Promise<unknown>>(
				"deep-recursion.js",
				"(function rec(n, f) { return n === 0 ? f() : rec(n - 1, f); })",
			);
			await deep(30, () => getProject("f3a-r1-none"));
			const rec = getImplicitScopeCallers().find((r) => r.entryFrame.includes("deep-recursion.js"));
			expect(rec).toBeDefined();
			expect(rec?.origin).toBe("test");
		} finally {
			enableImplicitScopeInventory(false);
		}
	});

	it("caps the inventory at 500 records", async () => {
		resetImplicitScopeCallers();
		enableImplicitScopeInventory(true);
		try {
			const pending: Promise<unknown>[] = [];
			for (let i = 0; i < 520; i++) {
				const call = script<(f: (id: string) => Promise<unknown>) => Promise<unknown>>(
					`cap-${i}.js`,
					"(function (f) { return f('f3a-r1-none'); })",
				);
				pending.push(call(getProject));
			}
			await Promise.all(pending);
			expect(getImplicitScopeCallers()).toHaveLength(500);
		} finally {
			enableImplicitScopeInventory(false);
		}
	});

	it("cannot be enabled without VITEST (throws or is a no-op)", async () => {
		enableImplicitScopeInventory(false);
		resetImplicitScopeCallers();
		const vitestFlag = process.env.VITEST;
		Reflect.deleteProperty(process.env, "VITEST");
		try {
			try {
				enableImplicitScopeInventory(true);
			} catch {
				// throwing is an accepted outcome
			}
		} finally {
			process.env.VITEST = vitestFlag;
		}
		await getProject("f3a-r1-none");
		expect(getImplicitScopeCallers()).toEqual([]);
	});
});

describe("F3-a r1 item 2 — report writer", () => {
	const load = async () => import("./helpers/implicit-scope-report.js");
	const testFileAbs = join(REPO_ROOT, "apps/kernel/src/studio/__tests__/some-file.test.ts");

	it("appends one JSON line per record with repo-relative testFile and paths", async () => {
		const { flushImplicitScopeReport } = await load();
		resetImplicitScopeCallers();
		enableImplicitScopeInventory(true);
		try {
			await getProject("f3a-r1-none");
			const path = join(sandbox, "report.jsonl");
			flushImplicitScopeReport(path, testFileAbs);
			flushImplicitScopeReport(path, testFileAbs);
			const lines = readFileSync(path, "utf8").trim().split("\n");
			expect(lines).toHaveLength(2 * getImplicitScopeCallers().length);
			const parsed = JSON.parse(lines[0]);
			expect(parsed.testFile).toBe("apps/kernel/src/studio/__tests__/some-file.test.ts");
			expect(parsed.origin).toBe("test");
			expect(parsed.count).toBe(1);
			expect(parsed.repoFrame).not.toContain(REPO_ROOT);
			expect(parsed.entryFrame).not.toContain(REPO_ROOT);
		} finally {
			enableImplicitScopeInventory(false);
		}
	});

	it("propagates fs errors (unwritable path)", async () => {
		const { flushImplicitScopeReport } = await load();
		resetImplicitScopeCallers();
		enableImplicitScopeInventory(true);
		try {
			await getProject("f3a-r1-none");
			const bad = join(sandbox, "no-such-dir", "nested", "r.jsonl");
			expect(() => flushImplicitScopeReport(bad, testFileAbs)).toThrow();
		} finally {
			enableImplicitScopeInventory(false);
		}
	});

	it("writes nothing when the inventory is disabled or empty", async () => {
		const { flushImplicitScopeReport } = await load();
		enableImplicitScopeInventory(false);
		resetImplicitScopeCallers();
		const path = join(sandbox, "empty.jsonl");
		flushImplicitScopeReport(path, testFileAbs);
		expect(existsSync(path)).toBe(false);
	});
});

describe("F3-a r1 item 3 — itStrict hardening", () => {
	// Contract: strict-scope.ts exports strictTestBody(fn): the function itStrict registers with vitest. It is
	// called here directly, because a failing / timed-out itStrict test cannot be asserted from inside the run.
	type Body = (fn: (ctx: unknown) => unknown) => (ctx: unknown) => Promise<unknown>;
	const strictTestBody = (): Body => {
		const fn = (strictScope as Record<string, unknown>).strictTestBody;
		expect(typeof fn, "strict-scope.ts must export strictTestBody(fn)").toBe("function");
		return fn as Body;
	};

	it("sanity: beforeAll ran under the implicit scope", () => {
		expect(implicitAtHook).toBe(true);
	});

	it("restores strict mode after a test timeout: registration goes through onTestFinished", () => {
		const src = readFileSync(join(REPO_ROOT, "apps/kernel/src/studio/__tests__/helpers/strict-scope.ts"), "utf8");
		expect(src).toMatch(/onTestFinished/);
	});

	it("fails the test when a query ran in the implicit scope during the body", async () => {
		const run = strictTestBody()(async () => {
			releaseImplicit();
			await implicitPending; // started in beforeAll → resolves through the implicit scope
		});
		const baseline = getImplicitScopeQueryCount();
		await expect(run({ skip: () => {} })).rejects.toThrow();
		expect(getImplicitScopeQueryCount()).toBeGreaterThan(baseline);
	});

	it("passes a clean strict body (no implicit queries)", async () => {
		const run = strictTestBody()(async () => {
			await Promise.resolve();
		});
		await expect(run({ skip: () => {} })).resolves.not.toThrow();
	});

	itStrict("currentScope() is undefined after an await inside the body", async () => {
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 1));
		expect(currentScope()).toBeUndefined();
	});
});

describe("F3-a r1 item 4 — superuser skip", () => {
	let isSuper = true;
	beforeAll(async () => {
		const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			const r = await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
			isSuper = r.rows[0]?.rolsuper === true;
		} finally {
			await client.end();
		}
	});

	itStrict(
		"itStrict passes the test context so ctx.skip() works (skipped in superuser mode)",
		async (ctx: TestContext) => {
			if (isSuper) ctx.skip();
			expect(isSuper).toBe(false);
		},
	);
});

describe("F3-a r1 item 5 — fixtures", () => {
	it("seedRunningProjects() resets rows whose status was changed", async () => {
		const fx = await seedRunningProjects();
		await withMigrator(async (c) => {
			await c.query("UPDATE phases SET status = 'completed' WHERE id = ANY($1)", [[fx.A.phaseId, fx.B.phaseId]]);
			await c.query("UPDATE projects SET status = 'paused' WHERE id = ANY($1)", [[fx.A.projectId, fx.B.projectId]]);
			await c.query("UPDATE pipeline_runs SET status = 'completed' WHERE id = ANY($1)", [
				[fx.A.pipelineRunId, fx.B.pipelineRunId],
			]);
		});
		await seedRunningProjects();
		await withMigrator(async (c) => {
			const phases = await c.query("SELECT project_id, phase_id FROM sys_running_project_phases()");
			for (const t of [fx.A, fx.B]) {
				expect(phases.rows).toContainEqual({ project_id: t.projectId, phase_id: t.phaseId });
			}
		});
	});

	it("populates tasks.project_id", async () => {
		const fx = await seedRunningProjects();
		await withMigrator(async (c) => {
			const r = await c.query("SELECT id, project_id FROM tasks WHERE id = ANY($1) ORDER BY id", [
				[fx.A.taskId, fx.B.taskId],
			]);
			expect(r.rows).toEqual([
				{ id: fx.A.taskId, project_id: fx.A.projectId },
				{ id: fx.B.taskId, project_id: fx.B.projectId },
			]);
		});
	});

	it("refuses to seed when the migrator database differs from the runtime database", async () => {
		const runtimeUrl = process.env.DATABASE_URL as string;
		const migratorUrl = process.env.OSCORPEX_MIGRATION_DATABASE_URL ?? runtimeUrl;
		const mismatched = new URL(runtimeUrl);
		mismatched.pathname = "/oscorpex_f3a_other_test";
		const savedRuntime = process.env.DATABASE_URL;
		const savedMigration = process.env.OSCORPEX_MIGRATION_DATABASE_URL;
		process.env.OSCORPEX_MIGRATION_DATABASE_URL = migratorUrl;
		process.env.DATABASE_URL = mismatched.toString();
		try {
			await expect(seedRunningProjects()).rejects.toThrow(/test|database/i);
		} finally {
			process.env.DATABASE_URL = savedRuntime;
			if (savedMigration === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_MIGRATION_DATABASE_URL");
			else process.env.OSCORPEX_MIGRATION_DATABASE_URL = savedMigration;
		}
	});
});
