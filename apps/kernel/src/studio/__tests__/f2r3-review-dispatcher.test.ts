// ---------------------------------------------------------------------------
// F2 round 3, item 3 — review-dispatcher resolveAgent(): the agent_configs fallback only considers presets and
// configs whose tenant_id equals the project's tenant (by role, by id and by name).
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import { resolveAgent } from "../review-dispatcher.js";
import { runInTenant, runOutsideScope } from "../tenancy/tenant-scope.js";
import {
	U,
	cleanup,
	mkUser,
	registerCleanup,
	seedAgentConfig,
	seedProject,
	useAuthEnabledEnv,
} from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();
void cleanup;

const ROLE = `f2r3-reviewer-${U}`;
let ownerA: SeededUser;
let projectA: string;
let projectB: string;
let configA: string;
let presetId: string;
const NAME_A = `F2R3 Custom Reviewer ${U}`;

const resolveIn = (tenant: string, projectId: string, assignment: string) =>
	runOutsideScope(() => runInTenant(tenant, () => resolveAgent(projectId, assignment)));

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	projectA = await seedProject(TENANT_A);
	projectB = await seedProject(TENANT_B);
	configA = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerA.id, role: ROLE, name: NAME_A });
});

describe("resolveAgent fallback is tenant-aware", () => {
	it("tenant A's custom config with the reviewer role is picked for tenant A's project (control)", async () => {
		const agent = await resolveIn(TENANT_A, projectA, ROLE);
		expect(agent?.id).toBe(configA);
	});

	it("tenant B's review does NOT pick tenant A's custom config by role", async () => {
		const agent = await resolveIn(TENANT_B, projectB, ROLE);
		expect(agent?.id).not.toBe(configA);
		expect(agent).toBeUndefined();
	});

	it("…nor by id", async () => {
		expect(await resolveIn(TENANT_B, projectB, configA)).toBeUndefined();
	});

	it("…nor by name", async () => {
		expect(await resolveIn(TENANT_B, projectB, NAME_A)).toBeUndefined();
	});

	it("a preset (tenant-less, is_preset) config is still picked for any tenant's project", async () => {
		const presetRole = `f2r3-preset-reviewer-${U}`;
		presetId = await seedAgentConfig({ tenantId: null, createdBy: null, role: presetRole, preset: true });
		expect((await resolveIn(TENANT_B, projectB, presetRole))?.id).toBe(presetId);
		expect((await resolveIn(TENANT_A, projectA, presetRole))?.id).toBe(presetId);
	});
});
