import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareIsolatedWorkspace, __testables } from "../isolated-workspace.js";

describe("isolated-workspace", () => {
	let sourceRepo: string;

	beforeEach(async () => {
		sourceRepo = await mkdtemp(join(tmpdir(), "oscorpex-isolation-src-"));
		await mkdir(join(sourceRepo, "src"), { recursive: true });
		await writeFile(join(sourceRepo, "src", "index.ts"), "export const value = 1;\n", "utf-8");
	});

	afterEach(async () => {
		await rm(sourceRepo, { recursive: true, force: true });
	});

	it("falls back to source repo when isolation is disabled", async () => {
		const workspace = await prepareIsolatedWorkspace(sourceRepo, "task-1", {
			id: "policy",
			projectId: "proj-1",
			isolationLevel: "none",
			allowedTools: [],
			deniedTools: [],
			filesystemScope: [],
			networkPolicy: "project_only",
			maxExecutionTimeMs: 1000,
			maxOutputSizeBytes: 1000,
			elevatedCapabilities: [],
			enforcementMode: "hard",
		});
		expect(workspace.isolated).toBe(false);
		expect(workspace.repoPath).toBe(sourceRepo);
	});

	it("creates a temp workspace and writes back declared changes only", async () => {
		const workspace = await prepareIsolatedWorkspace(sourceRepo, "task-2", {
			id: "policy",
			projectId: "proj-1",
			isolationLevel: "workspace",
			allowedTools: [],
			deniedTools: [],
			filesystemScope: [],
			networkPolicy: "project_only",
			maxExecutionTimeMs: 1000,
			maxOutputSizeBytes: 1000,
			elevatedCapabilities: [],
			enforcementMode: "hard",
		});

		expect(workspace.isolated).toBe(true);
		await writeFile(join(workspace.repoPath, "src", "index.ts"), "export const value = 2;\n", "utf-8");
		await mkdir(join(workspace.repoPath, "src", "nested"), { recursive: true });
		await writeFile(join(workspace.repoPath, "src", "nested", "new.ts"), "export const created = true;\n", "utf-8");

		const synced = await workspace.writeBack(["src/index.ts", "src/nested/new.ts"]);
		expect(synced).toEqual(["src/index.ts", "src/nested/new.ts"]);
		expect(await readFile(join(sourceRepo, "src", "index.ts"), "utf-8")).toContain("value = 2");
		expect(await readFile(join(sourceRepo, "src", "nested", "new.ts"), "utf-8")).toContain("created = true");

		await workspace.cleanup();
	});

	it("ignores unsafe relative paths during write-back", async () => {
		expect(__testables.isSafeRelativePath("../etc/passwd")).toBe(false);
		expect(__testables.isSafeRelativePath("src/index.ts")).toBe(true);
	});
});
