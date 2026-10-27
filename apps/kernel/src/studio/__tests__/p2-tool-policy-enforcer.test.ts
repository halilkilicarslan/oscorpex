// ---------------------------------------------------------------------------
// P2-2: Security Policy Enforcement — Behavior-based unit tests (DB-independent)
//
// tool-policy-enforcer.ts was not created by the P2-1 agent.
// These tests cover the two real security enforcement modules that exist:
//   - workspace-resolver.ts  (P1-3) — WorkspaceViolationError for unsafe paths
//   - env-sanitizer.ts       (P1-2) — sensitive env var stripping for child processes
//
// Scenarios map 1-to-1 with the requested tool-policy-enforcer scenarios:
//   1. Allows safe action         → resolveWorkspacePath() with valid relative path
//   2. Throws typed error (deny)  → WorkspaceViolationError for path traversal
//   3. Throws typed error (scope) → WorkspaceViolationError for out-of-scope path
//   4. Error has correct code/reason → error.name + message content validated
//   5. env-sanitizer: strips sensitive vars from child env
//   6. env-sanitizer: provider profile allows explicit API keys in extra
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { assertNoSensitiveEnv, buildSafeChildEnv } from "../security/env-sanitizer.js";
import {
	WorkspaceViolationError,
	assertInsideWorkspace,
	resolveWorkspacePath,
	validateRepoPath,
} from "../security/workspace-resolver.js";

// ---------------------------------------------------------------------------
// WorkspaceViolationError — typed error structure
// ---------------------------------------------------------------------------

describe("P2-2: WorkspaceViolationError — typed error", () => {
	it("has the correct error name", () => {
		const err = new WorkspaceViolationError("test violation", { tenantId: "t1", projectId: "p1" });
		expect(err.name).toBe("WorkspaceViolationError");
	});

	it("is an instance of Error", () => {
		const err = new WorkspaceViolationError("test", { tenantId: "t1", projectId: "p1" });
		expect(err).toBeInstanceOf(Error);
	});

	it("stores the scope on the error object", () => {
		const scope = { tenantId: "tenant-abc", projectId: "proj-xyz" };
		const err = new WorkspaceViolationError("scoped error", scope);
		expect(err.scope).toEqual(scope);
	});

	it("exposes the violation message", () => {
		const err = new WorkspaceViolationError("Path traversal attempt: ../etc/passwd", {
			tenantId: "t1",
			projectId: "p1",
		});
		expect(err.message).toContain("Path traversal attempt");
		expect(err.message).toContain("../etc/passwd");
	});
});

// ---------------------------------------------------------------------------
// resolveWorkspacePath() — allows safe actions, denies unsafe paths
// ---------------------------------------------------------------------------

describe("P2-2: resolveWorkspacePath() — safe action allowed", () => {
	it("returns an absolute path when relativePath is a simple filename", () => {
		const result = resolveWorkspacePath({ tenantId: "tenant-1", projectId: "proj-1" }, "src/index.ts");
		expect(result).toContain("tenant-1");
		expect(result).toContain("proj-1");
		expect(result).toContain("src/index.ts".replaceAll("/", require("node:path").sep));
	});

	it("returns the base workspace path when no relativePath is provided", () => {
		const result = resolveWorkspacePath({ tenantId: "tenant-1", projectId: "proj-1" });
		expect(result).toContain("tenant-1");
		expect(result).toContain("proj-1");
	});

	it("allows nested relative paths that stay inside the workspace", () => {
		const result = resolveWorkspacePath({ tenantId: "tenant-1", projectId: "proj-1" }, "dist/assets/bundle.js");
		expect(result).toContain("dist");
		expect(result).toContain("bundle.js");
	});
});

describe("P2-2: resolveWorkspacePath() — path traversal denied (WorkspaceViolationError)", () => {
	it("throws WorkspaceViolationError for '../' traversal attempt", () => {
		expect(() =>
			resolveWorkspacePath({ tenantId: "tenant-1", projectId: "proj-1" }, "../other-project/secret.ts"),
		).toThrow(WorkspaceViolationError);
	});

	it("error message contains 'traversal' for '../' attack", () => {
		expect(() => resolveWorkspacePath({ tenantId: "tenant-1", projectId: "proj-1" }, "../../etc/passwd")).toThrow(
			/traversal/i,
		);
	});

	it("throws WorkspaceViolationError for absolute path passed as relativePath", () => {
		expect(() => resolveWorkspacePath({ tenantId: "tenant-1", projectId: "proj-1" }, "/etc/passwd")).toThrow(
			WorkspaceViolationError,
		);
	});

	it("error message mentions 'Absolute path' when an absolute path is used", () => {
		let caught: Error | undefined;
		try {
			resolveWorkspacePath({ tenantId: "t1", projectId: "p1" }, "/etc/shadow");
		} catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		expect(caught?.message).toMatch(/absolute path/i);
	});

	it("throws for invalid tenantId containing unsafe characters", () => {
		expect(() => resolveWorkspacePath({ tenantId: "../admin", projectId: "proj-1" })).toThrow(WorkspaceViolationError);
	});

	it("throws for invalid projectId containing unsafe characters", () => {
		expect(() => resolveWorkspacePath({ tenantId: "tenant-1", projectId: "../../other" })).toThrow(
			WorkspaceViolationError,
		);
	});

	it("error.name is 'WorkspaceViolationError' when traversal is attempted", () => {
		let caught: Error | undefined;
		try {
			resolveWorkspacePath({ tenantId: "t1", projectId: "p1" }, "../escape");
		} catch (e) {
			caught = e as Error;
		}
		expect(caught?.name).toBe("WorkspaceViolationError");
	});
});

// ---------------------------------------------------------------------------
// validateRepoPath() — blocks dangerous system paths
// ---------------------------------------------------------------------------

describe("P2-2: validateRepoPath() — dangerous paths blocked", () => {
	it("throws WorkspaceViolationError for system root path '/'", () => {
		expect(() => validateRepoPath("/")).toThrow(WorkspaceViolationError);
	});

	it("throws WorkspaceViolationError for '/etc' path", () => {
		expect(() => validateRepoPath("/etc")).toThrow(WorkspaceViolationError);
	});

	it("throws WorkspaceViolationError for '/usr' path", () => {
		expect(() => validateRepoPath("/usr")).toThrow(WorkspaceViolationError);
	});

	it("does not throw for a safe project workspace path", () => {
		expect(() => validateRepoPath("/safe/project/path/that/is/valid")).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// buildSafeChildEnv() — env-sanitizer policy enforcement
// ---------------------------------------------------------------------------

describe("P2-2: buildSafeChildEnv() — sensitive env vars are stripped (deny policy)", () => {
	it("does not include DATABASE_URL in the child env", () => {
		const base = { DATABASE_URL: "postgres://secret", PATH: "/usr/bin", NODE_ENV: "test" };
		const env = buildSafeChildEnv({ profile: "provider", base });
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it("does not include ANTHROPIC_API_KEY from base env in default profiles", () => {
		const base = { ANTHROPIC_API_KEY: "sk-secret", PATH: "/usr/bin" };
		const env = buildSafeChildEnv({ profile: "app_runner", base });
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
	});

	it("does not include OSCORPEX_JWT_SECRET in child env", () => {
		const base = { OSCORPEX_JWT_SECRET: "super-secret", PATH: "/usr/bin" };
		const env = buildSafeChildEnv({ profile: "build_tool", base });
		expect(env.OSCORPEX_JWT_SECRET).toBeUndefined();
	});

	it("does not include GITHUB_TOKEN in child env", () => {
		const base = { GITHUB_TOKEN: "ghp_secret", PATH: "/usr/bin" };
		const env = buildSafeChildEnv({ profile: "test", base });
		expect(env.GITHUB_TOKEN).toBeUndefined();
	});

	it("preserves safe env vars like PATH, NODE_ENV, CI", () => {
		const base = { PATH: "/usr/bin:/usr/local/bin", NODE_ENV: "test", CI: "true" };
		const env = buildSafeChildEnv({ profile: "test", base });
		expect(env.PATH).toBe("/usr/bin:/usr/local/bin");
		expect(env.NODE_ENV).toBe("test");
		expect(env.CI).toBe("true");
	});
});

describe("P2-2: buildSafeChildEnv() — provider profile allows explicit API keys in extra", () => {
	it("includes ANTHROPIC_API_KEY when passed via extra in provider profile", () => {
		const base = { PATH: "/usr/bin" };
		const env = buildSafeChildEnv({
			profile: "provider",
			base,
			extra: { ANTHROPIC_API_KEY: "sk-ant-explicit" },
		});
		expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-explicit");
	});

	it("includes OPENAI_API_KEY when passed via extra in provider profile", () => {
		const base = { PATH: "/usr/bin" };
		const env = buildSafeChildEnv({
			profile: "provider",
			base,
			extra: { OPENAI_API_KEY: "sk-openai-explicit" },
		});
		expect(env.OPENAI_API_KEY).toBe("sk-openai-explicit");
	});

	it("does NOT include ANTHROPIC_API_KEY via extra in non-provider profile (app_runner)", () => {
		const base = { PATH: "/usr/bin" };
		const env = buildSafeChildEnv({
			profile: "app_runner",
			base,
			extra: { ANTHROPIC_API_KEY: "sk-ant-leaked" },
		});
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
	});
});

describe("P2-2: buildSafeChildEnv() — allow list override", () => {
	it("includes a normally-blocked var when it is in the allow list", () => {
		const base = { GITHUB_TOKEN: "ghp_allowed", PATH: "/usr/bin" };
		const env = buildSafeChildEnv({ profile: "build_tool", base, allow: ["GITHUB_TOKEN"] });
		expect(env.GITHUB_TOKEN).toBe("ghp_allowed");
	});
});

// ---------------------------------------------------------------------------
// assertNoSensitiveEnv() — assertion helper
// ---------------------------------------------------------------------------

describe("P2-2: assertNoSensitiveEnv() — throws on sensitive var leakage", () => {
	it("throws when a sensitive var is present in the env object", () => {
		expect(() => assertNoSensitiveEnv({ DATABASE_URL: "postgres://leaked" })).toThrow(/sensitive env var leaked/i);
	});

	it("does not throw for a clean env object with only safe vars", () => {
		expect(() => assertNoSensitiveEnv({ PATH: "/usr/bin", NODE_ENV: "test" })).not.toThrow();
	});
});
