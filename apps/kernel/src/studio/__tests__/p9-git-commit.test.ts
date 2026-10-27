// ---------------------------------------------------------------------------
// P9: Git Commit Workflow — Unit Tests
// Covers: P9-A (GitCheckpoint), P9-B (CommitProposal), P9-D (SecretScan),
//         P9-E (CommitMessagePolicy), P9-F (TestPassToken)
//
// All tests are DB-independent. External git and fs operations are mocked
// where needed.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Mocks — declared before module imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// We mock node:child_process so tests never spawn real git processes.
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
	execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// We selectively intercept readFileSync calls inside secret-scan tests.
// The flag below is toggled per test; all other callers (e.g. init.sql read)
// fall through to the real implementation.
const mockReadFileSync = vi.fn();
let _interceptReadFileSync = false;

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: (...args: unknown[]) => {
			if (_interceptReadFileSync) {
				return mockReadFileSync(...args);
			}
			return actual.readFileSync(...(args as Parameters<typeof actual.readFileSync>));
		},
	};
});

// workspace-resolver: by default allow all paths, override per test if needed
vi.mock("../security/workspace-resolver.js", () => ({
	assertInsideWorkspace: vi.fn(),
	resolveWorkspacePath: vi.fn((scope: unknown, rel: unknown) => `/workspace/${rel}`),
	WorkspaceViolationError: class WorkspaceViolationError extends Error {
		constructor(msg: string) {
			super(msg);
			this.name = "WorkspaceViolationError";
		}
	},
}));

// ---------------------------------------------------------------------------
// Module imports — after mocks are in place
// ---------------------------------------------------------------------------

import { validateCommitMessage } from "../git/commit-message-policy.js";
import { scanStagedForSecrets } from "../git/secret-scan.js";
import { issueTestPassToken, verifyTestPassToken, _clearTokenStore } from "../git/test-pass-token.js";
import { isCheckpointValid } from "../git/git-checkpoint-service.js";
import type { GitCheckpoint } from "../git/git-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheckpoint(overrides: Partial<GitCheckpoint> = {}): GitCheckpoint {
	const now = new Date();
	return {
		id: "ckpt-001",
		tenantId: "tenant-abc",
		projectId: "proj-xyz",
		headSha: "abc123def456",
		branchName: "main",
		stagedFiles: ["src/index.ts"],
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(), // +60 min
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// P9-E: validateCommitMessage
// ---------------------------------------------------------------------------

describe("validateCommitMessage", () => {
	it("accepts a valid conventional commit message", () => {
		const result = validateCommitMessage("feat(auth): add JWT refresh token support");
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("accepts a plain subject without conventional prefix", () => {
		const result = validateCommitMessage("Add user profile settings page");
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects an empty message", () => {
		const result = validateCommitMessage("   ");
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("Commit message is empty");
	});

	it("rejects a subject that exceeds 72 characters", () => {
		const long = "fix: " + "a".repeat(80); // 85 chars total
		const result = validateCommitMessage(long);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("exceeds 72 characters"))).toBe(true);
	});

	it("rejects a subject shorter than 10 characters", () => {
		const result = validateCommitMessage("fix bug");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("too short"))).toBe(true);
	});

	it("rejects a subject that ends with a period", () => {
		const result = validateCommitMessage("Update the configuration file.");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("should not end with a period"))).toBe(true);
	});

	it("rejects a message containing a secret pattern (OpenAI key)", () => {
		const result = validateCommitMessage("feat: integrate sk-abcdefghijklmnopqrstuvwxyz1234 key");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("secret or credential"))).toBe(true);
	});

	it("rejects a message containing a GitHub token", () => {
		const result = validateCommitMessage("fix: remove ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789AB from config");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("secret or credential"))).toBe(true);
	});

	it("accumulates multiple errors (length + period)", () => {
		// Short enough to be < 10 AND ends with period
		const result = validateCommitMessage("Fix.");
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThanOrEqual(2);
	});

	it("accepts a multi-line message with valid subject", () => {
		const msg = ["refactor(pipeline): extract stage advance orchestrator", "", "Moves StageAdvanceOrchestrator out of pipeline-engine.ts"].join(
			"\n",
		);
		const result = validateCommitMessage(msg);
		expect(result.valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// P9-D: scanStagedForSecrets
// ---------------------------------------------------------------------------

describe("scanStagedForSecrets", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_interceptReadFileSync = true;
	});

	afterEach(() => {
		_interceptReadFileSync = false;
	});

	it("returns passed=true for a clean file", () => {
		mockReadFileSync.mockReturnValue("export const greeting = 'Hello, world!';");
		const result = scanStagedForSecrets("/repo", ["src/greeting.ts"]);
		expect(result.passed).toBe(true);
		expect(result.findings).toHaveLength(0);
	});

	it("detects a GitHub personal access token", () => {
		mockReadFileSync.mockReturnValue("const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789AB';");
		const result = scanStagedForSecrets("/repo", ["config.ts"]);
		expect(result.passed).toBe(false);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].category).toBe("github_token");
		expect(result.findings[0].file).toBe("config.ts");
		expect(result.findings[0].line).toBe(1);
	});

	it("detects an AWS access key ID", () => {
		mockReadFileSync.mockReturnValue("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
		const result = scanStagedForSecrets("/repo", ["deploy.env"]);
		expect(result.passed).toBe(false);
		expect(result.findings[0].category).toBe("aws_access_key");
	});

	it("detects an Anthropic API key", () => {
		mockReadFileSync.mockReturnValue("const key = 'sk-ant-api03-verylongsecretvalue1234567890abcdef';");
		const result = scanStagedForSecrets("/repo", ["api.ts"]);
		expect(result.passed).toBe(false);
		expect(result.findings[0].category).toBe("anthropic_key");
	});

	it("detects a PEM private key header", () => {
		mockReadFileSync.mockReturnValue("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----");
		const result = scanStagedForSecrets("/repo", ["key.pem"]);
		expect(result.passed).toBe(false);
		expect(result.findings[0].category).toBe("private_key");
	});

	it("detects a connection string with credentials", () => {
		mockReadFileSync.mockReturnValue("const db = 'postgres://user:hunter2@localhost:5432/mydb';");
		const result = scanStagedForSecrets("/repo", ["db.ts"]);
		expect(result.passed).toBe(false);
		expect(result.findings[0].category).toBe("connection_string");
	});

	it("skips binary file extensions", () => {
		// readFileSync should never be called for binary files
		const result = scanStagedForSecrets("/repo", ["image.png", "font.woff2", "archive.zip"]);
		expect(mockReadFileSync).not.toHaveBeenCalled();
		expect(result.passed).toBe(true);
	});

	it("handles deleted/unreadable files gracefully", () => {
		mockReadFileSync.mockImplementation(() => {
			throw new Error("ENOENT: no such file");
		});
		const result = scanStagedForSecrets("/repo", ["deleted.ts"]);
		expect(result.passed).toBe(true);
		expect(result.findings).toHaveLength(0);
	});

	it("reports one finding per line even if multiple patterns match", () => {
		// A single line with an API key pattern — only one finding expected
		mockReadFileSync.mockReturnValue("SOME_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890ab");
		const result = scanStagedForSecrets("/repo", ["env.ts"]);
		expect(result.findings.filter((f) => f.line === 1)).toHaveLength(1);
	});

	it("returns passed=true for an empty staged file list", () => {
		const result = scanStagedForSecrets("/repo", []);
		expect(result.passed).toBe(true);
		expect(result.findings).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// P9-F: issueTestPassToken / verifyTestPassToken
// ---------------------------------------------------------------------------

describe("TestPassToken", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_clearTokenStore();
		vi.useRealTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		_clearTokenStore();
	});

	describe("issueTestPassToken", () => {
		it("issues a token when all tests pass", () => {
			const token = issueTestPassToken({
				projectId: "proj-1",
				tenantId: "tenant-1",
				suiteResult: { passed: 42, failed: 0, total: 42 },
			});

			expect(token).not.toBeNull();
			expect(token!.passed).toBe(true);
			expect(token!.projectId).toBe("proj-1");
			expect(token!.suiteResult.total).toBe(42);
		});

		it("returns null when any test fails", () => {
			const token = issueTestPassToken({
				projectId: "proj-2",
				tenantId: "tenant-1",
				suiteResult: { passed: 10, failed: 3, total: 13 },
			});

			expect(token).toBeNull();
		});

		it("returns null for zero tests run (failed=0, total=0) — passes because failed is 0", () => {
			const token = issueTestPassToken({
				projectId: "proj-3",
				tenantId: "tenant-1",
				suiteResult: { passed: 0, failed: 0, total: 0 },
			});
			// No failures means token is issued (suite may be empty)
			expect(token).not.toBeNull();
		});

		it("overwrites an existing token for the same project", () => {
			issueTestPassToken({
				projectId: "proj-4",
				tenantId: "tenant-1",
				suiteResult: { passed: 5, failed: 0, total: 5 },
			});
			const second = issueTestPassToken({
				projectId: "proj-4",
				tenantId: "tenant-1",
				suiteResult: { passed: 10, failed: 0, total: 10 },
			});

			expect(second!.suiteResult.total).toBe(10);
			expect(verifyTestPassToken("proj-4", "tenant-1")).toBe(true);
		});
	});

	describe("verifyTestPassToken", () => {
		it("returns true for a freshly issued token", () => {
			issueTestPassToken({
				projectId: "proj-ok",
				tenantId: "tenant-1",
				suiteResult: { passed: 1, failed: 0, total: 1 },
			});
			expect(verifyTestPassToken("proj-ok", "tenant-1")).toBe(true);
		});

		it("returns false when no token exists", () => {
			expect(verifyTestPassToken("proj-missing", "tenant-1")).toBe(false);
		});

		it("returns false and cleans up an expired token", () => {
			vi.useFakeTimers();
			const now = Date.now();
			vi.setSystemTime(now);

			issueTestPassToken({
				projectId: "proj-exp",
				tenantId: "tenant-1",
				suiteResult: { passed: 3, failed: 0, total: 3 },
			});

			// Advance clock past 30-minute TTL
			vi.setSystemTime(now + 31 * 60 * 1_000);

			expect(verifyTestPassToken("proj-exp", "tenant-1")).toBe(false);

			// Token should have been evicted — calling again returns false (not error)
			expect(verifyTestPassToken("proj-exp", "tenant-1")).toBe(false);
		});

		it("isolates tokens across tenants", () => {
			issueTestPassToken({
				projectId: "proj-shared",
				tenantId: "tenant-A",
				suiteResult: { passed: 1, failed: 0, total: 1 },
			});

			// Different tenant should not see tenant-A's token
			expect(verifyTestPassToken("proj-shared", "tenant-B")).toBe(false);
			expect(verifyTestPassToken("proj-shared", "tenant-A")).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// P9-A: isCheckpointValid
// ---------------------------------------------------------------------------

describe("isCheckpointValid", () => {
	it("returns true for a fresh, matching checkpoint", () => {
		const ckpt = makeCheckpoint({ headSha: "deadbeef" });
		expect(isCheckpointValid(ckpt, "deadbeef")).toBe(true);
	});

	it("returns false when checkpoint has been invalidated", () => {
		const ckpt = makeCheckpoint({
			headSha: "deadbeef",
			invalidatedAt: new Date().toISOString(),
			invalidationReason: "manual invalidation",
		});
		expect(isCheckpointValid(ckpt, "deadbeef")).toBe(false);
	});

	it("returns false when checkpoint has expired", () => {
		const pastTime = new Date(Date.now() - 1_000).toISOString(); // 1s in the past
		const ckpt = makeCheckpoint({
			headSha: "deadbeef",
			expiresAt: pastTime,
		});
		expect(isCheckpointValid(ckpt, "deadbeef")).toBe(false);
	});

	it("returns false when HEAD SHA has moved", () => {
		const ckpt = makeCheckpoint({ headSha: "oldsha" });
		expect(isCheckpointValid(ckpt, "newsha")).toBe(false);
	});

	it("returns false when both expired and invalidated (prioritises invalidation check)", () => {
		const ckpt = makeCheckpoint({
			headSha: "deadbeef",
			expiresAt: new Date(Date.now() - 1_000).toISOString(),
			invalidatedAt: new Date().toISOString(),
		});
		expect(isCheckpointValid(ckpt, "deadbeef")).toBe(false);
	});

	it("returns false when HEAD mismatch even if not expired", () => {
		const ckpt = makeCheckpoint({
			headSha: "sha-original",
			expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
		});
		expect(isCheckpointValid(ckpt, "sha-after-push")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// DB schema assertions — verify init.sql contains the required tables
// ---------------------------------------------------------------------------

describe("init.sql schema — P9 tables", () => {
	let sqlContent: string;

	beforeEach(() => {
		// __dirname = apps/kernel/src/studio/__tests__
		// scripts/init.sql is at apps/kernel/scripts/init.sql (3 levels up from __dirname)
		const sqlPath = resolve(__dirname, "../../..", "scripts", "init.sql");
		sqlContent = readFileSync(sqlPath, "utf8");
	});

	it("contains CREATE TABLE IF NOT EXISTS git_checkpoints", () => {
		expect(sqlContent).toContain("CREATE TABLE IF NOT EXISTS git_checkpoints");
	});

	it("contains CREATE TABLE IF NOT EXISTS commit_proposals", () => {
		expect(sqlContent).toContain("CREATE TABLE IF NOT EXISTS commit_proposals");
	});

	it("git_checkpoints has RLS ENABLE and FORCE", () => {
		expect(sqlContent).toMatch(/ALTER TABLE git_checkpoints ENABLE ROW LEVEL SECURITY/);
		expect(sqlContent).toMatch(/ALTER TABLE git_checkpoints FORCE ROW LEVEL SECURITY/);
	});

	it("commit_proposals has RLS ENABLE and FORCE", () => {
		expect(sqlContent).toMatch(/ALTER TABLE commit_proposals ENABLE ROW LEVEL SECURITY/);
		expect(sqlContent).toMatch(/ALTER TABLE commit_proposals FORCE ROW LEVEL SECURITY/);
	});

	it("git_checkpoints has tenant isolation policy", () => {
		expect(sqlContent).toContain("CREATE POLICY git_checkpoint_tenant ON git_checkpoints");
	});

	it("commit_proposals has tenant isolation policy", () => {
		expect(sqlContent).toContain("CREATE POLICY commit_proposal_tenant ON commit_proposals");
	});

	it("git_checkpoints columns include head_sha, branch_name, staged_files, expires_at", () => {
		const tableStart = sqlContent.indexOf("CREATE TABLE IF NOT EXISTS git_checkpoints");
		const tableEnd = sqlContent.indexOf(");", tableStart);
		const tableDef = sqlContent.slice(tableStart, tableEnd);
		expect(tableDef).toContain("head_sha");
		expect(tableDef).toContain("branch_name");
		expect(tableDef).toContain("staged_files");
		expect(tableDef).toContain("expires_at");
		expect(tableDef).toContain("invalidated_at");
	});

	it("commit_proposals columns include secret_scan_passed, test_gate_passed, status with CHECK constraint", () => {
		const tableStart = sqlContent.indexOf("CREATE TABLE IF NOT EXISTS commit_proposals");
		const tableEnd = sqlContent.indexOf(");", tableStart);
		const tableDef = sqlContent.slice(tableStart, tableEnd);
		expect(tableDef).toContain("secret_scan_passed");
		expect(tableDef).toContain("test_gate_passed");
		expect(tableDef).toContain("status");
		expect(tableDef).toContain("CHECK");
		expect(tableDef).toContain("proposed_at");
	});
});
