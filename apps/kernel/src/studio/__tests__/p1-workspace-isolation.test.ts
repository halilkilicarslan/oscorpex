// ---------------------------------------------------------------------------
// P1-3: Workspace Isolation — Regression Tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
	WorkspaceViolationError,
	assertInsideWorkspace,
	resolveWorkspacePath,
	validateRepoPath,
} from "../security/workspace-resolver.js";

const scope = { tenantId: "tenant-abc", projectId: "project-123" };

describe("P1-3: Workspace isolation", () => {
	it("resolves safe workspace path", () => {
		const path = resolveWorkspacePath(scope);
		expect(path).toContain("tenant-abc");
		expect(path).toContain("project-123");
	});

	it("resolves relative path inside workspace", () => {
		const path = resolveWorkspacePath(scope, "src/index.ts");
		expect(path).toContain("project-123");
		expect(path).toContain("src");
	});

	it("rejects ../../other-project traversal", () => {
		expect(() => resolveWorkspacePath(scope, "../../other-project")).toThrow(WorkspaceViolationError);
	});

	it("rejects absolute path as relative", () => {
		expect(() => resolveWorkspacePath(scope, "/etc/passwd")).toThrow(WorkspaceViolationError);
	});

	it("rejects invalid tenantId", () => {
		expect(() => resolveWorkspacePath({ tenantId: "../evil", projectId: "ok" })).toThrow(WorkspaceViolationError);
	});

	it("rejects invalid projectId", () => {
		expect(() => resolveWorkspacePath({ tenantId: "ok", projectId: "../../etc" })).toThrow(WorkspaceViolationError);
	});

	it("tenant A cannot resolve tenant B path", () => {
		const pathA = resolveWorkspacePath({ tenantId: "tenant-A", projectId: "proj-1" });
		const pathB = resolveWorkspacePath({ tenantId: "tenant-B", projectId: "proj-1" });
		expect(pathA).not.toEqual(pathB);
		expect(pathA).toContain("tenant-A");
		expect(pathB).toContain("tenant-B");
	});

	it("validateRepoPath rejects /", () => {
		expect(() => validateRepoPath("/")).toThrow(WorkspaceViolationError);
	});

	it("validateRepoPath rejects /etc", () => {
		expect(() => validateRepoPath("/etc")).toThrow(WorkspaceViolationError);
	});

	it("validateRepoPath rejects $HOME", () => {
		expect(() => validateRepoPath(process.env.HOME || "/root")).toThrow(WorkspaceViolationError);
	});

	it("docker-compose.yml does not contain Docker socket mount in default config", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const compose = readFileSync(join(process.cwd(), "../../docker-compose.yml"), "utf8");
		// Active Docker socket mount line should be commented out
		const activeSocketLines = compose
			.split("\n")
			.filter((l) => l.includes("/var/run/docker.sock") && !l.trim().startsWith("#"));
		expect(activeSocketLines).toHaveLength(0);
	});

	it("agent network is internal by default", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const compose = readFileSync(join(process.cwd(), "../../docker-compose.yml"), "utf8");
		expect(compose).toContain("internal: true");
	});
});
