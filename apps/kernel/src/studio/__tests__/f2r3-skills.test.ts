// ---------------------------------------------------------------------------
// F2 round 3, item 1 — skill auto-detection / suggestions / runtime resolution only use skills visible to the
// caller (global, or tenant_id = caller tenant AND created_by = caller); legacy NULL-tenant skills are admin-only;
// at runtime a non-global skill whose tenant differs from the project's tenant is never applied.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveSkillsForTask } from "../skill-resolver.js";
import { runInTenant, runOutsideScope } from "../tenancy/tenant-scope.js";
import {
	U,
	call,
	cleanup,
	mkUser,
	registerCleanup,
	seedProject,
	seedProjectAgent,
	seedSkill,
	useAuthEnabledEnv,
} from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();
void cleanup;

let ownerA: SeededUser;
let ownerA2: SeededUser;
let ownerB: SeededUser;
let admin: SeededUser;

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	ownerA2 = await mkUser({ tenantId: TENANT_A });
	ownerB = await mkUser({ tenantId: TENANT_B });
	admin = await mkUser({ tenantId: TENANT_A, admin: true });
});

describe("schema: skills have tenant ownership", () => {
	it("skills.tenant_id column exists", async () => {
		const r = await withMigrator((c) =>
			c.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'skills' AND column_name = 'tenant_id'"),
		);
		expect(r.rowCount).toBe(1);
	});
});

describe("auto-detect / suggestions only consider visible skills", () => {
	const trig = `f2r3trig${U}`;
	let projectId: string;
	let agentId: string;
	const ids: Record<string, string> = {};

	beforeAll(async () => {
		projectId = await seedProject(TENANT_A, { description: `uses ${trig} heavily`, techStack: [trig] });
		agentId = await seedProjectAgent(projectId, "backend-dev");
		ids.global = await seedSkill({ tenantId: null, createdBy: null, isGlobal: true, triggers: [trig] });
		ids.ownA = await seedSkill({ tenantId: TENANT_A, createdBy: ownerA.id, triggers: [trig] });
		ids.sameTenantOtherUser = await seedSkill({ tenantId: TENANT_A, createdBy: ownerA2.id, triggers: [trig] });
		ids.otherTenant = await seedSkill({ tenantId: TENANT_B, createdBy: ownerB.id, triggers: [trig] });
		ids.legacyNull = await seedSkill({ tenantId: null, createdBy: ownerA.id, triggers: [trig] });
	});

	const suggestionSkillIds = async (who: SeededUser): Promise<string[]> => {
		const res = await call(who, "GET", `/projects/${projectId}/skills/suggestions`);
		expect(res.status).toBe(200);
		return ((await res.json()) as Array<{ skillId: string }>).map((s) => s.skillId);
	};

	it("GET suggestions for a tenant user: global + own skills only", async () => {
		const got = await suggestionSkillIds(ownerA);
		expect(got).toContain(ids.global);
		expect(got).toContain(ids.ownA);
		expect(got).not.toContain(ids.sameTenantOtherUser);
		expect(got).not.toContain(ids.otherTenant);
	});

	it("legacy NULL-tenant skills are not suggested to a tenant user, even to their created_by", async () => {
		expect(await suggestionSkillIds(ownerA)).not.toContain(ids.legacyNull);
	});

	it("platform admin sees the legacy NULL-tenant skill in suggestions", async () => {
		expect(await suggestionSkillIds(admin)).toContain(ids.legacyNull);
	});

	it("POST auto-detect response suggestions are limited to visible skills", async () => {
		const res = await call(ownerA, "POST", `/projects/${projectId}/skills/auto-detect`, { minConfidence: 0.1 });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { suggestions: Array<{ skillId: string }> };
		const got = body.suggestions.map((s) => s.skillId);
		expect(got).toContain(ids.global);
		expect(got).toContain(ids.ownA);
		for (const hidden of [ids.sameTenantOtherUser, ids.otherTenant, ids.legacyNull]) expect(got).not.toContain(hidden);
	});

	it("POST auto-detect never assigns an invisible skill to the project's agents", async () => {
		await call(ownerA, "POST", `/projects/${projectId}/skills/auto-detect`, { minConfidence: 0.1 });
		const rows = await withMigrator((c) => c.query("SELECT skill_id FROM agent_skills WHERE agent_id = $1", [agentId]));
		const assigned = rows.rows.map((r: { skill_id: string }) => r.skill_id);
		for (const hidden of [ids.sameTenantOtherUser, ids.otherTenant, ids.legacyNull])
			expect(assigned).not.toContain(hidden);
		expect(assigned).toContain(ids.ownA);
	});
});

describe("runtime resolution: non-global skills of another tenant are never applied", () => {
	const task = (title: string) => ({ id: "t", title, description: "" }) as never;
	const resolveIn = (tenant: string, t: never, agentId: string, projectId: string) =>
		runOutsideScope(() => runInTenant(tenant, () => resolveSkillsForTask(t, agentId, "backend-dev", projectId)));
	const idsOf = (r: { skills?: Array<{ skill: { id: string } }> }) => (r.skills ?? []).map((m) => m.skill.id);

	it("a cross-tenant agent_skills assignment row is ignored", async () => {
		const projectId = await seedProject(TENANT_A);
		const agentId = await seedProjectAgent(projectId);
		const foreign = await seedSkill({ tenantId: TENANT_B, createdBy: ownerB.id });
		const own = await seedSkill({ tenantId: TENANT_A, createdBy: ownerA.id });
		await withMigrator(async (c) => {
			for (const sid of [foreign, own]) {
				await c.query("INSERT INTO agent_skills (id, agent_id, skill_id, priority) VALUES ($1, $2, $3, 0)", [
					randomUUID(),
					agentId,
					sid,
				]);
			}
		});
		const got = idsOf(await resolveIn(TENANT_A, task("anything"), agentId, projectId));
		expect(got).not.toContain(foreign);
		expect(got).toContain(own); // positive control: same-tenant assignment still applies
	});

	it("a cross-tenant project_skills assignment row is ignored", async () => {
		const projectId = await seedProject(TENANT_A);
		const agentId = await seedProjectAgent(projectId);
		const foreign = await seedSkill({ tenantId: TENANT_B, createdBy: ownerB.id });
		const own = await seedSkill({ tenantId: TENANT_A, createdBy: ownerA.id });
		await withMigrator(async (c) => {
			for (const sid of [foreign, own]) {
				await c.query("INSERT INTO project_skills (id, project_id, skill_id) VALUES ($1, $2, $3)", [
					randomUUID(),
					projectId,
					sid,
				]);
			}
		});
		const got = idsOf(await resolveIn(TENANT_A, task("anything"), agentId, projectId));
		expect(got).not.toContain(foreign);
		expect(got).toContain(own);
	});

	it("global skills still apply to every tenant's project", async () => {
		const trig = `f2r3rt${U}`;
		const projectId = await seedProject(TENANT_B);
		const agentId = await seedProjectAgent(projectId);
		const g = await seedSkill({ tenantId: null, createdBy: null, isGlobal: true, triggers: [trig] });
		const got = idsOf(await resolveIn(TENANT_B, task(`do ${trig}`), agentId, projectId));
		expect(got).toContain(g);
	});
});
