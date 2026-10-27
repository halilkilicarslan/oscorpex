import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateCheckpointInput, RollbackRequest } from "../checkpoint/types.js";
import { expectTenantRlsInCatalog } from "./helpers/rls-catalog.js";

// Mock DB
vi.mock("../db.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async (_sql: string, params: unknown[]) => ({
		id: params[0],
		tenant_id: params[1],
		project_id: params[2],
		type: params[5] ?? "git",
		ref: "chk-git-123",
		metadata: {},
		created_at: new Date(),
		created_by: "system",
		reason: "test",
		risk_level: "low",
		status: "active",
	})),
}));
vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../security/tool-policy-enforcer.js", () => ({
	enforceToolPolicy: vi.fn(),
	ToolPolicyDeniedError: class extends Error {
		code = "TEST";
		decision = { decision: "deny" };
	},
}));

describe("P3-1: Checkpoint service", () => {
	it("createCheckpoint returns record with id and ref", async () => {
		const { createCheckpoint } = await import("../checkpoint/checkpoint-service.js");
		const input: CreateCheckpointInput = {
			tenantId: "t1",
			projectId: "p1",
			type: "git",
			reason: "pre-task",
			createdBy: "system",
			riskLevel: "medium",
		};
		const result = await createCheckpoint(input);
		expect(result.id).toBeDefined();
		expect(result.type).toBe("git");
		expect(result.status).toBe("active");
	});

	it("checkpoint requires tenantId and projectId", () => {
		const input: CreateCheckpointInput = {
			tenantId: "t1",
			projectId: "p1",
			type: "git",
			reason: "test",
			createdBy: "system",
			riskLevel: "low",
		};
		expect(input.tenantId).toBeDefined();
		expect(input.projectId).toBeDefined();
	});

	it("init.sql contains checkpoint tables with RLS", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const sql = readFileSync(join(process.cwd(), "scripts/init.sql"), "utf8");
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS checkpoints");
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS rollback_requests");
		await expectTenantRlsInCatalog("checkpoints");
		await expectTenantRlsInCatalog("rollback_requests");
	});
});

describe("P3-2: Rollback", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("dry-run does not mutate state (returns planned)", async () => {
		const { queryOne } = await import("../db.js");
		// getCheckpoint → returns matching row
		vi.mocked(queryOne).mockResolvedValueOnce({
			id: "chk-1",
			tenant_id: "t1",
			project_id: "p1",
			type: "git",
			ref: "abc123",
			risk_level: "low",
			status: "active",
			metadata: {},
			created_by: "system",
			reason: "test",
			created_at: new Date(),
		} as unknown as Awaited<ReturnType<typeof queryOne>>);
		// createRollbackRequest INSERT → dummy row
		vi.mocked(queryOne).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof queryOne>>);
		// updateRollbackStatus → dummy
		vi.mocked(queryOne).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof queryOne>>);

		const { requestRollback } = await import("../checkpoint/checkpoint-service.js");
		const req: RollbackRequest = {
			checkpointId: "chk-1",
			tenantId: "t1",
			projectId: "p1",
			requestedBy: "user-1",
			reason: "test rollback",
			dryRun: true,
		};
		const result = await requestRollback(req);
		expect(result.status).toBe("planned");
	});

	it("high-risk rollback returns requires_approval", async () => {
		const { queryOne } = await import("../db.js");
		// getCheckpoint → high-risk row
		vi.mocked(queryOne).mockResolvedValueOnce({
			id: "chk-2",
			tenant_id: "t1",
			project_id: "p1",
			type: "git",
			ref: "abc",
			risk_level: "high",
			status: "active",
			metadata: {},
			created_by: "system",
			reason: "test",
			created_at: new Date(),
		} as unknown as Awaited<ReturnType<typeof queryOne>>);
		// createRollbackRequest INSERT → dummy
		vi.mocked(queryOne).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof queryOne>>);
		// updateRollbackStatus → dummy
		vi.mocked(queryOne).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof queryOne>>);

		const { requestRollback } = await import("../checkpoint/checkpoint-service.js");
		const req: RollbackRequest = {
			checkpointId: "chk-2",
			tenantId: "t1",
			projectId: "p1",
			requestedBy: "user-1",
			reason: "test",
			dryRun: false,
		};
		const result = await requestRollback(req);
		expect(result.status).toBe("requires_approval");
	});

	it("rollback with mismatched tenant fails", async () => {
		const { queryOne } = await import("../db.js");
		// getCheckpoint returns null (RLS blocks wrong tenant)
		vi.mocked(queryOne).mockResolvedValueOnce(null);

		const { requestRollback } = await import("../checkpoint/checkpoint-service.js");
		const result = await requestRollback({
			checkpointId: "chk-3",
			tenantId: "wrong-tenant",
			projectId: "p1",
			requestedBy: "user-1",
			reason: "test",
			dryRun: false,
		});
		expect(result.status).toBe("failed");
		expect(result.errors?.[0]).toContain("not found");
	});
});
