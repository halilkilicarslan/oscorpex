// ---------------------------------------------------------------------------
// F2 round 3 (final items), B — custom team templates are tenant-scoped on
//  * POST /projects/:id/team/recommend (the recommendation only considers the project's tenant's custom teams)
//  * POST /projects/:id/team/apply (another tenant's custom team id → 404, no agents created)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { call, cleanup, mkUser, registerCleanup, seedProject, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

const U = randomUUID().slice(0, 8);
const roleA = `f2ae-rolea-${U}`;
const roleB1 = `f2ae-roleb1-${U}`;
const roleB2 = `f2ae-roleb2-${U}`;
const roleB3 = `f2ae-roleb3-${U}`;
// A's team overlaps 1 scope role; B's team overlaps all 3 → B's would win if it leaked into A's candidates.
const teamA = { id: `f2ae-team-a-${U}`, name: `AlphaTeam-${U}`, roles: [roleB1] };
const teamB = { id: `f2ae-team-b-${U}`, name: `BetaTeam-${U}`, roles: [roleB1, roleB2, roleB3] };

let ownerA: SeededUser;
let projectA: string;

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	await mkUser({ tenantId: TENANT_B });
	projectA = await seedProject(TENANT_A);
	await withMigrator(async (c) => {
		await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [TENANT_B]);
		for (const [t, tenant] of [
			[teamA, TENANT_A],
			[teamB, TENANT_B],
		] as const) {
			cleanup.teams.push(t.id);
			await c.query(
				`INSERT INTO custom_team_templates (id, name, description, roles, dependencies, created_at, tenant_id)
				 VALUES ($1, $2, 'desc', $3, '[]', $4, $5)`,
				[t.id, t.name, JSON.stringify(t.roles), new Date().toISOString(), tenant],
			);
		}
		const settings: Record<string, string> = {
			status: "approved",
			problemStatement: "p",
			recommendedTeamRoles: JSON.stringify([roleB1, roleB2, roleB3]),
			requiredCapabilities: "[]",
		};
		for (const [key, value] of Object.entries(settings)) {
			await c.query(
				`INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
				 VALUES ($1, $2, 'scope', $3, $4, now())`,
				[`${projectA}:scope:${key}`, projectA, key, value],
			);
		}
	});
});

describe("POST /projects/:id/team/recommend", () => {
	it("never recommends (or leaks the name of) another tenant's custom team", async () => {
		const res = await call(ownerA, "POST", `/projects/${projectA}/team/recommend`, {});
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain(teamB.id);
		expect(text).not.toContain(teamB.name);
		// the best candidate visible to tenant A is its own custom team
		const body = JSON.parse(text) as { data: { teamTemplateId?: string } };
		expect(body.data.teamTemplateId).toBe(teamA.id);
	});
});

describe("POST /projects/:id/team/apply with a custom team template id", () => {
	it("another tenant's custom team → 404 and no agents are created", async () => {
		const res = await call(ownerA, "POST", `/projects/${projectA}/team/apply`, { teamTemplateId: teamB.id });
		expect(res.status).toBe(404);
		const agents = await withMigrator((c) =>
			c.query("SELECT count(*)::int AS n FROM project_agents WHERE project_id = $1", [projectA]),
		);
		expect(agents.rows[0].n).toBe(0);
	});

	it("the caller tenant's own custom team is accepted (control: not a 404)", async () => {
		const res = await call(ownerA, "POST", `/projects/${projectA}/team/apply`, { teamTemplateId: teamA.id });
		expect(res.status).not.toBe(404);
	});
});
