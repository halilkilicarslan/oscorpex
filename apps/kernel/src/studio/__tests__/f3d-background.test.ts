// ---------------------------------------------------------------------------
// F3-d — timers, watchdog, startup recovery, seeders and provider-state under strict tenant scope (plan scenarios 1-7).
// Strict-scope file with real RLS: hooks and tests run outside the implicit scope (helpers/strict-scope.ts).
//
// Contract under test:
//  - TaskDispatcher.runDispatchWatchdog() discovers work with sys_running_project_phases() in system scope and processes
//    each project in its own tenant scope with its own try/catch. NULL-tenant rows are skipped with log.error, and an
//    over-budget project is never dispatched, even when pausing its pipeline fails.
//  - ExecutionWatchdog ticks in system scope regardless of where the timer was started.
//  - ExecutionRecovery.recoverStuckTasks() discovers projects with sys_running_projects() (running projects without a
//    pipeline_run included, paused/failed pipelines excluded) and runs the reset, discovery and budget step per project in
//    its tenant scope with bounded concurrency (getRecoveryConfig().concurrency, OSCORPEX_RECOVERY_CONCURRENCY, [1, 10]).
//    The execution restart is fire-and-forget: recovery never waits for it. A deadlock retries only the affected project.
//  - registerSeeders() runs the seeders in system scope and settles when they are done.
//  - provider-state persists in the current scope (tenant or system) and never swallows a scope error silently.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestContext } from "vitest";

const loggers = vi.hoisted(() => new Map<string, Record<string, ReturnType<typeof vi.fn>>>());
const nullTenantRow = vi.hoisted(() => ({
	on: null as null | "sys_running_project_phases" | "sys_running_projects",
	first: false,
	projectId: "f3d-null-tenant-project",
}));
/** Optional per-query hook (delay, count or throw); receives every statement that reaches the database. */
const queryHook = vi.hoisted(() => ({
	fn: undefined as undefined | ((sql: string, params?: unknown[]) => Promise<void> | void),
}));

vi.mock("../logger.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../logger.js")>();
	return {
		...orig,
		createLogger: (name: string) => {
			let l = loggers.get(name);
			if (!l) {
				const self: Record<string, unknown> = {};
				for (const k of ["info", "warn", "error", "debug", "trace", "fatal"]) self[k] = vi.fn();
				self.child = () => self;
				l = self as Record<string, ReturnType<typeof vi.fn>>;
				loggers.set(name, l);
			}
			return l;
		},
	};
});

// A NULL tenant is impossible in projects (tenant_id is NOT NULL), so the NULL row is injected into the result of the
// sys_* function selected by nullTenantRow.on: the same shape the SQL function would return for a legacy row without tenant.
vi.mock("../pg.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../pg.js")>();
	return {
		...orig,
		query: async (sql: string, params?: unknown[]) => {
			await queryHook.fn?.(sql, params);
			const rows = (await orig.query(sql, params)) as Array<Record<string, unknown>>;
			if (nullTenantRow.on && sql.includes(nullTenantRow.on)) {
				const row =
					nullTenantRow.on === "sys_running_project_phases"
						? { project_id: nullTenantRow.projectId, phase_id: "f3d-null-phase", tenant_id: null }
						: { project_id: nullTenantRow.projectId, tenant_id: null };
				return nullTenantRow.first ? [row, ...rows] : [...rows, row];
			}
			return rows;
		},
		execute: async (sql: string, params?: unknown[]) => {
			await queryHook.fn?.(sql, params);
			return orig.execute(sql, params);
		},
		queryOne: async (sql: string, params?: unknown[]) => {
			await queryHook.fn?.(sql, params);
			return orig.queryOne(sql, params);
		},
	};
});

import { AdaptiveSemaphore } from "../adaptive-concurrency.js";
import { registerSeeders } from "../composition/register-seeders.js";
import { recordTokenUsage } from "../db.js";
import { eventBus } from "../event-bus.js";
import { TaskDispatcher } from "../execution/dispatch-coordinator.js";
import { ExecutionRecovery, runStartupRecoveryWithRetry } from "../execution/execution-recovery.js";
import { ExecutionWatchdog } from "../execution/execution-watchdog.js";
import { getRecoveryConfig } from "../performance-config.js";
import { query } from "../pg.js";
import { initPipelineEngine, pipelineEngine } from "../pipeline-engine.js";
import { providerState } from "../provider-state.js";
import { initTaskEngine, taskEngine } from "../task-engine.js";
import { currentScope, runAsSystem, runInTenant } from "../tenancy/tenant-scope.js";
import type { Task } from "../types.js";
import { cleanupRunningProjects, seedRunningProjects } from "./helpers/background-fixtures.js";
import type { RunningProjectFixture } from "./helpers/background-fixtures.js";
import { useStrictScopeForFile } from "./helpers/strict-scope.js";
import { TENANT_A, TENANT_B, seedTestTenants, withMigrator } from "./helpers/tenancy.js";

useStrictScopeForFile();
initTaskEngine();
initPipelineEngine();

const isSuperuser = process.env.OSCORPEX_MIGRATION_DATABASE_URL === undefined;

function skipIfSuperuser(ctx: TestContext): void {
	// Superuser mode bypasses RLS: assertions that depend on the policies cannot hold there.
	if (isSuperuser) ctx.skip();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let fx: { A: RunningProjectFixture; B: RunningProjectFixture };

interface ExtraProject {
	tenantId: string;
	projectId: string;
	planId: string;
	phaseId: string;
	taskId: string;
	runId: string;
	/** Status of the project's pipeline_run, or null for a running project without any pipeline_run. */
	pipeline: "running" | "paused" | "failed" | null;
}

function extra(key: string, tenantId: string, pipeline: ExtraProject["pipeline"] = "running"): ExtraProject {
	return {
		pipeline,
		tenantId,
		projectId: `f3d-rec-project-${key}`,
		planId: `f3d-rec-plan-${key}`,
		phaseId: `f3d-rec-phase-${key}`,
		taskId: `f3d-rec-task-${key}`,
		runId: `f3d-rec-run-${key}`,
	};
}

const EXTRAS: ExtraProject[] = [
	extra("1", TENANT_A),
	extra("2", TENANT_B),
	extra("3", TENANT_A),
	extra("4", TENANT_B),
	extra("5", TENANT_A),
	extra("6", TENANT_B),
];
const OVER_BUDGET = extra("over", TENANT_A);
const NO_RUN = extra("norun", TENANT_A, null);
const PAUSED = extra("paused", TENANT_B, "paused");
const FAILED = extra("failed", TENANT_A, "failed");
const ALL_EXTRAS = [...EXTRAS, OVER_BUDGET, NO_RUN, PAUSED, FAILED];

async function insertRunningProject(c: import("pg").Client, p: ExtraProject): Promise<void> {
	await c.query(
		`INSERT INTO projects (id, name, status, created_at, updated_at, tenant_id)
		 VALUES ($1, $2, 'running', now(), now(), $3)
		 ON CONFLICT (id) DO UPDATE SET status = 'running', tenant_id = EXCLUDED.tenant_id`,
		[p.projectId, `F3-d ${p.projectId}`, p.tenantId],
	);
	if (p.pipeline) {
		await c.query(
			`INSERT INTO pipeline_runs (id, project_id, status, created_at) VALUES ($1, $2, $3, now()::text)
			 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
			[p.runId, p.projectId, p.pipeline],
		);
	}
	await c.query(
		`INSERT INTO project_plans (id, project_id, status, created_at, tenant_id) VALUES ($1, $2, 'approved', now(), $3)
		 ON CONFLICT (id) DO UPDATE SET status = 'approved'`,
		[p.planId, p.projectId, p.tenantId],
	);
	await c.query(
		`INSERT INTO phases (id, plan_id, name, "order", status, tenant_id) VALUES ($1, $2, 'F3-d phase', 1, 'running', $3)
		 ON CONFLICT (id) DO UPDATE SET status = 'running'`,
		[p.phaseId, p.planId, p.tenantId],
	);
	await c.query(
		`INSERT INTO tasks (id, phase_id, project_id, title, status, tenant_id)
		 VALUES ($1, $2, $3, 'F3-d stuck task', 'running', $4)
		 ON CONFLICT (id) DO UPDATE SET status = 'running'`,
		[p.taskId, p.phaseId, p.projectId, p.tenantId],
	);
}

async function deleteExtras(c: import("pg").Client): Promise<void> {
	const all = ALL_EXTRAS;
	const ids = all.map((p) => p.projectId);
	await c.query("DELETE FROM events WHERE project_id = ANY($1)", [ids]);
	await c.query("DELETE FROM token_usage WHERE project_id = ANY($1)", [ids]);
	await c.query("DELETE FROM project_settings WHERE project_id = ANY($1)", [ids]);
	await c.query("DELETE FROM tasks WHERE id = ANY($1)", [all.map((p) => p.taskId)]);
	await c.query("DELETE FROM phases WHERE id = ANY($1)", [all.map((p) => p.phaseId)]);
	await c.query("DELETE FROM project_plans WHERE id = ANY($1)", [all.map((p) => p.planId)]);
	await c.query("DELETE FROM pipeline_runs WHERE id = ANY($1)", [all.map((p) => p.runId)]);
	await c.query("DELETE FROM projects WHERE id = ANY($1)", [ids]);
}

async function seedRecoveryProjects(): Promise<void> {
	await withMigrator(async (c) => {
		await deleteExtras(c);
		for (const p of ALL_EXTRAS) await insertRunningProject(c, p);
		// Stuck work in the A/B fixtures too.
		await c.query("UPDATE tasks SET status = 'running' WHERE id = ANY($1)", [[fx.A.taskId, fx.B.taskId]]);
		// Over-budget project: cap 0.01 USD, 5 USD spent.
		await c.query(
			`INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
			 VALUES ('f3d-budget-setting', $1, 'budget', 'maxCostUsd', '0.01', now())
			 ON CONFLICT (id) DO UPDATE SET value = '0.01'`,
			[OVER_BUDGET.projectId],
		);
		await c.query(
			`INSERT INTO token_usage (id, project_id, task_id, agent_id, model, provider, input_tokens, output_tokens,
			   total_tokens, cost_usd, cache_creation_tokens, cache_read_tokens, created_at)
			 VALUES ('f3d-over-usage', $1, $2, 'f3d-agent', 'm', 'p', 1, 1, 2, 5, 0, 0, now())
			 ON CONFLICT (id) DO NOTHING`,
			[OVER_BUDGET.projectId, OVER_BUDGET.taskId],
		);
	});
}

async function cleanupAll(): Promise<void> {
	await withMigrator(async (c) => {
		const ids = [fx.A.projectId, fx.B.projectId];
		await c.query("DELETE FROM events WHERE project_id = ANY($1)", [ids]);
		await c.query("DELETE FROM token_usage WHERE project_id = ANY($1)", [ids]);
		await deleteExtras(c);
	});
	await cleanupRunningProjects();
}

beforeAll(async () => {
	await seedTestTenants();
	fx = await seedRunningProjects();
});

afterAll(async () => {
	await cleanupAll();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenantOf(projectId: string): string | undefined {
	if (projectId === fx.A.projectId) return TENANT_A;
	if (projectId === fx.B.projectId) return TENANT_B;
	return undefined;
}

interface Dispatch {
	projectId: string;
	taskId: string;
	scope: ReturnType<typeof currentScope>;
}

/** Mocked executeTask: records the scope it runs in and writes an event and a token_usage row from there. No agent runs. */
function makeExecuteTask(calls: Dispatch[]) {
	return vi.fn(async (projectId: string, task: Task) => {
		if (tenantOf(projectId) === undefined) return; // leftovers of other tests in the shared DB
		calls.push({ projectId, taskId: task.id, scope: currentScope() });
		await eventBus.emitAsync({ projectId, taskId: task.id, type: "task:started", payload: { f3d: true } });
		await recordTokenUsage({
			projectId,
			taskId: task.id,
			agentId: "f3d-agent",
			model: "m",
			provider: "p",
			inputTokens: 1,
			outputTokens: 1,
			totalTokens: 2,
			costUsd: 0.001,
		});
	});
}

function newDispatcher(calls: Dispatch[]): TaskDispatcher {
	return new TaskDispatcher(new AdaptiveSemaphore(3), makeExecuteTask(calls));
}

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > ms) return;
		await new Promise((r) => setTimeout(r, 15));
	}
}

function allErrorCalls(): string[] {
	const out: string[] = [];
	for (const l of loggers.values()) {
		for (const call of l.error?.mock.calls ?? [])
			out.push(JSON.stringify(call, (_k, v) => (v instanceof Error ? v.message : v)));
	}
	return out;
}

function resetLoggers(): void {
	for (const l of loggers.values()) for (const fn of Object.values(l)) if (typeof fn === "function") fn.mockClear?.();
}

/** Neither events nor token_usage has a tenant_id column (RLS goes through projects), so read the owning project's. */
async function rowTenants(table: "events" | "token_usage", projectId: string): Promise<Array<string | null>> {
	const sql =
		table === "events"
			? "SELECT p.tenant_id FROM events e JOIN projects p ON p.id = e.project_id WHERE e.project_id = $1"
			: "SELECT p.tenant_id FROM token_usage t JOIN projects p ON p.id = t.project_id WHERE t.project_id = $1";
	return withMigrator(async (c) =>
		(await c.query<{ tenant_id: string | null }>(sql, [projectId])).rows.map((x) => x.tenant_id),
	);
}

beforeEach(() => {
	resetLoggers();
	nullTenantRow.on = null;
	nullTenantRow.first = false;
	queryHook.fn = undefined;
});

afterEach(() => {
	vi.restoreAllMocks();
});

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** True when p settles within ms; a never-settling p yields false instead of hanging the test. */
async function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
	return Promise.race([
		p.then(
			() => true,
			() => true,
		),
		sleep(ms).then(() => false),
	]);
}

// ---------------------------------------------------------------------------
// 1. Watchdog tick handles A and B, each in its own tenant scope
// ---------------------------------------------------------------------------

async function queueTasksAndClearEvidence(): Promise<void> {
	await withMigrator(async (c) => {
		await c.query("DELETE FROM events WHERE project_id = ANY($1)", [[fx.A.projectId, fx.B.projectId]]);
		await c.query("DELETE FROM token_usage WHERE project_id = ANY($1)", [[fx.A.projectId, fx.B.projectId]]);
		await c.query("UPDATE tasks SET status = 'queued' WHERE id = ANY($1)", [[fx.A.taskId, fx.B.taskId]]);
	});
}

/** One timer tick (no scope) and a short wait for the fire-and-forget task bodies. */
async function tickWatchdog(): Promise<Dispatch[]> {
	await queueTasksAndClearEvidence();
	const calls: Dispatch[] = [];
	await newDispatcher(calls).runDispatchWatchdog();
	await waitFor(() => calls.length >= 2);
	await waitFor(() => false, 150);
	return calls;
}

describe("F3-d 1 - watchdog tick", () => {
	it("dispatches A's and B's running projects, each inside its own tenant scope, and stamps events/token_usage", async () => {
		const calls = await tickWatchdog();

		const a = calls.find((c) => c.projectId === fx.A.projectId);
		const b = calls.find((c) => c.projectId === fx.B.projectId);
		expect(a?.scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
		expect(b?.scope).toEqual({ kind: "tenant", tenantId: TENANT_B });

		expect(await rowTenants("events", fx.A.projectId)).toEqual([TENANT_A]);
		expect(await rowTenants("events", fx.B.projectId)).toEqual([TENANT_B]);
		expect(await rowTenants("token_usage", fx.A.projectId)).toEqual([TENANT_A]);
		expect(await rowTenants("token_usage", fx.B.projectId)).toEqual([TENANT_B]);
	});

	it("the written events and token_usage rows are visible to their own tenant and invisible to the other (RLS)", async (ctx) => {
		skipIfSuperuser(ctx);
		await tickWatchdog();

		const visible = (tenant: string, table: "events" | "token_usage", projectId: string) =>
			runInTenant(
				tenant,
				async () => (await query(`SELECT 1 FROM ${table} WHERE project_id = $1`, [projectId])).length,
			);
		for (const table of ["events", "token_usage"] as const) {
			expect(await visible(TENANT_A, table, fx.A.projectId), `${table}: A sees A`).toBeGreaterThan(0);
			expect(await visible(TENANT_B, table, fx.A.projectId), `${table}: B must not see A`).toBe(0);
			expect(await visible(TENANT_B, table, fx.B.projectId), `${table}: B sees B`).toBeGreaterThan(0);
			expect(await visible(TENANT_A, table, fx.B.projectId), `${table}: A must not see B`).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. NULL tenant row is skipped and reported, others still processed
// ---------------------------------------------------------------------------

describe("F3-d 2 - watchdog NULL tenant and isolation", () => {
	it("skips a row without tenant, logs an error and still processes the other projects", async () => {
		nullTenantRow.on = "sys_running_project_phases";
		const calls: Dispatch[] = [];
		const dispatcher = newDispatcher(calls);

		await dispatcher.runDispatchWatchdog();
		await waitFor(() => calls.length >= 2);

		expect(calls.map((c) => c.projectId)).not.toContain(nullTenantRow.projectId);
		expect(calls.map((c) => c.projectId).sort()).toEqual([fx.A.projectId, fx.B.projectId].sort());
		const errors = allErrorCalls();
		const reported = errors.some(
			(e) =>
				e.includes(nullTenantRow.projectId) ||
				/null.{0,40}tenant|tenant.{0,40}null|missing tenant|without tenant/i.test(e),
		);
		expect(reported, `log.error calls: ${errors.join(" | ")}`).toBe(true);
	});

	it("a NULL-tenant row listed FIRST and a project whose dispatch throws do not stop the remaining projects", async () => {
		await queueTasksAndClearEvidence();
		nullTenantRow.on = "sys_running_project_phases";
		nullTenantRow.first = true;
		const engine = taskEngine();
		const realGetReadyTasks = engine.getReadyTasks.bind(engine);
		vi.spyOn(engine, "getReadyTasks").mockImplementation(async (phaseId: string) => {
			if (phaseId === fx.A.phaseId) throw new Error("f3d dispatch failure");
			return realGetReadyTasks(phaseId);
		});
		const calls: Dispatch[] = [];

		await newDispatcher(calls).runDispatchWatchdog();
		await waitFor(() => calls.some((c) => c.projectId === fx.B.projectId));

		const dispatched = calls.map((c) => c.projectId);
		expect(dispatched).toContain(fx.B.projectId);
		expect(dispatched).not.toContain(fx.A.projectId);
		expect(dispatched).not.toContain(nullTenantRow.projectId);
		const errors = allErrorCalls();
		expect(
			errors.some((e) => e.includes(fx.A.projectId)),
			`log.error calls: ${errors.join(" | ")}`,
		).toBe(true);
		expect(
			errors.some((e) => e.includes(nullTenantRow.projectId)),
			`log.error calls: ${errors.join(" | ")}`,
		).toBe(true);
	});

	it("does not dispatch an over-budget project, even when pausing its pipeline fails", async () => {
		await seedRecoveryProjects();
		await withMigrator((c) =>
			c.query("UPDATE tasks SET status = 'queued' WHERE id = ANY($1)", [
				[fx.A.taskId, fx.B.taskId, OVER_BUDGET.taskId],
			]),
		);
		vi.spyOn(pipelineEngine(), "pausePipeline").mockRejectedValue(new Error("f3d pause failure"));
		const dispatched: string[] = [];
		const dispatcher = new TaskDispatcher(
			new AdaptiveSemaphore(3),
			vi.fn(async (projectId: string) => {
				dispatched.push(projectId);
			}),
		);

		await dispatcher.runDispatchWatchdog();
		await waitFor(() => dispatched.includes(fx.A.projectId) && dispatched.includes(fx.B.projectId));
		await waitFor(() => false, 150);

		expect(dispatched).toContain(fx.A.projectId);
		expect(dispatched).toContain(fx.B.projectId);
		expect(dispatched).not.toContain(OVER_BUDGET.projectId);
	});
});

// ---------------------------------------------------------------------------
// 3. Startup recovery
// ---------------------------------------------------------------------------

type Start = { projectId: string; scope: ReturnType<typeof currentScope> };

describe("F3-d 3 - startup recovery", () => {
	const envKey = "OSCORPEX_RECOVERY_CONCURRENCY";
	let savedEnv: string | undefined;

	beforeEach(async () => {
		savedEnv = process.env[envKey];
		await seedRecoveryProjects();
	});

	afterEach(() => {
		if (savedEnv === undefined) delete process.env[envKey];
		else process.env[envKey] = savedEnv;
	});

	/** Mocked execution restart: records the scope it was started in; with hang=true it never settles. */
	function newRecovery(starts: Start[], opts: { hang?: boolean } = {}) {
		const start = vi.fn((projectId: string) => {
			starts.push({ projectId, scope: currentScope() });
			return opts.hang ? new Promise<void>(() => {}) : Promise.resolve();
		});
		const exec = vi.fn(() => new Promise<void>(() => {}));
		return { recovery: new ExecutionRecovery(new Map(), new Set(), exec, start), start };
	}

	const resetTaskIds = (): Set<string> => new Set([fx.A.taskId, fx.B.taskId, ...EXTRAS.map((p) => p.taskId)]);

	/** The task reset: an UPDATE tasks statement that sets status = queued for one of the seeded stuck tasks. */
	function taskResetOf(sql: string, params?: unknown[]): string | undefined {
		if (!/^\s*UPDATE tasks\b/i.test(sql) || !(params ?? []).includes("queued")) return undefined;
		return (params ?? []).find((p): p is string => typeof p === "string" && resetTaskIds().has(p));
	}

	/** Measures how many project recoveries run their reset step at the same time (execution is not involved). */
	function trackResetConcurrency(track: { cur: number; max: number }): void {
		queryHook.fn = async (sql, params) => {
			if (!taskResetOf(sql, params)) return;
			track.cur++;
			track.max = Math.max(track.max, track.cur);
			await sleep(40);
			track.cur--;
		};
	}

	it("resumes stuck work of A and B inside their own tenant scopes", async () => {
		const starts: Start[] = [];
		const { recovery } = newRecovery(starts);

		await recovery.recoverStuckTasks();

		const a = starts.find((s) => s.projectId === fx.A.projectId);
		const b = starts.find((s) => s.projectId === fx.B.projectId);
		expect(a?.scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
		expect(b?.scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
		const statuses = await withMigrator(async (c) => {
			const r = await c.query<{ id: string; status: string }>("SELECT id, status FROM tasks WHERE id = ANY($1)", [
				[fx.A.taskId, fx.B.taskId],
			]);
			return Object.fromEntries(r.rows.map((x) => [x.id, x.status]));
		});
		expect(statuses[fx.A.taskId]).toBe("queued");
		expect(statuses[fx.B.taskId]).toBe("queued");
	});

	it("never waits for project executions: recovery resolves promptly while every restart hangs forever", async () => {
		const starts: Start[] = [];
		const { recovery } = newRecovery(starts, { hang: true });

		expect(await settlesWithin(recovery.recoverStuckTasks(), 5000), "recoverStuckTasks hung on execution").toBe(true);

		// The restarts were still kicked off, in the project's tenant scope.
		const a = starts.find((s) => s.projectId === fx.A.projectId);
		const b = starts.find((s) => s.projectId === fx.B.projectId);
		expect(a?.scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
		expect(b?.scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
		for (const p of EXTRAS) expect(starts.map((s) => s.projectId)).toContain(p.projectId);
	});

	it("the startup wrapper (runStartupRecoveryWithRetry) does not hang on execution either", async () => {
		const { recovery } = newRecovery([], { hang: true });

		expect(await settlesWithin(runStartupRecoveryWithRetry(recovery), 5000), "startup recovery hung on execution").toBe(
			true,
		);
	});

	it("never runs more project recoveries concurrently than OSCORPEX_RECOVERY_CONCURRENCY and restarts every project", async () => {
		process.env[envKey] = "2";
		const starts: Start[] = [];
		const track = { cur: 0, max: 0 };
		trackResetConcurrency(track);
		const { recovery } = newRecovery(starts);

		await recovery.recoverStuckTasks();

		const restarted = new Set(starts.map((s) => s.projectId));
		for (const p of [fx.A, fx.B, ...EXTRAS]) expect(restarted.has(p.projectId)).toBe(true);
		expect(track.max).toBe(2);
	});

	it("honours a lower limit of 1 and defaults to 2", async () => {
		delete process.env[envKey];
		expect(getRecoveryConfig().concurrency).toBe(2);

		process.env[envKey] = "1";
		expect(getRecoveryConfig().concurrency).toBe(1);
		const starts: Start[] = [];
		const track = { cur: 0, max: 0 };
		trackResetConcurrency(track);
		const { recovery } = newRecovery(starts);
		await recovery.recoverStuckTasks();
		expect(starts.length).toBeGreaterThanOrEqual(2 + EXTRAS.length);
		expect(track.max).toBe(1);
	});

	it("clamps OSCORPEX_RECOVERY_CONCURRENCY to [1, 10] and falls back to the default for garbage", () => {
		const read = (v: string): number => {
			process.env[envKey] = v;
			return getRecoveryConfig().concurrency;
		};
		expect(read("0")).toBe(1);
		expect(read("-3")).toBe(1);
		expect(read("50")).toBe(10);
		expect(read("10")).toBe(10);
		expect(read("abc")).toBe(2);
	});

	it("does not restart a project that is over its budget", async () => {
		const starts: Start[] = [];
		const { recovery } = newRecovery(starts);

		await recovery.recoverStuckTasks();

		expect(starts.map((s) => s.projectId)).not.toContain(OVER_BUDGET.projectId);
		// ...while the in-budget projects are restarted.
		expect(starts.map((s) => s.projectId)).toContain(fx.A.projectId);
	});

	it("recovers a running project that has no pipeline_run, and leaves paused/failed pipelines alone", async () => {
		const starts: Start[] = [];
		const { recovery } = newRecovery(starts);

		await recovery.recoverStuckTasks();

		const restarted = starts.map((s) => s.projectId);
		expect(restarted).toContain(NO_RUN.projectId);
		expect(restarted).not.toContain(PAUSED.projectId);
		expect(restarted).not.toContain(FAILED.projectId);
		const statuses = await withMigrator(async (c) => {
			const r = await c.query<{ id: string; status: string }>("SELECT id, status FROM tasks WHERE id = ANY($1)", [
				[NO_RUN.taskId, PAUSED.taskId, FAILED.taskId],
			]);
			return Object.fromEntries(r.rows.map((x) => [x.id, x.status]));
		});
		expect(statuses[NO_RUN.taskId]).toBe("queued");
		expect(statuses[PAUSED.taskId]).toBe("running");
		expect(statuses[FAILED.taskId]).toBe("running");
	});

	it("sys_running_projects() lists running projects without a pipeline_run and hides paused/failed ones", async () => {
		const rows = await runAsSystem("f3d-sys-running", () =>
			query<{ project_id: string; tenant_id: string | null }>(
				"SELECT project_id, tenant_id FROM sys_running_projects()",
			),
		);
		const byId = new Map(rows.map((r) => [r.project_id, r.tenant_id]));
		expect(byId.get(fx.A.projectId)).toBe(TENANT_A);
		expect(byId.get(fx.B.projectId)).toBe(TENANT_B);
		expect(byId.get(NO_RUN.projectId)).toBe(TENANT_A);
		expect(byId.has(PAUSED.projectId)).toBe(false);
		expect(byId.has(FAILED.projectId)).toBe(false);
	});

	it("skips a NULL-tenant project with log.error and still recovers the other projects", async () => {
		nullTenantRow.on = "sys_running_projects";
		nullTenantRow.first = true;
		const starts: Start[] = [];
		const { recovery } = newRecovery(starts);

		await recovery.recoverStuckTasks();

		const restarted = starts.map((s) => s.projectId);
		expect(restarted).not.toContain(nullTenantRow.projectId);
		expect(restarted).toContain(fx.A.projectId);
		expect(restarted).toContain(fx.B.projectId);
		const errors = (loggers.get("execution-recovery")?.error.mock.calls ?? []).map((c) =>
			JSON.stringify(c, (_k, v) => (v instanceof Error ? v.message : v)),
		);
		expect(
			errors.some((e) => e.includes(nullTenantRow.projectId) || /null.{0,40}tenant|tenant.{0,40}null/i.test(e)),
			`execution-recovery log.error calls: ${errors.join(" | ")}`,
		).toBe(true);
	});

	it("a deadlock in one project's recovery retries only that project", async () => {
		// A project recovery attempt always starts with its budget check, so those queries count attempts per project.
		// (Counting task resets would not work: a re-run finds the tasks already reset.)
		const attempts = new Map<string, number>();
		const victim = EXTRAS[0];
		let thrown = false;
		queryHook.fn = (sql, params) => {
			if (sql.includes("FROM token_usage tu")) {
				const id = String(params?.[0]);
				attempts.set(id, (attempts.get(id) ?? 0) + 1);
			}
			if (taskResetOf(sql, params) === victim.taskId && !thrown) {
				thrown = true;
				throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
			}
		};
		const starts: Start[] = [];

		await runStartupRecoveryWithRetry(newRecovery(starts).recovery);

		expect(thrown).toBe(true);
		expect(attempts.get(victim.projectId), "the deadlocked project is retried").toBe(2);
		for (const p of [fx.A, fx.B, ...EXTRAS.filter((e) => e !== victim)]) {
			expect(attempts.get(p.projectId), `project ${p.projectId} must be recovered exactly once`).toBe(1);
		}
		expect(starts.map((s) => s.projectId)).toContain(victim.projectId);
	});
});

// ---------------------------------------------------------------------------
// 4. Timers do not capture the tenant of their creator
// ---------------------------------------------------------------------------

describe("F3-d 4 - timers", () => {
	it("a watchdog started inside runInTenant(A) ticks in system scope, not in A", async () => {
		const scopes: Array<ReturnType<typeof currentScope>> = [];
		const watchdog = new ExecutionWatchdog(async () => {
			scopes.push(currentScope());
		}, 20);
		try {
			await runInTenant(TENANT_A, async () => watchdog.start());
			await waitFor(() => scopes.length >= 2);
		} finally {
			watchdog.stop();
		}
		expect(scopes.length).toBeGreaterThanOrEqual(1);
		for (const s of scopes) expect(s).toEqual(expect.objectContaining({ kind: "system" }));
	});

	it("a timer created inside A's scope still processes B's project in B's scope (system -> tenant per project)", async () => {
		await withMigrator((c) =>
			c.query("UPDATE tasks SET status = 'queued' WHERE id = ANY($1)", [[fx.A.taskId, fx.B.taskId]]),
		);
		const calls: Dispatch[] = [];
		const dispatcher = newDispatcher(calls);
		const watchdog = new ExecutionWatchdog(() => dispatcher.runDispatchWatchdog(), 20);
		try {
			await runInTenant(TENANT_A, async () => watchdog.start());
			await waitFor(() => calls.some((c) => c.projectId === fx.B.projectId));
		} finally {
			watchdog.stop();
		}
		const b = calls.find((c) => c.projectId === fx.B.projectId);
		const a = calls.find((c) => c.projectId === fx.A.projectId);
		expect(b?.scope).toEqual({ kind: "tenant", tenantId: TENANT_B });
		expect(a?.scope).toEqual({ kind: "tenant", tenantId: TENANT_A });
	});
});

// ---------------------------------------------------------------------------
// 5. provider-state persistence
// ---------------------------------------------------------------------------

describe("F3-d 5 - provider-state", () => {
	function providerStateErrors(): unknown[][] {
		const l = loggers.get("provider-state");
		return [...(l?.warn?.mock.calls ?? []), ...(l?.error?.mock.calls ?? [])];
	}

	async function persistedFailures(): Promise<number | undefined> {
		return withMigrator(async (c) => {
			const r = await c.query<{ consecutive_failures: number }>(
				"SELECT consecutive_failures FROM provider_state WHERE adapter = 'claude-code'",
			);
			return r.rows[0]?.consecutive_failures;
		});
	}

	afterEach(async () => {
		// Reset inside a scope: the fire-and-forget persist of markSuccess must not run unscoped.
		await runAsSystem("f3d-reset", async () => {
			providerState.markSuccess("claude-code");
			await providerState.persistToDb();
		});
	});

	it("persists from inside a tenant scope without scope errors", async () => {
		await runInTenant(TENANT_A, async () => {
			providerState.markSuccess("claude-code");
			await providerState.persistToDb();
			resetLoggers();
			providerState.markFailure("claude-code");
			await providerState.persistToDb();
		});
		expect(providerStateErrors()).toEqual([]);
		expect(await persistedFailures()).toBe(providerState.getState("claude-code")?.consecutiveFailures);
		expect(await persistedFailures()).toBe(1);
	});

	it("persists and loads from boot (system scope) without scope errors", async () => {
		await runAsSystem("f3d-boot", async () => {
			providerState.markSuccess("claude-code");
			await providerState.persistToDb();
			resetLoggers();
			providerState.markFailure("claude-code");
			await providerState.persistToDb();
			await providerState.loadFromDb();
		});
		expect(providerStateErrors()).toEqual([]);
		expect(await persistedFailures()).toBe(1);
		expect(loggers.get("provider-state")?.info).toHaveBeenCalledWith(expect.stringContaining("Loaded state from DB"));
	});

	it("does not swallow a scope failure silently: loading from no scope either rejects or logs it", async () => {
		let rejected = false;
		try {
			await providerState.loadFromDb(); // strict file, no scope
		} catch {
			rejected = true;
		}
		const logged = providerStateErrors().length > 0;
		const loaded = (loggers.get("provider-state")?.info.mock.calls ?? []).some((c) =>
			String(c[0]).includes("Loaded state from DB"),
		);
		expect(rejected || logged || loaded).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 6. Seeders run in system scope: presets are global (NULL tenant) and visible to every tenant
// ---------------------------------------------------------------------------

describe("F3-d 6 - seeders", () => {
	async function clearPresets(): Promise<void> {
		await withMigrator(async (c) => {
			await c.query("DELETE FROM agent_configs WHERE is_preset = 1");
		});
	}

	async function presetTenants(): Promise<Array<string | null>> {
		return withMigrator(async (c) => {
			const r = await c.query<{ tenant_id: string | null }>("SELECT tenant_id FROM agent_configs WHERE is_preset = 1");
			return r.rows.map((x) => x.tenant_id);
		});
	}

	afterAll(async () => {
		// Leave the shared test DB with its presets.
		await clearPresets();
		await runAsSystem("f3d-restore-seed", async () => {
			await registerSeeders();
		});
	});

	it("seeds presets with a NULL tenant and every tenant can read them", async (ctx) => {
		skipIfSuperuser(ctx);
		await clearPresets();

		// Boot calls registerSeeders outside any scope (strict mode in this file).
		await registerSeeders();
		await waitFor(() => false, 0);
		const start = Date.now();
		while ((await presetTenants()).length === 0 && Date.now() - start < 4000) {
			await new Promise((r) => setTimeout(r, 50));
		}

		const tenants = await presetTenants();
		expect(tenants.length).toBeGreaterThan(0);
		expect(tenants.every((t) => t === null)).toBe(true);

		for (const tenant of [TENANT_A, TENANT_B]) {
			const rows = await runInTenant(tenant, () =>
				query<{ id: string }>("SELECT id FROM agent_configs WHERE is_preset = 1"),
			);
			expect(rows.length).toBe(tenants.length);
		}
	});
});
