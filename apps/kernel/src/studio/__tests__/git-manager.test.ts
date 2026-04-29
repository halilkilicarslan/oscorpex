import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitManager } from "../git-manager.js";

let testDir: string;
let rootTmp: string;

describe("Git Manager", () => {
	beforeAll(async () => {
		rootTmp = join(process.cwd(), ".tmp");
		await mkdir(rootTmp, { recursive: true });
		testDir = await mkdtemp(join(rootTmp, "studio-git-test-"));
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	// ---- Repo init ----------------------------------------------------------

	describe("Repository", () => {
		it("should init a git repo", async () => {
			await gitManager.initRepo(testDir);
			expect(await gitManager.isRepo(testDir)).toBe(true);
		});

		it("should detect non-repo directories", async () => {
			const nonRepo = await mkdtemp(join(rootTmp, "non-repo-"));
			expect(await gitManager.isRepo(nonRepo)).toBe(false);
			await rm(nonRepo, { recursive: true, force: true });
		});
	});

	// ---- Branch operations --------------------------------------------------

	describe("Branches", () => {
		it("should list branches", async () => {
			const branches = await gitManager.listBranches(testDir);
			expect(branches.length).toBeGreaterThan(0);
		});

		it("should create and checkout a branch", async () => {
			await gitManager.createBranch(testDir, "feat/test");
			const current = await gitManager.getCurrentBranch(testDir);
			expect(current).toBe("feat/test");

			// Switch back
			await gitManager.checkout(testDir, "master");
			const back = await gitManager.getCurrentBranch(testDir);
			expect(back).toBe("master");
		});
	});

	// ---- Commit operations --------------------------------------------------

	describe("Commits", () => {
		it("should commit files", async () => {
			await writeFile(join(testDir, "hello.txt"), "Hello World");
			const hash = await gitManager.commit(testDir, "Add hello.txt");
			expect(hash).toBeTruthy();
		});

		it("should get log", async () => {
			const log = await gitManager.getLog(testDir);
			expect(log.length).toBeGreaterThanOrEqual(2); // initial + hello.txt
			expect(log[0].message).toBe("Add hello.txt");
		});

		it("should get diff", async () => {
			await writeFile(join(testDir, "hello.txt"), "Hello World v2");
			const diff = await gitManager.getDiff(testDir);
			expect(diff).toContain("Hello World v2");
			// Commit for cleanup
			await gitManager.commit(testDir, "Update hello.txt");
		});
	});

	// ---- Merge operations ---------------------------------------------------

	describe("Merge", () => {
		it("should merge branches", async () => {
			// Create a feature branch with changes
			await gitManager.createBranch(testDir, "feat/merge-test");
			await writeFile(join(testDir, "feature.txt"), "Feature content");
			await gitManager.commit(testDir, "Add feature");

			// Merge back to master
			const result = await gitManager.merge(testDir, "feat/merge-test", "master");
			expect(result.success).toBe(true);

			// Verify file exists on master
			const content = await gitManager.getFileContent(testDir, "feature.txt");
			expect(content).toBe("Feature content");
		});
	});

	// ---- File tree ----------------------------------------------------------

	describe("File Tree", () => {
		it("should return file tree", async () => {
			await mkdir(join(testDir, "src"), { recursive: true });
			await writeFile(join(testDir, "src", "index.ts"), 'console.log("hi")');

			const tree = await gitManager.getFileTree(testDir);
			const srcNode = tree.find((n) => n.name === "src");
			expect(srcNode).toBeDefined();
			expect(srcNode!.type).toBe("directory");
			expect(srcNode!.children?.some((c) => c.name === "index.ts")).toBe(true);
		});

		it("should read file content", async () => {
			const content = await gitManager.getFileContent(testDir, "hello.txt");
			expect(content).toBe("Hello World v2");
		});

		it("should reject path traversal", async () => {
			await expect(gitManager.getFileContent(testDir, "../../../etc/passwd")).rejects.toThrow();
		});
	});

	// ---- Docs system --------------------------------------------------------

	describe("Docs System", () => {
		it("should init docs folder", async () => {
			await gitManager.initDocs(testDir);
			const project = await gitManager.readDoc(testDir, "PROJECT.md");
			expect(project).toContain("# Project");

			const standards = await gitManager.readDoc(testDir, "CODING_STANDARDS.md");
			expect(standards).toContain("# Coding Standards");
		});

		it("should build agent context", async () => {
			const context = await gitManager.buildAgentContext(testDir, "backend");
			expect(context).toContain("Project");
			expect(context).toContain("API Contract");
		});

		it("should return null for missing docs", async () => {
			const result = await gitManager.readDoc(testDir, "NONEXISTENT.md");
			expect(result).toBeNull();
		});
	});
});
