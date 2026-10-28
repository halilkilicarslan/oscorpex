// ---------------------------------------------------------------------------
// F2 round 3, item 4 — agent_configs visibility: GET /agents and /agents/:id return presets + configs with
// tenant_id = caller tenant AND created_by = caller (platform admin sees all); invisible → 404 and the
// system prompt never appears; POST /projects/:id/team with sourceAgentId copies only from visible configs.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import {
	U,
	call,
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

const SECRET = `TOP-SECRET-PROMPT-${U}`;
let ownerA: SeededUser;
let ownerA2: SeededUser;
let ownerB: SeededUser;
let admin: SeededUser;
const ids: Record<string, string> = {};

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	ownerA2 = await mkUser({ tenantId: TENANT_A });
	ownerB = await mkUser({ tenantId: TENANT_B });
	admin = await mkUser({ tenantId: TENANT_A, admin: true });
	ids.preset = await seedAgentConfig({ tenantId: null, createdBy: null, preset: true, role: `f2r3-preset-${U}` });
	ids.ownA = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerA.id, systemPrompt: `own ${SECRET}` });
	ids.sameTenantOther = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerA2.id, systemPrompt: SECRET });
	ids.otherTenant = await seedAgentConfig({ tenantId: TENANT_B, createdBy: ownerB.id, systemPrompt: SECRET });
});

const listIds = async (who: SeededUser): Promise<string[]> => {
	const res = await call(who, "GET", "/agents");
	expect(res.status).toBe(200);
	return ((await res.json()) as Array<{ id: string }>).map((a) => a.id);
};

describe("GET /agents", () => {
	it("tenant user: presets + own configs only", async () => {
		const got = await listIds(ownerA);
		expect(got).toContain(ids.preset);
		expect(got).toContain(ids.ownA);
		expect(got).not.toContain(ids.sameTenantOther);
		expect(got).not.toContain(ids.otherTenant);
	});

	it("the response body never contains another user's system prompt", async () => {
		const res = await call(ownerA, "GET", "/agents");
		const text = await res.text();
		expect(text).not.toContain(`"systemPrompt":"${SECRET}"`);
		expect(text.split(SECRET).length - 1).toBe(1); // only the caller's own "own <SECRET>"
	});

	it("the other tenant's user sees neither of tenant A's configs", async () => {
		const got = await listIds(ownerB);
		expect(got).toContain(ids.otherTenant);
		expect(got).not.toContain(ids.ownA);
		expect(got).not.toContain(ids.sameTenantOther);
	});

	it("platform admin sees all", async () => {
		const got = await listIds(admin);
		for (const id of Object.values(ids)) expect(got).toContain(id);
	});
});

describe("GET /agents/:id", () => {
	it("preset and own config → 200", async () => {
		expect((await call(ownerA, "GET", `/agents/${ids.preset}`)).status).toBe(200);
		expect((await call(ownerA, "GET", `/agents/${ids.ownA}`)).status).toBe(200);
	});

	it("another tenant's config → 404 and the system prompt is not in the body", async () => {
		const res = await call(ownerA, "GET", `/agents/${ids.otherTenant}`);
		expect(res.status).toBe(404);
		expect(await res.text()).not.toContain(SECRET);
	});

	it("same tenant, different creator → 404", async () => {
		const res = await call(ownerA, "GET", `/agents/${ids.sameTenantOther}`);
		expect(res.status).toBe(404);
		expect(await res.text()).not.toContain(SECRET);
	});

	it("platform admin can read any config", async () => {
		for (const id of Object.values(ids)) expect((await call(admin, "GET", `/agents/${id}`)).status).toBe(200);
	});
});

describe("POST /projects/:id/team with sourceAgentId", () => {
	let projectA: string;
	beforeAll(async () => {
		projectA = await seedProject(TENANT_A);
	});

	it("invisible configs (other tenant, other user) → 404, nothing is copied", async () => {
		for (const id of [ids.otherTenant, ids.sameTenantOther]) {
			const res = await call(ownerA, "POST", `/projects/${projectA}/team`, { sourceAgentId: id });
			expect(res.status).toBe(404);
			expect(await res.text()).not.toContain(SECRET);
		}
		const team = await call(ownerA, "GET", `/projects/${projectA}/team`);
		expect(await team.text()).not.toContain(SECRET);
	});

	it("a preset and one's own config can be copied (control)", async () => {
		for (const id of [ids.preset, ids.ownA]) {
			const res = await call(ownerA, "POST", `/projects/${projectA}/team`, { sourceAgentId: id });
			expect(res.status).toBe(201);
			const body = (await res.json()) as { id: string };
			cleanup.projectAgents.push(body.id);
		}
	});
});
