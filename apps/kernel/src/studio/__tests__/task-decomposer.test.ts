import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __testables, inferTargetFiles, shouldDecompose } from "../task-decomposer.js";
import type { Project, Task } from "../types.js";

const { heuristicDecompose, gatherCodebaseContext, listProjectFiles, buildDecomposerPrompt } = __testables;

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		phaseId: "phase-1",
		title: "Build authentication system",
		description: "Implement login, signup and tests for src/auth/login.ts and src/auth/signup.ts",
		assignedAgent: "backend",
		status: "queued",
		complexity: "L",
		dependsOn: [],
		branch: "feat/auth",
		retryCount: 0,
		taskType: "ai",
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	} as Task;
}

function makeProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "proj-1",
		name: "Test Project",
		description: "A test project",
		status: "planning",
		techStack: ["typescript", "node"],
		repoPath: "",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("task-decomposer — eligibility", () => {
	it("decomposes only L/XL tasks without parent", () => {
		expect(shouldDecompose(makeTask({ complexity: "L" }))).toBe(true);
		expect(shouldDecompose(makeTask({ complexity: "XL" }))).toBe(true);
		expect(shouldDecompose(makeTask({ complexity: "S" }))).toBe(false);
		expect(shouldDecompose(makeTask({ complexity: "M" }))).toBe(false);
		expect(shouldDecompose(makeTask({ complexity: "L", parentTaskId: "p-1" }))).toBe(false);
	});
});

describe("task-decomposer — inferTargetFiles", () => {
	it("extracts source paths and globs from descriptions", () => {
		const out = inferTargetFiles("Update src/auth/login.ts and tests/auth.test.ts. Also touch *.sql files.");
		expect(out).toContain("src/auth/login.ts");
		expect(out).toContain("tests/auth.test.ts");
		expect(out).toContain("*.sql");
	});

	it("returns empty array when no paths are mentioned", () => {
		expect(inferTargetFiles("Just refactor the code a bit")).toEqual([]);
	});
});

describe("task-decomposer — heuristic fallback", () => {
	it("splits descriptions on conjunctions", () => {
		const subs = heuristicDecompose(
			makeTask({
				description: "Add the login endpoint and write integration tests for it",
			}),
		);
		expect(subs.length).toBeGreaterThanOrEqual(2);
		expect(subs.every((s) => s.complexity === "S" || s.complexity === "M")).toBe(true);
	});

	it("splits on multiple files when no conjunction is present", () => {
		const subs = heuristicDecompose(
			makeTask({
				description: "Modify src/a.ts then src/b.ts then src/c.ts",
			}),
		);
		expect(subs.length).toBeGreaterThanOrEqual(2);
	});

	it("falls back to impl + tests split for impl+test descriptions", () => {
		const subs = heuristicDecompose(makeTask({ description: "Write a parser implementation with full unit tests" }));
		expect(subs.length).toBe(2);
		expect(subs[0].description.toLowerCase()).toMatch(/implement/);
		expect(subs[1].description.toLowerCase()).toMatch(/test/);
	});

	it("guarantees at least 2 sub-tasks even for an opaque description", () => {
		const subs = heuristicDecompose(makeTask({ description: "do the thing" }));
		expect(subs.length).toBe(2);
		expect(subs[0].title).toContain("[1/");
		expect(subs[1].title).toContain("[2/");
	});

	it("caps sub-tasks at 8", () => {
		const longDesc = Array.from({ length: 20 }, (_, i) => `step-${i} src/file${i}.ts then`).join(" ");
		const subs = heuristicDecompose(makeTask({ description: longDesc }));
		expect(subs.length).toBeLessThanOrEqual(8);
	});

	it("assigns S complexity to short segments and M to long ones", () => {
		const longSegment = "Implement an extremely detailed payment flow ".repeat(6);
		const subs = heuristicDecompose(makeTask({ description: `${longSegment} and write tests for it` }));
		const hasMedium = subs.some((s) => s.complexity === "M");
		expect(hasMedium).toBe(true);
	});

	it("estimates lines proportional to complexity", () => {
		const subs = heuristicDecompose(makeTask({ description: "Add foo and add bar" }));
		for (const sub of subs) {
			if (sub.complexity === "S") expect(sub.estimatedLines).toBeLessThanOrEqual(20);
			else expect(sub.estimatedLines).toBeGreaterThan(20);
		}
	});
});

describe("task-decomposer — codebase context", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await mkdtemp(join(tmpdir(), "decomposer-"));
		await mkdir(join(tmp, "src", "auth"), { recursive: true });
		await mkdir(join(tmp, "node_modules", "skip-me"), { recursive: true });
		await writeFile(join(tmp, "src", "auth", "login.ts"), "export const login = () => {};\n");
		await writeFile(join(tmp, "src", "auth", "signup.ts"), "export const signup = () => {};\n");
		await writeFile(join(tmp, "src", "index.ts"), "// entry\n");
		await writeFile(join(tmp, "node_modules", "skip-me", "junk.ts"), "// noise\n");
	});

	afterEach(async () => {
		await rm(tmp, { recursive: true, force: true });
	});

	it("listProjectFiles excludes node_modules and respects depth", async () => {
		const files = await listProjectFiles(tmp, 5, 50);
		expect(files).toContain("src/auth/login.ts");
		expect(files).toContain("src/auth/signup.ts");
		expect(files).toContain("src/index.ts");
		expect(files.some((f) => f.includes("node_modules"))).toBe(false);
	});

	it("listProjectFiles caps results at maxEntries", async () => {
		const files = await listProjectFiles(tmp, 5, 2);
		expect(files.length).toBeLessThanOrEqual(2);
	});

	it("gatherCodebaseContext includes file listing and target file sizes", async () => {
		const project = makeProject({ repoPath: tmp });
		const task = makeTask({
			targetFiles: ["src/auth/login.ts", "src/missing.ts"],
		});
		const ctx = await gatherCodebaseContext(project, task);
		expect(ctx).toContain("src/auth/login.ts");
		expect(ctx).toContain("src/missing.ts (does not exist yet)");
		expect(ctx).toContain("Project files");
	});

	it("gatherCodebaseContext returns sentinel when no repoPath", async () => {
		const ctx = await gatherCodebaseContext(makeProject({ repoPath: "" }), makeTask());
		expect(ctx).toMatch(/No repo path/i);
	});
});

describe("task-decomposer — prompt builder", () => {
	it("includes parent task title, complexity, branch and codebase section", () => {
		const prompt = buildDecomposerPrompt(
			makeProject({ techStack: ["react", "vite"] }),
			makeTask({ title: "Refactor login", complexity: "XL", branch: "feat/refactor" }),
			"Sample codebase context",
		);
		expect(prompt).toContain("Refactor login");
		expect(prompt).toContain("XL");
		expect(prompt).toContain("feat/refactor");
		expect(prompt).toContain("react, vite");
		expect(prompt).toContain("Sample codebase context");
	});
});
