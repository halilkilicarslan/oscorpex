// ---------------------------------------------------------------------------
// F2 round 3 (final items), D — agent config ownership is (tenant_id, created_by):
//  * PUT/DELETE /agents/:id need tenant_id = caller tenant AND created_by = caller (same user id, other tenant → 404)
//  * POST /projects/:id/agents/:agentId/start → 404 unless the project is visible in the caller's tenant and the
//    agent is in that project. The container runtime was removed in I0, so an agent without a CLI tool answers 409.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
	call,
	cleanup,
	mkUser,
	registerCleanup,
	seedAgentConfig,
	seedProject,
	useAuthEnabledEnv,
} from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A, TENANT_B, withMigrator } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

let ownerA: SeededUser;
let ownerB: SeededUser;

beforeAll(async () => {
	ownerA = await mkUser({ tenantId: TENANT_A });
	ownerB = await mkUser({ tenantId: TENANT_B });
});

const configRow = async (id: string) =>
	(await withMigrator((c) => c.query("SELECT name FROM agent_configs WHERE id = $1", [id]))).rows[0] as
		| { name: string }
		| undefined;

describe("PUT /agents/:id", () => {
	it("own config (tenant + creator match) → 200 (control)", async () => {
		const id = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerA.id });
		const res = await call(ownerA, "PUT", `/agents/${id}`, { name: "renamed-own" });
		expect(res.status).toBe(200);
	});

	it("same creator id but the config belongs to another tenant → 404 and nothing changes", async () => {
		const id = await seedAgentConfig({ tenantId: TENANT_B, createdBy: ownerA.id, name: "untouched-put" });
		const res = await call(ownerA, "PUT", `/agents/${id}`, { name: "hijacked" });
		expect(res.status).toBe(404);
		expect((await configRow(id))?.name).toBe("untouched-put");
	});

	it("same tenant, different creator → 404", async () => {
		const id = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerB.id, name: "untouched-put2" });
		expect((await call(ownerA, "PUT", `/agents/${id}`, { name: "hijacked" })).status).toBe(404);
		expect((await configRow(id))?.name).toBe("untouched-put2");
	});
});

describe("DELETE /agents/:id", () => {
	it("own config → 200 and the row is gone (control)", async () => {
		const id = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerA.id });
		expect((await call(ownerA, "DELETE", `/agents/${id}`)).status).toBe(200);
		expect(await configRow(id)).toBeUndefined();
	});

	it("same creator id but another tenant's config → 404 and the row survives", async () => {
		const id = await seedAgentConfig({ tenantId: TENANT_B, createdBy: ownerA.id });
		expect((await call(ownerA, "DELETE", `/agents/${id}`)).status).toBe(404);
		expect(await configRow(id)).toBeDefined();
	});

	it("same tenant, different creator → 404 and the row survives", async () => {
		const id = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerB.id });
		expect((await call(ownerA, "DELETE", `/agents/${id}`)).status).toBe(404);
		expect(await configRow(id)).toBeDefined();
	});
});

describe("POST /projects/:id/agents/:agentId/start", () => {
	async function seedAgentRow(projectId: string, id: string, cliTool = "none"): Promise<void> {
		cleanup.projectAgents.push(id);
		await withMigrator((c) =>
			c.query(
				"INSERT INTO project_agents (id, project_id, name, role, cli_tool, created_at) VALUES ($1, $2, 'a', 'coder', $3, now())",
				[id, projectId, cliTool],
			),
		);
	}

	it("project of another tenant → 404", async () => {
		const projectB = await seedProject(TENANT_B);
		const agentId = `f2ae-pa-${randomUUID()}`;
		await seedAgentRow(projectB, agentId);
		const res = await call(ownerA, "POST", `/projects/${projectB}/agents/${agentId}/start`, {});
		expect(res.status).toBe(404);
	});

	it("own project but the agent row belongs to another project → 404", async () => {
		const projectA = await seedProject(TENANT_A);
		const projectB = await seedProject(TENANT_B);
		const agentId = `f2ae-pa-${randomUUID()}`;
		await seedAgentRow(projectB, agentId);
		const res = await call(ownerA, "POST", `/projects/${projectA}/agents/${agentId}/start`, {});
		expect(res.status).toBe(404);
	});

	it("agent without a CLI tool never starts a process or container (no container fallback any more)", async () => {
		const projectA = await seedProject(TENANT_A);
		const configId = await seedAgentConfig({ tenantId: TENANT_A, createdBy: ownerA.id });
		await seedAgentRow(projectA, configId);
		const res = await call(ownerA, "POST", `/projects/${projectA}/agents/${configId}/start`, {});
		expect(res.status).toBe(409);
	});
});
