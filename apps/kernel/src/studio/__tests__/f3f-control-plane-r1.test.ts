// ---------------------------------------------------------------------------
// F3-f review fix round 1 — budget key parity, /queue-health tenant scoping, policy surface,
// least-privilege sysread grant on project_settings.
//
// Assumed APIs:
//   - budget counting (tenant summary + sys_control_plane_summary()) follows budget-guard.ts: key IN
//     ('maxCostUsd','max_usd'), maxCostUsd preferred, one count per project
//   - GET /queue-health -> { health: { queuedCount, dispatchingCount, failedToday } } for the caller's tenant only
//   - GET /policy/projects/:id -> { budget: { maxBudgetUsd, spentUsd } } (spend from token_usage)
//   - GET /policy/summary -> { projectCount, projectsWithBudget, projectsOverBudget, activeProfiles } tenant-only
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { U, call, cleanup, mkUser, registerCleanup, seedProject, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { it } from "./helpers/outside-scope.js";
import { TENANT_A, TENANT_B, roleExists, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

const PROFILE_A = `f3f-r1-prof-a-${U}`;
const PROFILE_B = `f3f-r1-prof-b-${U}`;

let ownerA: SeededUser;
let ownerB: SeededUser;
let projA: string;
let projB: string;

async function seedSetting(projectId: string, category: string, key: string, value: string): Promise<void> {
	await withMigrator((c) =>
		c.query(
			"INSERT INTO project_settings (id, project_id, category, key, value, updated_at) VALUES ($1, $2, $3, $4, $5, now())",
			[`f3f-r1-ps-${randomUUID()}`, projectId, category, key, value],
		),
	);
}

async function seedSpend(projectId: string, costUsd: number): Promise<void> {
	await withMigrator((c) =>
		c.query(
			"INSERT INTO token_usage (id, project_id, task_id, agent_id, model, cost_usd, created_at) VALUES ($1, $2, 'f3f-task', 'agent', 'model', $3, now())",
			[`f3f-r1-tu-${randomUUID()}`, projectId, costUsd],
		),
	);
}

async function seedTasks(projectId: string, status: string, n: number, completedAt?: string): Promise<void> {
	await withMigrator(async (c) => {
		const planId = `f3f-r1-plan-${randomUUID()}`;
		const phaseId = `f3f-r1-phase-${randomUUID()}`;
		await c.query(
			"INSERT INTO project_plans (id, project_id, version, status, created_at) VALUES ($1, $2, 1, 'approved', now())",
			[planId, projectId],
		);
		await c.query("INSERT INTO phases (id, plan_id, name, \"order\") VALUES ($1, $2, 'f3f', 0)", [phaseId, planId]);
		for (let i = 0; i < n; i++) {
			await c.query(
				"INSERT INTO tasks (id, phase_id, project_id, title, status, completed_at) VALUES ($1, $2, $3, 'f3f', $4, $5)",
				[`f3f-r1-task-${randomUUID()}`, phaseId, projectId, status, completedAt ?? null],
			);
		}
	});
}

async function overBudgetViaRoute(who: SeededUser): Promise<number> {
	const res = await call(who, "GET", "/summary");
	expect(res.status).toBe(200);
	return ((await res.json()) as any).summary.projectsOverBudget;
}

async function overBudgetViaSysFn(): Promise<number> {
	return withMigrator(async (c) =>
		Number((await c.query("SELECT sys_control_plane_summary() AS s")).rows[0].s.projects_over_budget),
	);
}

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	ownerB = await mkUser({ tenantId: TENANT_B });
	projA = await seedProject(TENANT_A);
	projB = await seedProject(TENANT_B);
});

afterAll(async () => {
	await withMigrator(async (c) => {
		await c.query(
			"DELETE FROM replay_snapshots WHERE run_id = ANY($1) OR run_id IN (SELECT id FROM runs WHERE project_id = ANY($1))",
			[cleanup.projects],
		);
		await c.query("DELETE FROM runs WHERE project_id = ANY($1)", [cleanup.projects]);
		await c.query("DELETE FROM project_settings WHERE project_id = ANY($1)", [cleanup.projects]);
		await c.query("DELETE FROM token_usage WHERE project_id = ANY($1)", [cleanup.projects]);
		await c.query("DELETE FROM project_plans WHERE project_id = ANY($1)", [cleanup.projects]);
	});
});

// ---------------------------------------------------------------------------
// 1. Budget key parity with budget-guard (maxCostUsd preferred, max_usd accepted, one count per project)
// ---------------------------------------------------------------------------

describe("over-budget counting follows budget-guard key precedence", () => {
	it("maxCostUsd-only project and dual-key projects are counted once each, by maxCostUsd", async () => {
		const tenantBefore = await overBudgetViaRoute(ownerA);
		const sysBefore = await overBudgetViaSysFn();

		const onlyCost = await seedProject(TENANT_A);
		await seedSetting(onlyCost, "budget", "maxCostUsd", "1");
		await seedSpend(onlyCost, 2);

		// both keys: maxCostUsd (1, over) wins over max_usd (100, under) -> counted exactly once
		const bothOver = await seedProject(TENANT_A);
		await seedSetting(bothOver, "budget", "maxCostUsd", "1");
		await seedSetting(bothOver, "budget", "max_usd", "100");
		await seedSpend(bothOver, 2);

		// both keys: maxCostUsd (100, under) wins over max_usd (1, over) -> not counted
		const bothUnder = await seedProject(TENANT_A);
		await seedSetting(bothUnder, "budget", "maxCostUsd", "100");
		await seedSetting(bothUnder, "budget", "max_usd", "1");
		await seedSpend(bothUnder, 2);

		expect((await overBudgetViaRoute(ownerA)) - tenantBefore).toBe(2);
		expect((await overBudgetViaSysFn()) - sysBefore).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 2. /queue-health is tenant-scoped (explicit filter, holds in superuser mode too)
// ---------------------------------------------------------------------------

describe("GET /queue-health", () => {
	async function truthFor(tenantId: string) {
		return withMigrator(async (c) => {
			const n = async (where: string) =>
				Number(
					(
						await c.query(
							`SELECT count(*) AS n FROM tasks t JOIN projects p ON p.id = t.project_id AND p.tenant_id = $1 WHERE ${where}`,
							[tenantId],
						)
					).rows[0].n,
				);
			return {
				queuedCount: await n("t.status = 'queued'"),
				dispatchingCount: await n("t.status = 'running'"),
				failedToday: await n("t.status = 'failed' AND t.completed_at > now() - INTERVAL '24 hours'"),
			};
		});
	}

	async function viaRoute(who: SeededUser) {
		const res = await call(who, "GET", "/queue-health");
		expect(res.status).toBe(200);
		const { health } = (await res.json()) as any;
		return {
			queuedCount: health.queuedCount,
			dispatchingCount: health.dispatchingCount,
			failedToday: health.failedToday,
		};
	}

	beforeAll(async () => {
		await seedTasks(projA, "queued", 2);
		await seedTasks(projA, "running", 1);
		await seedTasks(projA, "failed", 1, new Date().toISOString());
		await seedTasks(projB, "queued", 5);
		await seedTasks(projB, "running", 4);
		await seedTasks(projB, "failed", 3, new Date().toISOString());
	});

	it("tenant A counts equal A's explicit-JOIN truth, none of B's tasks", async () => {
		const a = await viaRoute(ownerA);
		expect(a).toEqual(await truthFor(TENANT_A));
		expect(a.queuedCount).toBeGreaterThanOrEqual(2);
	});

	it("tenant B counts equal B's explicit-JOIN truth", async () => {
		const b = await viaRoute(ownerB);
		expect(b).toEqual(await truthFor(TENANT_B));
		expect(b.queuedCount).toBeGreaterThanOrEqual(5);
		expect(b.dispatchingCount).toBeGreaterThanOrEqual(4);
		expect(b.failedToday).toBeGreaterThanOrEqual(3);
	});

	it("A and B differ (a global count would make them equal)", async () => {
		expect(await viaRoute(ownerA)).not.toEqual(await viaRoute(ownerB));
	});
});

// ---------------------------------------------------------------------------
// 3. Policy surface
// ---------------------------------------------------------------------------

describe("policy routes", () => {
	beforeAll(async () => {
		await seedSetting(projA, "model_routing", "provider_policy_profile", PROFILE_A);
		await seedSetting(projA, "budget", "max_usd", "10");
		await seedSpend(projA, 4);
		await seedSetting(projB, "model_routing", "provider_policy_profile", PROFILE_B);
		const extraB = await seedProject(TENANT_B);
		await seedSetting(extraB, "model_routing", "provider_policy_profile", PROFILE_B);
		await seedSetting(extraB, "budget", "max_usd", "1");
		await seedSpend(extraB, 9);
	});

	it("GET /policy/projects/:id for an own project returns 200 with spend from token_usage", async () => {
		const res = await call(ownerA, "GET", `/policy/projects/${projA}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.projectId).toBe(projA);
		expect(body.activeProfile).toBe(PROFILE_A);
		expect(body.budget.maxBudgetUsd).toBe(10);
		expect(body.budget.spentUsd).toBe(4);
		expect(body.budget.remainingUsd).toBe(6);
	});

	it("GET /policy/projects/:id for another tenant's project is not 200", async () => {
		const res = await call(ownerA, "GET", `/policy/projects/${projB}`);
		expect([403, 404]).toContain(res.status);
	});

	// replay_snapshots.run_id holds either a runs.id or (fallback) the projectId — never a pipeline_runs.id.
	it("GET /policy/projects/:id lists recent decisions stored under a runs.id or the projectId fallback, own project only", async () => {
		const runA = `f3f-run-${U}-a`;
		const runB = `f3f-run-${U}-b`;
		const decision = (action: string) => JSON.stringify([{ action, allowed: true }]);
		await withMigrator(async (c) => {
			for (const [id, project] of [
				[runA, projA],
				[runB, projB],
			]) {
				await c.query(
					"INSERT INTO runs (id, project_id, goal, mode, status, metadata, created_at) VALUES ($1, $2, 'f3f', 'execute', 'completed', '{}', now())",
					[id, project],
				);
			}
			const snap = (runId: string, action: string) =>
				c.query(
					`INSERT INTO replay_snapshots (id, run_id, checkpoint_id, snapshot_json, metadata, policy_decisions_json, created_at)
					 VALUES ($1, $2, 'cp', '{}', '{}', $3, now())`,
					[randomUUID(), runId, decision(action)],
				);
			await snap(runA, "via-run-a");
			await snap(projA, "via-project-a");
			await snap(runB, "via-run-b");
		});
		const res = await call(ownerA, "GET", `/policy/projects/${projA}`);
		expect(res.status).toBe(200);
		const actions = ((await res.json()) as any).recentDecisions.map((d: { action: string }) => d.action).sort();
		expect(actions).toEqual(["via-project-a", "via-run-a"]);
	});

	it("GET /policy/summary returns only the caller's tenant data", async () => {
		const resA = await call(ownerA, "GET", "/policy/summary");
		expect(resA.status).toBe(200);
		const a = (await resA.json()) as any;
		expect(a.activeProfiles[PROFILE_A]).toBe(1);
		expect(a.activeProfiles[PROFILE_B]).toBeUndefined();

		const resB = await call(ownerB, "GET", "/policy/summary");
		expect(resB.status).toBe(200);
		const b = (await resB.json()) as any;
		expect(b.activeProfiles[PROFILE_B]).toBe(2);
		expect(b.activeProfiles[PROFILE_A]).toBeUndefined();
		// Isolation by delta (other tests in this file seed A/B budgets too): a new over-budget project in B moves B only.
		const extraOver = await seedProject(TENANT_B);
		await seedSetting(extraOver, "budget", "maxCostUsd", "1");
		await seedSpend(extraOver, 2);
		const a2 = (await (await call(ownerA, "GET", "/policy/summary")).json()) as any;
		const b2 = (await (await call(ownerB, "GET", "/policy/summary")).json()) as any;
		expect(b2.projectsOverBudget - b.projectsOverBudget).toBe(1);
		expect(a2.projectsOverBudget).toBe(a.projectsOverBudget);

		const truthA = await withMigrator(async (c) =>
			Number(
				(
					await c.query(
						`SELECT count(DISTINCT s.project_id) AS n FROM project_settings s
							 JOIN projects p ON p.id = s.project_id AND p.tenant_id = $1
							 WHERE s.category = 'budget' AND s.key IN ('maxCostUsd','max_usd')`,
						[TENANT_A],
					)
				).rows[0].n,
			),
		);
		expect(a.projectsWithBudget).toBe(truthA);
	});
});

// ---------------------------------------------------------------------------
// 4. Least privilege: oscorpex_sysread must not read project_settings.value (encrypted GitHub tokens live in
//    project_settings category='github' key='token', column `value`)
// ---------------------------------------------------------------------------

describe("oscorpex_sysread privileges on project_settings", () => {
	it("has no table-level SELECT and cannot read the value column", async (ctx) => {
		if (!(await roleExists("oscorpex_sysread"))) return ctx.skip();
		const r = await withMigrator(
			async (c) =>
				(
					await c.query(
						`SELECT has_table_privilege('oscorpex_sysread', 'public.project_settings', 'SELECT') AS tbl,
						        has_column_privilege('oscorpex_sysread', 'public.project_settings', 'value', 'SELECT') AS val`,
					)
				).rows[0],
		);
		expect(r.tbl).toBe(false);
		expect(r.val).toBe(false);
	});

	it("the budget aggregate still works without that grant", async () => {
		const n = await overBudgetViaSysFn();
		expect(Number.isFinite(n)).toBe(true);
	});

	it("project_budget_settings: sysread only, owner-privileged (not security_invoker), not readable by app or PUBLIC", async (ctx) => {
		if (!(await roleExists("oscorpex_app"))) return ctx.skip();
		const r = await withMigrator(
			async (c) =>
				(
					await c.query(
						`SELECT has_table_privilege('oscorpex_sysread', 'public.project_budget_settings', 'SELECT') AS sysread,
						        has_table_privilege('oscorpex_app', 'public.project_budget_settings', 'SELECT') AS app,
						        EXISTS (SELECT 1 FROM information_schema.role_table_grants
						                WHERE table_schema = 'public' AND table_name = 'project_budget_settings' AND grantee = 'PUBLIC') AS public_grant,
						        (SELECT coalesce(array_to_string(reloptions, ','), '') FROM pg_class
						          WHERE oid = 'public.project_budget_settings'::regclass) AS opts`,
					)
				).rows[0],
		);
		expect(r.sysread).toBe(true);
		expect(r.app).toBe(false);
		expect(r.public_grant).toBe(false);
		expect(r.opts).not.toMatch(/security_invoker=(true|on|1)/);
	});
});
