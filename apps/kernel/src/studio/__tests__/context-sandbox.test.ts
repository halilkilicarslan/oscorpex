// ---------------------------------------------------------------------------
// Oscorpex — Context Sandbox Tests (v4.0 Faz 2)
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyOutput, compactCrossAgentContext, indexTaskOutput } from "../context-sandbox.js";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock("../context-store.js", () => ({
	searchContext: vi.fn().mockResolvedValue([]),
	indexContent: vi.fn().mockResolvedValue(3),
	getContextSource: vi.fn().mockResolvedValue(null),
	listContextSources: vi.fn().mockResolvedValue([]),
	deleteContextSource: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db.js", () => ({
	listProjectTasks: vi.fn().mockResolvedValue([]),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// classifyOutput
// ---------------------------------------------------------------------------

describe("classifyOutput", () => {
	it("should return 'inline' for small output (<20KB)", () => {
		expect(classifyOutput("small output")).toBe("inline");
	});

	it("should return 'compact' for medium output (20-100KB)", () => {
		const medium = "X".repeat(50_000);
		expect(classifyOutput(medium)).toBe("compact");
	});

	it("should return 'index' for large output (>100KB)", () => {
		const large = "X".repeat(150_000);
		expect(classifyOutput(large)).toBe("index");
	});

	it("should return 'inline' for empty output", () => {
		expect(classifyOutput("")).toBe("inline");
	});
});

// ---------------------------------------------------------------------------
// indexTaskOutput
// ---------------------------------------------------------------------------

describe("indexTaskOutput", () => {
	let indexContent: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const store = await import("../context-store.js");
		indexContent = store.indexContent as ReturnType<typeof vi.fn>;
	});

	it("should index task output with files and logs", async () => {
		await indexTaskOutput("p1", "t1", "Setup Auth", {
			filesCreated: ["src/auth.ts", "src/middleware.ts"],
			filesModified: ["src/index.ts"],
			logs: ["Auth module created"],
		});

		expect(indexContent).toHaveBeenCalledTimes(1);
		const [projectId, content, label, type] = indexContent.mock.calls[0];
		expect(projectId).toBe("p1");
		expect(content).toContain("Setup Auth");
		expect(content).toContain("src/auth.ts");
		expect(content).toContain("src/index.ts");
		expect(content).toContain("Auth module created");
		expect(label).toBe("task:t1:Setup Auth");
		expect(type).toBe("markdown");
	});

	it("should include test results when present", async () => {
		await indexTaskOutput("p1", "t2", "Run Tests", {
			filesCreated: [],
			filesModified: [],
			testResults: { passed: 10, failed: 2, total: 12 },
			logs: [],
		});

		expect(indexContent).toHaveBeenCalledTimes(1);
		const content = indexContent.mock.calls[0][1];
		expect(content).toContain("Passed: 10");
		expect(content).toContain("Failed: 2");
	});

	it("should skip indexing for empty output", async () => {
		await indexTaskOutput("p1", "t3", "Empty Task", {
			filesCreated: [],
			filesModified: [],
			logs: [],
		});

		expect(indexContent).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// compactCrossAgentContext
// ---------------------------------------------------------------------------

describe("compactCrossAgentContext", () => {
	let listProjectTasks: ReturnType<typeof vi.fn>;
	let searchContext: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const db = await import("../db.js");
		listProjectTasks = db.listProjectTasks as ReturnType<typeof vi.fn>;

		const store = await import("../context-store.js");
		searchContext = store.searchContext as ReturnType<typeof vi.fn>;
	});

	it("should return empty prompt when no completed tasks", async () => {
		listProjectTasks.mockResolvedValue([]);

		const result = await compactCrossAgentContext({
			projectId: "p1",
			taskTitle: "New Task",
			taskDescription: "Do something",
		});

		expect(result.prompt).toBe("");
		expect(result.totalFiles).toBe(0);
		expect(result.totalCompletedTasks).toBe(0);
	});

	it("should use FTS results when available", async () => {
		listProjectTasks.mockResolvedValue([
			{
				id: "t1",
				status: "done",
				assignedAgent: "backend-dev",
				title: "Auth System",
				output: { filesCreated: ["src/auth.ts"], filesModified: [], logs: [] },
			},
		]);

		searchContext.mockResolvedValue([
			{
				title: "Auth System",
				content: "Authentication module with JWT...",
				source: "task:t1:Auth System",
				rank: 0.8,
				contentType: "code",
				matchLayer: "tsvector",
			},
		]);

		const result = await compactCrossAgentContext({
			projectId: "p1",
			taskTitle: "Login Page",
			taskDescription: "Create login page using auth system",
		});

		expect(result.prompt).toContain("Cross-Agent Context");
		expect(result.prompt).toContain("Relevant Context");
		expect(result.prompt).toContain("Authentication module with JWT");
		expect(result.relevantFiles).toBe(1);
		expect(result.totalFiles).toBe(1);
	});

	it("should fallback to file listing when FTS returns no results", async () => {
		listProjectTasks.mockResolvedValue([
			{
				id: "t1",
				status: "done",
				assignedAgent: "backend-dev",
				title: "Setup DB",
				output: { filesCreated: ["src/db.ts", "src/models.ts"], filesModified: [], logs: [] },
			},
		]);

		searchContext.mockResolvedValue([]);

		const result = await compactCrossAgentContext({
			projectId: "p1",
			taskTitle: "API Routes",
			taskDescription: "Create REST routes",
		});

		expect(result.prompt).toContain("Cross-Agent Context");
		expect(result.prompt).toContain("`src/db.ts`");
		expect(result.prompt).toContain("backend-dev");
		expect(result.relevantFiles).toBe(0);
	});

	it("should include recent errors", async () => {
		listProjectTasks.mockResolvedValue([
			{
				id: "t1",
				status: "done",
				assignedAgent: "backend-dev",
				title: "Done Task",
				output: { filesCreated: ["src/a.ts"], filesModified: [], logs: [] },
			},
			{
				id: "t2",
				status: "failed",
				assignedAgent: "frontend-dev",
				title: "Broken Task",
				error: "TypeError: Cannot read property 'foo' of undefined",
				output: null,
			},
		]);

		searchContext.mockResolvedValue([]);

		const result = await compactCrossAgentContext({
			projectId: "p1",
			taskTitle: "Fix Bug",
			taskDescription: "Fix the broken page",
		});

		expect(result.prompt).toContain("Recent Errors");
		expect(result.prompt).toContain("TypeError");
	});

	it("should respect maxFiles limit in fallback mode", async () => {
		const tasks = Array.from({ length: 20 }, (_, i) => ({
			id: `t${i}`,
			status: "done",
			assignedAgent: "dev",
			title: `Task ${i}`,
			output: { filesCreated: [`src/file${i}.ts`], filesModified: [], logs: [] },
		}));
		listProjectTasks.mockResolvedValue(tasks);
		searchContext.mockResolvedValue([]);

		const result = await compactCrossAgentContext({
			projectId: "p1",
			taskTitle: "Final Task",
			taskDescription: "Wrap up",
			maxFiles: 5,
		});

		expect(result.prompt).toContain("and 15 more files");
		expect(result.totalFiles).toBe(20);
	});

	it("should gracefully handle FTS search failure", async () => {
		listProjectTasks.mockResolvedValue([
			{
				id: "t1",
				status: "done",
				assignedAgent: "dev",
				title: "Task 1",
				output: { filesCreated: ["src/a.ts"], filesModified: [], logs: [] },
			},
		]);

		searchContext.mockRejectedValue(new Error("FTS unavailable"));

		const result = await compactCrossAgentContext({
			projectId: "p1",
			taskTitle: "Test",
			taskDescription: "Test desc",
		});

		// Should fallback to raw listing
		expect(result.prompt).toContain("`src/a.ts`");
		expect(result.relevantFiles).toBe(0);
	});
});
