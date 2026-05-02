// ---------------------------------------------------------------------------
// Oscorpex — Template Repo Tests (V6 M3)
// Tests for DB CRUD functions in template-repo.ts
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the pg module before importing template-repo
vi.mock("../pg.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
}));

import {
	countTemplates,
	createTemplate,
	deleteTemplate,
	getTemplate,
	incrementTemplateUsage,
	listTemplates,
	rateTemplate,
	updateTemplate,
} from "../db/template-repo.js";
import * as pg from "../pg.js";

const mockQuery = vi.mocked(pg.query);
const mockQueryOne = vi.mocked(pg.queryOne);
const mockExecute = vi.mocked(pg.execute);

// ---------------------------------------------------------------------------
// Sample row data (snake_case, as returned from PostgreSQL)
// ---------------------------------------------------------------------------

const sampleRow = {
	id: "tpl-1",
	name: "React SPA",
	description: "A single-page React application template",
	category: "frontend",
	tech_stack: ["React", "TypeScript", "Vite"],
	agent_config: { reviewEnabled: true },
	phases: [{ name: "Setup", tasks: [] }],
	is_public: true,
	author_id: "user-1",
	usage_count: 42,
	rating: 4.5,
	created_at: "2026-04-20T00:00:00Z",
	updated_at: "2026-04-20T00:00:00Z",
};

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createTemplate
// ---------------------------------------------------------------------------

describe("createTemplate", () => {
	it("calls queryOne with INSERT and returns mapped template", async () => {
		mockQueryOne.mockResolvedValueOnce(sampleRow);

		const result = await createTemplate({
			name: "React SPA",
			description: "A single-page React application template",
			category: "frontend",
			techStack: ["React", "TypeScript", "Vite"],
		});

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO project_templates"),
			expect.arrayContaining(["React SPA"]),
		);
		expect(result.name).toBe("React SPA");
		expect(result.category).toBe("frontend");
		expect(result.techStack).toEqual(["React", "TypeScript", "Vite"]);
		expect(result.rating).toBe(4.5);
		expect(result.usageCount).toBe(42);
	});

	it("throws when insert returns no row", async () => {
		mockQueryOne.mockResolvedValueOnce(null);

		await expect(
			createTemplate({ name: "Broken Template" }),
		).rejects.toThrow("template insert returned no row");
	});

	it("uses default values when optional fields omitted", async () => {
		mockQueryOne.mockResolvedValueOnce({ ...sampleRow, category: "fullstack", is_public: true, author_id: null });

		await createTemplate({ name: "Minimal" });

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.any(String),
			expect.arrayContaining(["fullstack"]),
		);
	});
});

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------

describe("listTemplates", () => {
	it("calls query with no filters and returns mapped rows", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		const result = await listTemplates();

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("SELECT * FROM project_templates"),
			expect.arrayContaining([50, 0]),
		);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("tpl-1");
	});

	it("appends category condition when provided", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		await listTemplates({ category: "frontend" });

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("category = $1"),
			expect.arrayContaining(["frontend"]),
		);
	});

	it("appends ILIKE search condition when provided", async () => {
		mockQuery.mockResolvedValueOnce([]);

		await listTemplates({ search: "react" });

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("ILIKE"),
			expect.arrayContaining(["%react%"]),
		);
	});

	it("applies both category and search filters", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		await listTemplates({ category: "backend", search: "express" });

		const [sql, params] = mockQuery.mock.calls[0];
		expect(sql).toContain("category = $1");
		expect(sql).toContain("ILIKE");
		expect(params).toContain("backend");
		expect(params).toContain("%express%");
	});

	it("returns empty array when no templates found", async () => {
		mockQuery.mockResolvedValueOnce([]);
		const result = await listTemplates({ category: "mobile" });
		expect(result).toEqual([]);
	});

	it("respects limit and offset parameters", async () => {
		mockQuery.mockResolvedValueOnce([]);
		await listTemplates({ limit: 10, offset: 20 });
		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([10, 20]));
	});
});

// ---------------------------------------------------------------------------
// countTemplates
// ---------------------------------------------------------------------------

describe("countTemplates", () => {
	it("returns total count from DB", async () => {
		mockQueryOne.mockResolvedValueOnce({ count: "7" });

		const count = await countTemplates();

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("COUNT(*)"),
			[],
		);
		expect(count).toBe(7);
	});

	it("returns 0 when no rows", async () => {
		mockQueryOne.mockResolvedValueOnce(null);
		const count = await countTemplates();
		expect(count).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

describe("getTemplate", () => {
	it("calls queryOne with id and maps row", async () => {
		mockQueryOne.mockResolvedValueOnce(sampleRow);

		const result = await getTemplate("tpl-1");

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("WHERE id = $1"),
			["tpl-1"],
		);
		expect(result).not.toBeNull();
		expect(result?.id).toBe("tpl-1");
		expect(result?.isPublic).toBe(true);
		expect(result?.authorId).toBe("user-1");
	});

	it("returns null when template not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);
		const result = await getTemplate("nonexistent");
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// updateTemplate
// ---------------------------------------------------------------------------

describe("updateTemplate", () => {
	it("builds UPDATE query with name field", async () => {
		mockQueryOne.mockResolvedValueOnce({ ...sampleRow, name: "Updated Name" });

		const result = await updateTemplate("tpl-1", { name: "Updated Name" });

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE project_templates SET"),
			expect.arrayContaining(["Updated Name", "tpl-1"]),
		);
		expect(result?.name).toBe("Updated Name");
	});

	it("updates isPublic field", async () => {
		mockQueryOne.mockResolvedValueOnce({ ...sampleRow, is_public: false });

		await updateTemplate("tpl-1", { isPublic: false });

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE project_templates"),
			expect.arrayContaining([false, "tpl-1"]),
		);
	});

	it("returns null when template not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);
		const result = await updateTemplate("ghost", { name: "Test" });
		expect(result).toBeNull();
	});

	it("falls back to getTemplate when no update fields provided", async () => {
		mockQueryOne.mockResolvedValueOnce(sampleRow);

		await updateTemplate("tpl-1", {});

		// Should call getTemplate's query
		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("WHERE id = $1"),
			["tpl-1"],
		);
	});
});

// ---------------------------------------------------------------------------
// deleteTemplate
// ---------------------------------------------------------------------------

describe("deleteTemplate", () => {
	it("calls execute with DELETE statement", async () => {
		mockExecute.mockResolvedValueOnce(undefined as never);

		await deleteTemplate("tpl-1");

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining("DELETE FROM project_templates"),
			["tpl-1"],
		);
	});
});

// ---------------------------------------------------------------------------
// incrementTemplateUsage
// ---------------------------------------------------------------------------

describe("incrementTemplateUsage", () => {
	it("calls execute with usage_count increment", async () => {
		mockExecute.mockResolvedValueOnce(undefined as never);

		await incrementTemplateUsage("tpl-1");

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining("usage_count = usage_count + 1"),
			["tpl-1"],
		);
	});
});

// ---------------------------------------------------------------------------
// rateTemplate
// ---------------------------------------------------------------------------

describe("rateTemplate", () => {
	it("calls execute with weighted avg rating update", async () => {
		mockExecute.mockResolvedValueOnce(undefined as never);

		await rateTemplate("tpl-1", 4.5);

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining("rating ="),
			[4.5, "tpl-1"],
		);
	});

	it("passes rating and id as params in correct order", async () => {
		mockExecute.mockResolvedValueOnce(undefined as never);

		await rateTemplate("tpl-2", 3);

		const callArgs = mockExecute.mock.calls[0];
		const params = callArgs?.[1];
		expect(Array.isArray(params) ? params[0] : undefined).toBe(3);
		expect(Array.isArray(params) ? params[1] : undefined).toBe("tpl-2");
	});
});
