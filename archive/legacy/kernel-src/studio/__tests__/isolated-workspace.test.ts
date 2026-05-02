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

// ---------------------------------------------------------------------------
// Sandbox path hardening
// ---------------------------------------------------------------------------
import { checkPathAllowed } from "../sandbox-manager.js";
import type { SandboxPolicy } from "../sandbox-manager.js";

describe("checkPathAllowed — realpath hardening", () => {
	const makePolicy = (scope: string[]): SandboxPolicy => ({
		id: "p", projectId: "proj-1", isolationLevel: "workspace",
		allowedTools: [], deniedTools: [], filesystemScope: scope,
		networkPolicy: "project_only", maxExecutionTimeMs: 1000,
		maxOutputSizeBytes: 1000, elevatedCapabilities: [], enforcementMode: "hard",
	});

	it("allows path exactly matching scope", () => {
		const result = checkPathAllowed(makePolicy(["/repo/app"]), "/repo/app");
		expect(result.allowed).toBe(true);
	});

	it("allows path within scope", () => {
		const result = checkPathAllowed(makePolicy(["/repo/app"]), "/repo/app/src/index.ts");
		expect(result.allowed).toBe(true);
	});

	it("rejects prefix bypass (app-malicious matching app)", () => {
		const result = checkPathAllowed(makePolicy(["/repo/app"]), "/repo/app-malicious/exploit.ts");
		expect(result.allowed).toBe(false);
	});

	it("rejects path outside scope", () => {
		const result = checkPathAllowed(makePolicy(["/repo/app"]), "/etc/passwd");
		expect(result.allowed).toBe(false);
	});

	it("allows everything when scope is empty", () => {
		const result = checkPathAllowed(makePolicy([]), "/anywhere/at/all");
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// ExecutionWorkspace contract
// ---------------------------------------------------------------------------
import { resolveWorkspace } from "../execution-workspace.js";

describe("execution-workspace", () => {
	let sourceRepo: string;

	beforeEach(async () => {
		sourceRepo = await mkdtemp(join(tmpdir(), "oscorpex-ws-test-"));
		await mkdir(join(sourceRepo, "src"), { recursive: true });
		await writeFile(join(sourceRepo, "src", "main.ts"), "console.log('hello');\n", "utf-8");
	});

	afterEach(async () => {
		await rm(sourceRepo, { recursive: true, force: true });
	});

	it("returns local workspace when isolationLevel is none", async () => {
		const ws = await resolveWorkspace(sourceRepo, "task-1", {
			id: "p", projectId: "proj-1", isolationLevel: "none",
			allowedTools: [], deniedTools: [], filesystemScope: [],
			networkPolicy: "project_only", maxExecutionTimeMs: 1000,
			maxOutputSizeBytes: 1000, elevatedCapabilities: [], enforcementMode: "off",
		});
		expect(ws.type).toBe("local");
		expect(ws.isolated).toBe(false);
		expect(ws.repoPath).toBe(sourceRepo);
	});

	it("returns isolated workspace when isolationLevel is workspace", async () => {
		const ws = await resolveWorkspace(sourceRepo, "task-2", {
			id: "p", projectId: "proj-1", isolationLevel: "workspace",
			allowedTools: [], deniedTools: [], filesystemScope: [],
			networkPolicy: "project_only", maxExecutionTimeMs: 1000,
			maxOutputSizeBytes: 1000, elevatedCapabilities: [], enforcementMode: "hard",
		});
		expect(ws.type).toBe("isolated");
		expect(ws.isolated).toBe(true);
		expect(ws.repoPath).not.toBe(sourceRepo);
		await ws.cleanup();
	});

	it("falls back to isolated when isolationLevel is container (no Docker)", async () => {
		const ws = await resolveWorkspace(sourceRepo, "task-3", {
			id: "p", projectId: "proj-1", isolationLevel: "container",
			allowedTools: [], deniedTools: [], filesystemScope: [],
			networkPolicy: "no_network", maxExecutionTimeMs: 1000,
			maxOutputSizeBytes: 1000, elevatedCapabilities: [], enforcementMode: "hard",
		});
		// Without Docker, container mode falls back to file-copy — type is "isolated" not "container"
		expect(ws.type).toBe("isolated");
		expect(ws.isolated).toBe(true);
		await ws.cleanup();
	});

	it("returns local workspace when no source repo provided", async () => {
		const ws = await resolveWorkspace(undefined, "task-4");
		expect(ws.type).toBe("local");
		expect(ws.repoPath).toBe("");
	});

	it("writeBack and cleanup conform to contract", async () => {
		const ws = await resolveWorkspace(sourceRepo, "task-5", {
			id: "p", projectId: "proj-1", isolationLevel: "workspace",
			allowedTools: [], deniedTools: [], filesystemScope: [],
			networkPolicy: "project_only", maxExecutionTimeMs: 1000,
			maxOutputSizeBytes: 1000, elevatedCapabilities: [], enforcementMode: "soft",
		});
		expect(typeof ws.writeBack).toBe("function");
		expect(typeof ws.cleanup).toBe("function");
		await ws.cleanup();
	});
});

// ---------------------------------------------------------------------------
// Network policy resolution
// ---------------------------------------------------------------------------
import { resolveNetworkMode } from "../container-pool.js";

describe("resolveNetworkMode", () => {
	it("maps no_network to Docker none", () => {
		expect(resolveNetworkMode("no_network")).toBe("none");
	});

	it("maps project_only to internal network", () => {
		expect(resolveNetworkMode("project_only")).toBe("studio-agent-net");
	});

	it("maps unrestricted to internal network", () => {
		expect(resolveNetworkMode("unrestricted")).toBe("studio-agent-net");
	});

	it("defaults to internal network for undefined", () => {
		expect(resolveNetworkMode(undefined)).toBe("studio-agent-net");
	});
});
