// ---------------------------------------------------------------------------
// F2c — enriched platform aggregates (sys_platform_stats + /platform/stats|analytics)
//
// Dashboards keep their data through aggregate-only SQL: counts/sums computed across ALL
// tenants, with no identifying value (project id/name, task id/title, file path) in the output.
// Runs in both modes (SECURITY DEFINER sys_* functions work for superuser and app role).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from "vitest";
import { signJwt } from "../auth/jwt.js";
import { studioRoutes } from "../index.js";
import { queryOne } from "../pg.js";
import { runAsSystem, runOutsideScope } from "../tenancy/tenant-scope.js";
import { it } from "./helpers/outside-scope.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

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
// Distinctive seed identifiers (must never appear in aggregate output)
// ---------------------------------------------------------------------------
const U = randomUUID().slice(0, 8);
const ids = {
	projA: `f2cs-projA-${U}`,
	projB: `f2cs-projB-${U}`,
	nameA: `SecretProjectNameA-${U}`,
	nameB: `SecretProjectNameB-${U}`,
	repoA: `/f2cs/secret/repoA-${U}`,
	repoB: `/f2cs/secret/repoB-${U}`,
	fileA: `/f2cs/secret/src/fileA-${U}.ts`,
	fileB: `/f2cs/secret/src/fileB-${U}.ts`,
	planA: `f2cs-planA-${U}`,
	planB: `f2cs-planB-${U}`,
	phaseA: `f2cs-phaseA-${U}`,
	phaseB: `f2cs-phaseB-${U}`,
	tasks: {
		aDone: { id: `f2cs-tAdone-${U}`, title: `SecretTitle-A-done-${U}` },
		aRun: { id: `f2cs-tArun-${U}`, title: `SecretTitle-A-run-${U}` },
		bQueued: { id: `f2cs-tBq-${U}`, title: `SecretTitle-B-queued-${U}` },
		bFailed: { id: `f2cs-tBf-${U}`, title: `SecretTitle-B-failed-${U}` },
	},
	modelA: `f2cs-model-a-${U}`,
	modelB: `f2cs-model-b-${U}`,
	evtA: `f2cs:evt-a-${U}`,
	evtB: `f2cs:evt-b-${U}`,
};
const identifying = [
	ids.projA,
	ids.projB,
	ids.nameA,
	ids.nameB,
	ids.repoA,
	ids.repoB,
	ids.fileA,
	ids.fileB,
	...Object.values(ids.tasks).flatMap((t) => [t.id, t.title]),
];

let adminToken: string;
let ownerToken: string;
const userIds: string[] = [];

async function mkUser(admin: boolean): Promise<string> {
	const id = `f2cs-user-${randomUUID()}`;
	userIds.push(id);
	await withMigrator(async (c) => {
		await c.query(
			"INSERT INTO users (id, email, password_hash, tenant_id, is_platform_admin) VALUES ($1, $2, 'x', $3, $4)",
			[id, `${id}@f2c.test`, TENANT_A, admin],
		);
		await c.query("INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, 'owner')", [id, TENANT_A]);
	});
	return signJwt({ sub: id, email: `${id}@f2c.test`, tenantId: TENANT_A, role: "owner" });
}

const get = (token: string, path: string) =>
	runOutsideScope(async () => studioRoutes.request(path, { headers: { Authorization: `Bearer ${token}` } }));

// Snapshot helpers ----------------------------------------------------------
async function sysStats(): Promise<Record<string, unknown>> {
	const row = await runOutsideScope(() =>
		runAsSystem("f2c-stats-test", () => queryOne<{ s: Record<string, unknown> }>("SELECT sys_platform_stats() AS s")),
	);
	return (row?.s ?? {}) as Record<string, unknown>;
}
const apiStats = async () => (await (await get(adminToken, "/platform/stats")).json()) as any;
const apiAnalytics = async () => (await (await get(adminToken, "/platform/analytics")).json()) as any;

function walkValues(v: unknown, out: unknown[] = []): unknown[] {
	if (Array.isArray(v)) for (const x of v) walkValues(x, out);
	else if (v && typeof v === "object") for (const x of Object.values(v)) walkValues(x, out);
	else out.push(v);
	return out;
}
const countOf = (arr: any[] | undefined, key: string, name: string, field = "count") =>
	Number((arr ?? []).find((x) => x[key] === name)?.[field] ?? 0);
const sumOf = (arr: any[] | undefined, field: string) => (arr ?? []).reduce((a, x) => a + Number(x[field] ?? 0), 0);

let before: { sys: any; stats: any; analytics: any };
let after: { sys: any; stats: any; analytics: any };

beforeAll(async () => {
	adminToken = await mkUser(true);
	ownerToken = await mkUser(false);
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

	// Dashboard snapshot BEFORE seeding (process.env set by beforeEach is not active in beforeAll)
	process.env.OSCORPEX_AUTH_ENABLED = "true";
	before = { sys: await sysStats(), stats: await apiStats(), analytics: await apiAnalytics() };

	await withMigrator(async (c) => {
		const proj = (id: string, name: string, status: string, repo: string, tenant: string) =>
			c.query(
				"INSERT INTO projects (id, name, status, repo_path, created_at, updated_at, tenant_id) VALUES ($1, $2, $3, $4, now(), now(), $5)",
				[id, name, status, repo, tenant],
			);
		await proj(ids.projA, ids.nameA, "completed", ids.repoA, TENANT_A);
		await proj(ids.projB, ids.nameB, "failed", ids.repoB, TENANT_B);
		for (const [plan, proj_, phase, tenant] of [
			[ids.planA, ids.projA, ids.phaseA, TENANT_A],
			[ids.planB, ids.projB, ids.phaseB, TENANT_B],
		]) {
			await c.query(
				"INSERT INTO project_plans (id, project_id, status, created_at, tenant_id) VALUES ($1, $2, 'approved', now(), $3)",
				[plan, proj_, tenant],
			);
			await c.query(
				"INSERT INTO phases (id, plan_id, name, status, tenant_id) VALUES ($1, $2, 'f2cs-phase', 'running', $3)",
				[phase, plan, tenant],
			);
		}
		const task = (
			t: { id: string; title: string },
			phase: string,
			proj_: string,
			tenant: string,
			status: string,
			cx: string,
			file: string,
		) =>
			c.query(
				`INSERT INTO tasks (id, phase_id, title, status, complexity, project_id, tenant_id, target_files, completed_at, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $4 = 'done' THEN now() ELSE NULL END, now())`,
				[t.id, phase, t.title, status, cx, proj_, tenant, JSON.stringify([file])],
			);
		await task(ids.tasks.aDone, ids.phaseA, ids.projA, TENANT_A, "done", "XL", ids.fileA);
		await task(ids.tasks.aRun, ids.phaseA, ids.projA, TENANT_A, "running", "M", ids.fileA);
		await task(ids.tasks.bQueued, ids.phaseB, ids.projB, TENANT_B, "queued", "S", ids.fileB);
		await task(ids.tasks.bFailed, ids.phaseB, ids.projB, TENANT_B, "failed", "S", ids.fileB);

		const usage = (tid: string, proj_: string, model: string, cost: number, tokens: number, cr: number, cc: number) =>
			c.query(
				`INSERT INTO token_usage (id, project_id, task_id, agent_id, model, total_tokens, input_tokens, output_tokens, cost_usd, created_at,
				                          cache_read_tokens, cache_creation_tokens)
				 VALUES ($1, $2, $3, 'f2cs-agent', $4, $5, $5, 0, $6, now(), $7, $8)`,
				[`f2cs-u-${randomUUID()}`, proj_, tid, model, tokens, cost, cr, cc],
			);
		await usage(ids.tasks.aDone.id, ids.projA, ids.modelA, 2.5, 1000, 400, 100);
		await usage(ids.tasks.bFailed.id, ids.projB, ids.modelB, 1.25, 500, 100, 50);

		const evt = (proj_: string, type: string, n: number, file: string) =>
			Promise.all(
				Array.from({ length: n }, () =>
					c.query("INSERT INTO events (id, project_id, type, payload, timestamp) VALUES ($1, $2, $3, $4, now())", [
						`f2cs-e-${randomUUID()}`,
						proj_,
						type,
						JSON.stringify({ file }),
					]),
				),
			);
		await evt(ids.projA, ids.evtA, 3, ids.fileA);
		await evt(ids.projB, ids.evtB, 2, ids.fileB);
		await evt(ids.projA, "task:failed", 1, ids.fileA);
	});

	after = { sys: await sysStats(), stats: await apiStats(), analytics: await apiAnalytics() };
});

afterAll(async () => {
	await withMigrator(async (c) => {
		await c.query("DELETE FROM events WHERE project_id = ANY($1)", [[ids.projA, ids.projB]]);
		await c.query("DELETE FROM token_usage WHERE project_id = ANY($1)", [[ids.projA, ids.projB]]);
		await c.query("DELETE FROM tasks WHERE project_id = ANY($1)", [[ids.projA, ids.projB]]);
		await c.query("DELETE FROM phases WHERE id = ANY($1)", [[ids.phaseA, ids.phaseB]]);
		await c.query("DELETE FROM project_plans WHERE id = ANY($1)", [[ids.planA, ids.planB]]);
		await c.query("DELETE FROM projects WHERE id = ANY($1)", [[ids.projA, ids.projB]]);
		await c.query("DELETE FROM users WHERE id = ANY($1)", [userIds]);
	});
});

// ---------------------------------------------------------------------------
// 1. sys_platform_stats(): cross-tenant aggregates
// ---------------------------------------------------------------------------
describe("sys_platform_stats() — aggregates across all tenants", () => {
	const d = (k: string) => Number(after.sys[k] ?? 0) - Number(before.sys[k] ?? 0);

	it("counts projects/tasks/cost of BOTH tenants", () => {
		expect(d("total_projects")).toBe(2);
		expect(d("total_tasks")).toBe(4);
		expect(d("tasks_done")).toBe(1);
		expect(d("tasks_failed")).toBe(1);
		expect(d("total_cost_usd")).toBeCloseTo(3.75, 2);
	});

	it("returns a jsonb object with the richer aggregates (more than the legacy 5 keys)", () => {
		expect(Object.keys(after.sys).length).toBeGreaterThan(5);
	});

	it("returns NO identifying data (walks every value and the raw JSON text)", () => {
		const text = JSON.stringify(after.sys);
		for (const secret of identifying) {
			expect(text).not.toContain(secret);
			expect(walkValues(after.sys)).not.toContain(secret);
		}
	});
});

// ---------------------------------------------------------------------------
// 2. GET /platform/stats
// ---------------------------------------------------------------------------
describe("GET /platform/stats", () => {
	it("non-admin → 403, unauthenticated → 401", async () => {
		expect((await get(ownerToken, "/platform/stats")).status).toBe(403);
		expect((await studioRoutes.request("/platform/stats")).status).toBe(401);
	});

	it("project counts by status include both tenants", () => {
		const b = before.stats;
		const a = after.stats;
		expect(a.projects.total - b.projects.total).toBe(2);
		expect(a.projects.completed - b.projects.completed).toBe(1);
		expect(a.projects.failed - b.projects.failed).toBe(1);
	});

	it("task counts by status (done/running/queued/failed) include both tenants", () => {
		const b = before.stats.tasks;
		const a = after.stats.tasks;
		expect(a.total - b.total).toBe(4);
		expect(a.done - b.done).toBe(1);
		expect(a.running - b.running).toBe(1);
		expect(a.queued - b.queued).toBe(1);
		expect(a.failed - b.failed).toBe(1);
	});

	it("token / cache / cost totals are populated", () => {
		const b = before.stats.cost;
		const a = after.stats.cost;
		expect(a.totalUsd - b.totalUsd).toBeCloseTo(3.75, 1);
		expect(a.totalTokens - b.totalTokens).toBe(1500);
		expect(a.cacheReadTokens - b.cacheReadTokens).toBe(500);
		expect(a.cacheCreationTokens - b.cacheCreationTokens).toBe(150);
		expect(a.cacheRate).toBeGreaterThan(0);
	});

	it("contains no identifying data (no project names/ids, task titles/ids, paths)", async () => {
		const text = JSON.stringify(after.stats);
		for (const secret of identifying) expect(text).not.toContain(secret);
	});

	it("exposes no recent projects/tasks lists (aggregates only)", () => {
		expect(after.stats.recentProjects ?? []).toEqual([]);
		expect(after.stats.recentTasks ?? []).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 3. GET /platform/analytics
// ---------------------------------------------------------------------------
describe("GET /platform/analytics", () => {
	it("non-admin → 403, unauthenticated → 401", async () => {
		expect((await get(ownerToken, "/platform/analytics")).status).toBe(403);
		expect((await studioRoutes.request("/platform/analytics")).status).toBe(401);
	});

	it("totals include both tenants", () => {
		const b = before.analytics.totals;
		const a = after.analytics.totals;
		expect(a.totalProjects - b.totalProjects).toBe(2);
		expect(a.totalTasks - b.totalTasks).toBe(4);
		expect(a.tasksDone - b.tasksDone).toBe(1);
		expect(a.tasksFailed - b.tasksFailed).toBe(1);
		expect(a.totalCostUsd - b.totalCostUsd).toBeCloseTo(3.75, 1);
		expect(a.totalEvents - b.totalEvents).toBe(6);
		expect(a.cacheRate).toBeGreaterThan(0);
		expect(a.activeDays).toBeGreaterThan(0);
	});

	it("error rate is derived from error events", () => {
		const a = after.analytics.totals;
		expect(a.totalErrors - before.analytics.totals.totalErrors).toBeGreaterThanOrEqual(1);
		expect(a.errorRate).toBeGreaterThan(0);
	});

	it("cost by model lists both tenants' models with calls/cost/tokens", () => {
		const by = (m: string) => (after.analytics.costByModel as any[]).find((x) => x.model === m);
		expect(by(ids.modelA)).toMatchObject({ calls: 1, tokens: 1000 });
		expect(by(ids.modelA).cost).toBeCloseTo(2.5, 2);
		expect(by(ids.modelB)).toMatchObject({ calls: 1, tokens: 500 });
		expect(by(ids.modelB).cost).toBeCloseTo(1.25, 2);
	});

	it("event-type counts include both tenants", () => {
		expect(countOf(after.analytics.eventTypes, "type", ids.evtA)).toBe(3);
		expect(countOf(after.analytics.eventTypes, "type", ids.evtB)).toBe(2);
	});

	it("daily and hourly series are populated and add up", () => {
		const bA = before.analytics;
		const aA = after.analytics;
		expect(aA.dailyActivity.length).toBeGreaterThan(0);
		expect(sumOf(aA.dailyActivity, "events") - sumOf(bA.dailyActivity, "events")).toBe(6);
		expect(sumOf(aA.hourlyPattern, "count") - sumOf(bA.hourlyPattern, "count")).toBe(6);
	});

	it("complexity distribution (per-tier breakdown) includes both tenants", () => {
		const cd = (s: any, k: string) => countOf(s.complexityDistribution, "complexity", k);
		expect(cd(after.analytics, "XL") - cd(before.analytics, "XL")).toBe(1);
		expect(cd(after.analytics, "M") - cd(before.analytics, "M")).toBe(1);
		expect(cd(after.analytics, "S") - cd(before.analytics, "S")).toBe(2);
	});

	it("per-agent usage breakdown is an array of { agent, role, count }", () => {
		expect(Array.isArray(after.analytics.agentUsage)).toBe(true);
		for (const a of after.analytics.agentUsage as any[]) {
			expect(typeof a.role).toBe("string");
			expect(typeof a.count).toBe("number");
		}
	});

	it("contains no identifying data (project/task/file identifiers) anywhere in the payload", () => {
		const text = JSON.stringify(after.analytics);
		for (const secret of identifying) expect(text).not.toContain(secret);
	});

	it("exposes no per-project or per-file lists", () => {
		expect(after.analytics.projectActivity ?? []).toEqual([]);
		expect(after.analytics.fileActivity ?? []).toEqual([]);
		expect(after.analytics.errorRates ?? []).toEqual([]);
	});
});
