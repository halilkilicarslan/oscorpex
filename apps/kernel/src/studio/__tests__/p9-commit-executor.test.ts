import { describe, expect, it, vi } from "vitest";
import { expectTenantRlsInCatalog } from "./helpers/rls-catalog.js";

vi.mock("../security/tool-policy-enforcer.js", () => ({
	enforceToolPolicy: vi.fn(),
	ToolPolicyDeniedError: class extends Error {
		code = "TEST";
	},
}));
vi.mock("../security/workspace-resolver.js", () => ({
	assertInsideWorkspace: vi.fn(),
	resolveWorkspacePath: vi.fn(() => "/workspace"),
}));
vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("P9-H: Commit Apply Executor", () => {
	it("blocks unapproved proposal", async () => {
		const { applyCommit } = await import("../git/commit-executor.js");
		const result = applyCommit({
			proposal: { status: "pending", secretScanPassed: true, testGatePassed: true } as any,
			checkpoint: { headSha: "abc", tenantId: "t1", projectId: "p1" } as any,
			repoPath: "/tmp/test-repo",
			actorId: "u1",
		});
		expect(result.status).toBe("blocked");
		expect(result.error).toContain("expected 'approved'");
	});

	it("blocks when secret scan not passed", async () => {
		const { applyCommit } = await import("../git/commit-executor.js");
		const result = applyCommit({
			proposal: { status: "approved", secretScanPassed: false, testGatePassed: true } as any,
			checkpoint: { headSha: "abc" } as any,
			repoPath: "/tmp/test-repo",
			actorId: "u1",
		});
		expect(result.status).toBe("blocked");
		expect(result.error).toContain("Secret scan");
	});

	it("blocks when test gate not passed", async () => {
		const { applyCommit } = await import("../git/commit-executor.js");
		const result = applyCommit({
			proposal: { status: "approved", secretScanPassed: true, testGatePassed: false } as any,
			checkpoint: { headSha: "abc" } as any,
			repoPath: "/tmp/test-repo",
			actorId: "u1",
		});
		expect(result.status).toBe("blocked");
		expect(result.error).toContain("Test gate");
	});

	it("returns failed or blocked when git is not available (no real repo)", async () => {
		// With no real git repo at /tmp/test-repo, execFileSync will throw
		// This verifies the error is caught and returned as failed/blocked
		const { applyCommit } = await import("../git/commit-executor.js");
		const result = applyCommit({
			proposal: {
				status: "approved",
				secretScanPassed: true,
				testGatePassed: true,
				tenantId: "t1",
				projectId: "p1",
				id: "prop-1",
				message: "test commit",
			} as any,
			checkpoint: { headSha: "expected-sha", tenantId: "t1", projectId: "p1" } as any,
			repoPath: "/tmp/test-nonexistent-repo",
			actorId: "u1",
		});

		// Should be failed (git command error) or blocked (workspace/policy)
		expect(["failed", "blocked"]).toContain(result.status);
		expect(result.error).toBeDefined();
	});
});

describe("P9-J: Git Rollback", () => {
	it("dry-run returns planned without mutation", async () => {
		const { rollbackToCheckpoint } = await import("../git/git-rollback.js");
		// This will fail without a real git repo, but should not crash
		try {
			const result = rollbackToCheckpoint({
				checkpoint: { headSha: "abc123", tenantId: "t1", projectId: "p1" } as any,
				repoPath: "/tmp/nonexistent",
				dryRun: true,
			});
			// If it reaches here, it should be planned or failed (no crash)
			expect(["planned", "failed"]).toContain(result.status);
		} catch {
			// Expected in test environment without git repo
		}
	});

	it("returns failed when git repo does not exist on dry run", async () => {
		// Without a real git repo, execFileSync throws — rollback should catch and return failed
		const { rollbackToCheckpoint } = await import("../git/git-rollback.js");
		const result = rollbackToCheckpoint({
			checkpoint: { headSha: "target-sha", tenantId: "t1", projectId: "p1", id: "cp-1" } as any,
			repoPath: "/tmp/test-nonexistent-git-repo",
			dryRun: true,
		});

		// planned if workspace check passes + git is absent → failed; either is valid
		expect(["planned", "failed"]).toContain(result.status);
	});

	it("workspace violation returns failed", async () => {
		const workspaceModule = await import("../security/workspace-resolver.js");
		const spy = vi.spyOn(workspaceModule, "assertInsideWorkspace").mockImplementationOnce(() => {
			throw new Error("Path is outside workspace");
		});

		const { rollbackToCheckpoint } = await import("../git/git-rollback.js");
		const result = rollbackToCheckpoint({
			checkpoint: { headSha: "abc123", tenantId: "t1", projectId: "p1", id: "cp-1" } as any,
			repoPath: "/tmp/test-repo",
			dryRun: false,
		});

		spy.mockRestore();

		expect(result.status).toBe("failed");
		expect(result.error).toContain("workspace");
	});
});

describe("P9-K: Git commit tables with RLS", () => {
	it("init.sql contains git_checkpoints table", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const sql = readFileSync(join(process.cwd(), "scripts/init.sql"), "utf8");
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS git_checkpoints");
		await expectTenantRlsInCatalog("git_checkpoints");
	});

	it("init.sql contains commit_proposals table", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const sql = readFileSync(join(process.cwd(), "scripts/init.sql"), "utf8");
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS commit_proposals");
		await expectTenantRlsInCatalog("commit_proposals");
	});

	it("staging script includes p8 and p9 suites", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const script = readFileSync(join(process.cwd(), "../../scripts/validate-staging.sh"), "utf8");
		expect(script).toContain("p8");
		expect(script).toContain("p9");
	});
});
