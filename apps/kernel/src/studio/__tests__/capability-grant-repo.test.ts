import { beforeAll, describe, expect, it } from "vitest";
import {
	deleteCapabilityGrant,
	getCapabilityGrants,
	getDefaultGrantsForRole,
	hasCapability,
	upsertCapabilityGrant,
} from "../db.js";
import { execute, query } from "../pg.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM agent_capability_grants LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available or table missing */
}

const PROJECT_ID = "cap-test-project";

describe.skipIf(!dbReady)("Capability Grant Repo", () => {
	beforeAll(async () => {
		await execute("DELETE FROM agent_capability_grants WHERE project_id = $1", [PROJECT_ID]);
		// Ensure project exists for FK
		await execute(
			`INSERT INTO projects (id, name, description, status, created_at, updated_at)
			 VALUES ($1, 'Cap Test', 'test', 'planning', now(), now())
			 ON CONFLICT (id) DO NOTHING`,
			[PROJECT_ID],
		);
	});

	it("should upsert a new capability grant", async () => {
		const grant = await upsertCapabilityGrant({
			projectId: PROJECT_ID,
			agentRole: "backend_dev",
			capability: "can_commit_code",
			granted: true,
		});
		expect(grant.id).toBeDefined();
		expect(grant.projectId).toBe(PROJECT_ID);
		expect(grant.agentRole).toBe("backend-dev");
		expect(grant.capability).toBe("can_commit_code");
		expect(grant.granted).toBe(true);
		expect(grant.grantedBy).toBe("system");
	});

	it("should upsert (update) existing grant on conflict", async () => {
		await upsertCapabilityGrant({
			projectId: PROJECT_ID,
			agentRole: "backend_dev",
			capability: "can_commit_code",
			granted: false,
			grantedBy: "admin",
		});
		const grants = await getCapabilityGrants(PROJECT_ID, "backend_dev");
		const match = grants.find((g) => g.capability === "can_commit_code");
		expect(match).toBeDefined();
		expect(match!.granted).toBe(false);
		expect(match!.grantedBy).toBe("admin");
	});

	it("should list grants filtered by role", async () => {
		await upsertCapabilityGrant({
			projectId: PROJECT_ID,
			agentRole: "pm",
			capability: "can_propose_task",
			granted: true,
		});
		const pmGrants = await getCapabilityGrants(PROJECT_ID, "pm");
		expect(pmGrants.length).toBeGreaterThanOrEqual(1);
		expect(pmGrants.every((g) => g.agentRole === "pm")).toBe(true);
	});

	it("should list all grants for project", async () => {
		const allGrants = await getCapabilityGrants(PROJECT_ID);
		expect(allGrants.length).toBeGreaterThanOrEqual(2);
	});

	it("hasCapability returns explicit grant value", async () => {
		// backend_dev.can_commit_code was set to false above
		const result = await hasCapability(PROJECT_ID, "backend_dev", "can_commit_code");
		expect(result).toBe(false);
	});

	it("hasCapability falls back to role defaults when no explicit grant", async () => {
		// qa_engineer has can_trigger_tests in defaults but no explicit grant
		const result = await hasCapability(PROJECT_ID, "qa_engineer", "can_trigger_tests");
		expect(result).toBe(true);
	});

	it("hasCapability returns false for unknown role", async () => {
		const result = await hasCapability(PROJECT_ID, "unknown_role", "can_commit_code");
		expect(result).toBe(false);
	});

	it("should delete a grant", async () => {
		const deleted = await deleteCapabilityGrant(PROJECT_ID, "pm", "can_propose_task");
		expect(deleted).toBe(true);

		const grants = await getCapabilityGrants(PROJECT_ID, "pm");
		expect(grants.find((g) => g.capability === "can_propose_task")).toBeUndefined();
	});

	it("delete returns false when grant does not exist", async () => {
		const deleted = await deleteCapabilityGrant(PROJECT_ID, "pm", "can_open_deploy_request");
		expect(deleted).toBe(false);
	});

	it("getDefaultGrantsForRole returns correct defaults", () => {
		const pmDefaults = getDefaultGrantsForRole("pm");
		expect(pmDefaults).toContain("can_propose_task");
		expect(pmDefaults).toContain("can_request_replan");
		expect(pmDefaults).not.toContain("can_commit_code");

		const devDefaults = getDefaultGrantsForRole("backend_dev");
		expect(devDefaults).toContain("can_commit_code");
		expect(devDefaults).toContain("can_trigger_tests");
	});

	it("getDefaultGrantsForRole returns empty for unknown role", () => {
		expect(getDefaultGrantsForRole("nonexistent")).toEqual([]);
	});
});
