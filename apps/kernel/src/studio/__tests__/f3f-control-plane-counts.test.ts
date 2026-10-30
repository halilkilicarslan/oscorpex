// ---------------------------------------------------------------------------
// F3-f — control-plane counts: tenant-scoped for tenant users (explicit JOIN projects, both DB modes),
// platform-wide only through sys_control_plane_summary() behind platform:admin.
//
// Assumed APIs:
//   - GET /summary (existing) -> { summary, approvals, runtime }; tenant-scoped counts
//   - GET /platform/control-plane-summary (new, platform:admin) -> { summary: { pendingApprovals,
//     activeAgents, openIncidents, projectsOverBudget } } computed from sys_control_plane_summary()
//   - sys_control_plane_summary() -> jsonb of numeric aggregates:
//     { pending_approvals, expired_approvals, escalated_approvals, active_agents, open_incidents,
//       projects_over_budget }
//
// Note: the "usage_telemetry" table the current service queries does not exist in the schema; spend is
// seeded in token_usage (the real cost table) and the implementation is expected to read it.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect } from "vitest";
import {
	U,
	call,
	cleanup,
	mkUser,
	registerCleanup,
	seedDbKey,
	seedProject,
	useAuthEnabledEnv,
} from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { it } from "./helpers/outside-scope.js";
import { TENANT_A, TENANT_B, roleExists, withAppRole, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

const KIND = `f3f-${U}`;
const PLATFORM_ROUTE = "/platform/control-plane-summary";
const SEEDED = { approvals: [] as string[], instances: [] as string[], incidents: [] as string[] };

let ownerA: SeededUser;
let ownerB: SeededUser;
let admin: SeededUser;
let projA1: string;
let projA2: string;
let projB1: string;
let projB2: string;

interface Counts {
	pending: number;
	expired: number;
	escalated: number;
	agents: number;
	incidents: number;
	overBudget: number;
}

async function seedApproval(projectId: string | null, status: string): Promise<void> {
	const id = `f3f-ap-${randomUUID()}`;
	SEEDED.approvals.push(id);
	await withMigrator((c) =>
		c.query("INSERT INTO approvals (id, project_id, kind, status, title) VALUES ($1, $2, $3, $4, 'f3f')", [
			id,
			projectId,
			KIND,
			status,
		]),
	);
}

async function seedAgent(projectId: string, status: string): Promise<void> {
	const id = `f3f-ai-${randomUUID()}`;
	SEEDED.instances.push(id);
	await withMigrator((c) =>
		c.query("INSERT INTO agent_instances (id, name, role, status, project_id) VALUES ($1, 'f3f', 'dev', $2, $3)", [
			id,
			status,
			projectId,
		]),
	);
}

async function seedIncident(projectId: string, status: string): Promise<void> {
	const id = `f3f-inc-${randomUUID()}`;
	SEEDED.incidents.push(id);
	await withMigrator((c) =>
		c.query("INSERT INTO incidents (id, project_id, type, status, title) VALUES ($1, $2, 'f3f', $3, 'f3f')", [
			id,
			projectId,
			status,
		]),
	);
}

async function seedBudget(projectId: string, maxUsd: number, spentUsd: number): Promise<void> {
	await withMigrator(async (c) => {
		await c.query(
			"INSERT INTO project_settings (id, project_id, category, key, value, updated_at) VALUES ($1, $2, 'budget', 'max_usd', $3, now())",
			[`f3f-ps-${randomUUID()}`, projectId, String(maxUsd)],
		);
		await c.query(
			"INSERT INTO token_usage (id, project_id, task_id, agent_id, model, cost_usd, created_at) VALUES ($1, $2, 'f3f-task', 'agent', 'model', $3, now())",
			[`f3f-tu-${randomUUID()}`, projectId, spentUsd],
		);
	});
}

/** Counts as the route reports them for `who`. */
async function viaRoute(who: SeededUser): Promise<Counts> {
	const res = await call(who, "GET", "/summary");
	expect(res.status).toBe(200);
	const body = (await res.json()) as any;
	return {
		pending: body.approvals.pendingCount,
		expired: body.approvals.expiredCount,
		escalated: body.approvals.escalatedCount,
		agents: body.summary.activeAgents,
		incidents: body.summary.openIncidents,
		overBudget: body.summary.projectsOverBudget,
	};
}

/** Ground truth for a tenant, computed by the migrator with an explicit JOIN (NULL project_id excluded). */
async function expectedFor(tenantId: string): Promise<Counts> {
	return withMigrator(async (c) => {
		const n = async (sql: string) => Number((await c.query(sql, [tenantId])).rows[0].n);
		const ap = (status: string) =>
			n(
				`SELECT count(*) AS n FROM approvals a JOIN projects p ON p.id = a.project_id AND p.tenant_id = $1 WHERE a.status = '${status}'`,
			);
		return {
			pending: await ap("pending"),
			expired: await ap("expired"),
			escalated: await ap("escalated"),
			agents: await n(
				"SELECT count(*) AS n FROM agent_instances x JOIN projects p ON p.id = x.project_id AND p.tenant_id = $1 WHERE x.status = 'active'",
			),
			incidents: await n(
				"SELECT count(*) AS n FROM incidents x JOIN projects p ON p.id = x.project_id AND p.tenant_id = $1 WHERE x.status IN ('open','acknowledged')",
			),
			overBudget: await n(
				// Same precedence as budget-guard: one budget per project, maxCostUsd preferred over max_usd.
				`WITH b AS (
				   SELECT DISTINCT ON (s.project_id) s.project_id,
				          CASE WHEN s.value ~ '^[0-9]+(\\.[0-9]+)?$' THEN s.value::numeric ELSE 0 END AS budget
				   FROM project_settings s
				   JOIN projects p ON p.id = s.project_id AND p.tenant_id = $1
				   WHERE s.category = 'budget' AND s.key IN ('maxCostUsd', 'max_usd')
				   ORDER BY s.project_id, CASE s.key WHEN 'maxCostUsd' THEN 0 ELSE 1 END
				 )
				 SELECT count(*) AS n FROM b
				 WHERE b.budget > 0
				   AND (SELECT coalesce(sum(cost_usd), 0) FROM token_usage t WHERE t.project_id = b.project_id) >= b.budget`,
			),
		};
	});
}

let baselineA: Counts;

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	ownerB = await mkUser({ tenantId: TENANT_B });
	admin = await mkUser({ tenantId: TENANT_A, admin: true });
	projA1 = await seedProject(TENANT_A);
	projA2 = await seedProject(TENANT_A);
	projB1 = await seedProject(TENANT_B);
	projB2 = await seedProject(TENANT_B);

	baselineA = await viaRoute(ownerA);

	// Tenant A: pending 2, expired 1, escalated 1; active agents 2; open incidents 2; over budget 1
	await seedApproval(projA1, "pending");
	await seedApproval(projA1, "pending");
	await seedApproval(projA1, "expired");
	await seedApproval(projA2, "escalated");
	await seedAgent(projA1, "active");
	await seedAgent(projA2, "active");
	await seedAgent(projA2, "idle");
	await seedIncident(projA1, "open");
	await seedIncident(projA2, "acknowledged");
	await seedIncident(projA2, "resolved");
	await seedBudget(projA1, 1, 2);
	await seedBudget(projA2, 100, 1);

	// Tenant B: deliberately larger and distinct numbers so any leak is visible
	for (let i = 0; i < 5; i++) await seedApproval(projB1, "pending");
	for (let i = 0; i < 2; i++) await seedApproval(projB2, "expired");
	for (let i = 0; i < 3; i++) await seedApproval(projB2, "escalated");
	for (let i = 0; i < 4; i++) await seedAgent(projB1, "active");
	for (let i = 0; i < 3; i++) await seedIncident(projB2, "open");
	await seedBudget(projB1, 1, 5);
	await seedBudget(projB2, 2, 3);

	// Orphan rows: no project, must never be counted for a tenant user
	await seedApproval(null, "pending");
});

afterAll(async () => {
	await withMigrator(async (c) => {
		await c.query("DELETE FROM approvals WHERE id = ANY($1)", [SEEDED.approvals]);
		await c.query("DELETE FROM agent_instances WHERE id = ANY($1)", [SEEDED.instances]);
		await c.query("DELETE FROM incidents WHERE id = ANY($1)", [SEEDED.incidents]);
		await c.query("DELETE FROM project_settings WHERE project_id = ANY($1)", [cleanup.projects]);
		await c.query("DELETE FROM token_usage WHERE project_id = ANY($1)", [cleanup.projects]);
	});
});

// ---------------------------------------------------------------------------
// 1. Tenant users only see their own tenant's numbers
// ---------------------------------------------------------------------------

describe("tenant user counts (explicit JOIN projects, both modes)", () => {
	it("tenant A: delta over baseline is exactly A's seeded numbers", async () => {
		const now = await viaRoute(ownerA);
		expect(now.pending - baselineA.pending).toBe(2);
		expect(now.expired - baselineA.expired).toBe(1);
		expect(now.escalated - baselineA.escalated).toBe(1);
		expect(now.agents - baselineA.agents).toBe(2);
		expect(now.incidents - baselineA.incidents).toBe(2);
		expect(now.overBudget - baselineA.overBudget).toBe(1);
	});

	it("tenant A: totals equal the explicit-JOIN ground truth (no tenant B rows, no NULL project_id rows)", async () => {
		expect(await viaRoute(ownerA)).toEqual(await expectedFor(TENANT_A));
	});

	it("tenant B sees its own numbers, not A's", async () => {
		const b = await viaRoute(ownerB);
		expect(b).toEqual(await expectedFor(TENANT_B));
		expect(b.pending).toBeGreaterThanOrEqual(5);
		expect(b.overBudget).toBeGreaterThanOrEqual(2);
	});

	it("byKind only contains the caller's tenant rows", async () => {
		const res = await call(ownerA, "GET", "/summary");
		const body = (await res.json()) as any;
		// A has exactly 2 pending of KIND; B's 5 and the orphan row must not leak in
		expect(body.approvals.byKind[KIND]).toBe(2);
	});

	it("provider runtime and queue flags stay global (provider counts unaffected by tenant)", async () => {
		const a = (await (await call(ownerA, "GET", "/summary")).json()) as any;
		const b = (await (await call(ownerB, "GET", "/summary")).json()) as any;
		expect(a.summary.cooldownProviders).toBe(b.summary.cooldownProviders);
		expect(a.runtime.onlineCount).toBe(b.runtime.onlineCount);
	});
});

// ---------------------------------------------------------------------------
// 2. Platform route
// ---------------------------------------------------------------------------

describe(`GET ${PLATFORM_ROUTE}`, () => {
	it("platform admin gets platform-wide totals (both tenants, orphans included)", async () => {
		const res = await call(admin, "GET", PLATFORM_ROUTE);
		expect(res.status).toBe(200);
		const { summary } = (await res.json()) as any;
		const truth = await withMigrator(async (c) => {
			const n = async (sql: string) => Number((await c.query(sql)).rows[0].n);
			return {
				pending: await n("SELECT count(*) AS n FROM approvals WHERE status = 'pending'"),
				agents: await n("SELECT count(*) AS n FROM agent_instances WHERE status = 'active'"),
				incidents: await n("SELECT count(*) AS n FROM incidents WHERE status IN ('open','acknowledged')"),
			};
		});
		expect(summary.pendingApprovals).toBe(truth.pending);
		expect(summary.activeAgents).toBe(truth.agents);
		expect(summary.openIncidents).toBe(truth.incidents);
		// must span both tenants: A (2) + B (5) + orphan (1) pending at the very least
		expect(summary.pendingApprovals).toBeGreaterThanOrEqual(8);
		expect(summary.projectsOverBudget).toBeGreaterThanOrEqual(3);
	});

	it("also returns expiredApprovals and escalatedApprovals matching the platform-wide truth", async () => {
		const res = await call(admin, "GET", PLATFORM_ROUTE);
		expect(res.status).toBe(200);
		const { summary } = (await res.json()) as any;
		const truth = await withMigrator(async (c) => {
			const n = async (status: string) =>
				Number((await c.query("SELECT count(*) AS n FROM approvals WHERE status = $1", [status])).rows[0].n);
			return { expired: await n("expired"), escalated: await n("escalated") };
		});
		expect(summary.expiredApprovals).toBe(truth.expired);
		expect(summary.escalatedApprovals).toBe(truth.escalated);
		expect(summary.expiredApprovals).toBeGreaterThanOrEqual(3);
		expect(summary.escalatedApprovals).toBeGreaterThanOrEqual(4);
	});

	it("non-admin tenant user gets 403", async () => {
		expect((await call(ownerA, "GET", PLATFORM_ROUTE)).status).toBe(403);
	});

	it("API key without platform:admin gets 403", async () => {
		const key = await seedDbKey(ownerA, ["control-plane:read"]);
		expect((await call({ token: key }, "GET", PLATFORM_ROUTE)).status).toBe(403);
	});

	it("API key of a platform admin without the platform:admin scope gets 403", async () => {
		const key = await seedDbKey(admin, ["control-plane:read"]);
		expect((await call({ token: key }, "GET", PLATFORM_ROUTE)).status).toBe(403);
	});

	it('API key with scope "*" but without platform:admin gets 403', async () => {
		const key = await seedDbKey(admin, ["*"]);
		expect((await call({ token: key }, "GET", PLATFORM_ROUTE)).status).toBe(403);
	});

	it("admin API key carrying platform:admin gets 200", async () => {
		const key = await seedDbKey(admin, ["platform:admin"]);
		expect((await call({ token: key }, "GET", PLATFORM_ROUTE)).status).toBe(200);
	});

	it("unauthenticated request is rejected", async () => {
		const { studioRoutes } = await import("../index.js");
		expect((await studioRoutes.request(PLATFORM_ROUTE)).status).toBe(401);
	});
});

// ---------------------------------------------------------------------------
// 3. sys_control_plane_summary() catalog + payload shape
// ---------------------------------------------------------------------------

describe("sys_control_plane_summary()", () => {
	it("is owned by oscorpex_sysread, SECURITY DEFINER, pinned search_path, no PUBLIC EXECUTE, app can EXECUTE", async () => {
		const rows = await withMigrator(
			async (c) =>
				(
					await c.query(
						`SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
						        has_function_privilege('oscorpex_app', p.oid, 'EXECUTE') AS app_exec,
						        coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE'), false) AS public_exec
						 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
						 WHERE n.nspname = 'public' AND p.proname = 'sys_control_plane_summary'`,
					)
				).rows,
		);
		expect(rows).toHaveLength(1);
		const r = rows[0];
		expect(r.owner).toBe("oscorpex_sysread");
		expect(r.prosecdef).toBe(true);
		expect(r.proconfig).toContain("search_path=pg_catalog, pg_temp");
		expect(r.public_exec).toBe(false);
		expect(r.app_exec).toBe(true);
	});

	it("returns numeric aggregates only: no ids, no tenant or project identifiers", async () => {
		const result = await withMigrator(
			async (c) => (await c.query("SELECT sys_control_plane_summary() AS s")).rows[0].s as Record<string, unknown>,
		);
		expect(Object.keys(result).length).toBeGreaterThan(0);
		for (const [k, v] of Object.entries(result)) {
			expect(typeof v, `value of ${k}`).toBe("number");
			expect(k).not.toMatch(/(^|_)(id|ids|tenant|tenants|tenant_id|project_id)($|_)/);
		}
		const text = JSON.stringify(result);
		for (const id of [TENANT_A, TENANT_B, projA1, projA2, projB1, projB2]) expect(text).not.toContain(id);
		for (const k of ["pending_approvals", "active_agents", "open_incidents", "projects_over_budget"]) {
			expect(result).toHaveProperty(k);
		}
	});

	it("is callable by oscorpex_app and equals the platform-wide count", async (ctx) => {
		if (!(await roleExists("oscorpex_app"))) return ctx.skip();
		const s = await withAppRole(
			TENANT_A,
			async (c) => (await c.query("SELECT sys_control_plane_summary() AS s")).rows[0].s,
		);
		const truth = await withMigrator(async (c) =>
			Number((await c.query("SELECT count(*) AS n FROM approvals WHERE status = 'pending'")).rows[0].n),
		);
		expect(s.pending_approvals).toBe(truth);
	});
});
