// ---------------------------------------------------------------------------
// Oscorpex — Marketplace Repo Tests (V6 M6 F6)
// Tests for DB CRUD functions in marketplace-repo.ts
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock pg module before importing
vi.mock("../pg.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
}));

import {
	countMarketplaceItems,
	createMarketplaceItem,
	deleteMarketplaceItem,
	getMarketplaceItem,
	incrementDownloads,
	listMarketplaceItems,
	rateMarketplaceItem,
	updateMarketplaceItem,
} from "../db/marketplace-repo.js";
import * as pg from "../pg.js";

const mockQuery = vi.mocked(pg.query);
const mockQueryOne = vi.mocked(pg.queryOne);
const mockExecute = vi.mocked(pg.execute);

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleRow = {
	id: "item-1",
	type: "agent",
	name: "Super Code Agent",
	description: "An agent for writing clean code",
	author: "alice",
	author_id: "user-alice",
	category: "backend",
	tags: ["typescript", "api"],
	config: { model: "claude-sonnet", role: "backend-dev" },
	downloads: 42,
	rating: 4.5,
	rating_count: 10,
	is_verified: true,
	created_at: "2026-04-20T00:00:00Z",
	updated_at: "2026-04-20T00:00:00Z",
};

const sampleTemplateRow = {
	...sampleRow,
	id: "item-2",
	type: "template",
	name: "Full-Stack Starter",
	category: "fullstack",
	tags: ["react", "node"],
	downloads: 100,
	rating: 3.8,
	rating_count: 25,
	is_verified: false,
};

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createMarketplaceItem
// ---------------------------------------------------------------------------

describe("createMarketplaceItem", () => {
	it("inserts item and returns mapped object", async () => {
		mockQueryOne.mockResolvedValueOnce(sampleRow);

		const result = await createMarketplaceItem({
			type: "agent",
			name: "Super Code Agent",
			description: "An agent for writing clean code",
			author: "alice",
			authorId: "user-alice",
			category: "backend",
			tags: ["typescript", "api"],
			config: { model: "claude-sonnet" },
		});

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO marketplace_items"),
			expect.arrayContaining(["agent", "Super Code Agent"]),
		);
		expect(result.id).toBe("item-1");
		expect(result.name).toBe("Super Code Agent");
		expect(result.type).toBe("agent");
		expect(result.author).toBe("alice");
		expect(result.isVerified).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// listMarketplaceItems
// ---------------------------------------------------------------------------

describe("listMarketplaceItems", () => {
	it("returns all items when no filters", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow, sampleTemplateRow]);

		const result = await listMarketplaceItems();

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("SELECT * FROM marketplace_items"),
			expect.arrayContaining([50, 0]),
		);
		expect(result).toHaveLength(2);
	});

	it("filters by type", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		const result = await listMarketplaceItems({ type: "agent" });

		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("type = $"), expect.arrayContaining(["agent"]));
		expect(result[0].type).toBe("agent");
	});

	it("filters by category", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		const result = await listMarketplaceItems({ category: "backend" });

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("category = $"),
			expect.arrayContaining(["backend"]),
		);
		expect(result[0].category).toBe("backend");
	});

	it("filters by search term (ILIKE)", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		await listMarketplaceItems({ search: "code" });

		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("ILIKE"), expect.arrayContaining(["%code%"]));
	});

	it("filters by tags using JSONB contains", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		await listMarketplaceItems({ tags: ["typescript"] });

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("tags @>"),
			expect.arrayContaining(['["typescript"]']),
		);
	});

	it("sorts by downloads DESC (popular)", async () => {
		mockQuery.mockResolvedValueOnce([sampleTemplateRow, sampleRow]);

		await listMarketplaceItems({ sort: "downloads" });

		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("downloads DESC"), expect.any(Array));
	});

	it("sorts by rating DESC (top rated)", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		await listMarketplaceItems({ sort: "rating" });

		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("rating DESC"), expect.any(Array));
	});

	it("sorts by newest (created_at DESC)", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		await listMarketplaceItems({ sort: "newest" });

		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("created_at DESC"), expect.any(Array));
	});

	it("applies pagination limit and offset", async () => {
		mockQuery.mockResolvedValueOnce([sampleRow]);

		await listMarketplaceItems({ limit: 10, offset: 20 });

		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT"), expect.arrayContaining([10, 20]));
	});

	it("returns empty array when no items match", async () => {
		mockQuery.mockResolvedValueOnce([]);

		const result = await listMarketplaceItems({ type: "agent", category: "ml" });

		expect(result).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// getMarketplaceItem
// ---------------------------------------------------------------------------

describe("getMarketplaceItem", () => {
	it("returns item by id", async () => {
		mockQueryOne.mockResolvedValueOnce(sampleRow);

		const result = await getMarketplaceItem("item-1");

		expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1"), ["item-1"]);
		expect(result).not.toBeNull();
		expect(result!.id).toBe("item-1");
	});

	it("returns null when not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);

		const result = await getMarketplaceItem("nonexistent");
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// updateMarketplaceItem
// ---------------------------------------------------------------------------

describe("updateMarketplaceItem", () => {
	it("updates fields and returns updated item", async () => {
		const updated = { ...sampleRow, name: "Updated Agent" };
		mockQueryOne.mockResolvedValueOnce(updated);

		const result = await updateMarketplaceItem("item-1", { name: "Updated Agent" });

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE marketplace_items"),
			expect.arrayContaining(["Updated Agent"]),
		);
		expect(result!.name).toBe("Updated Agent");
	});

	it("falls back to getMarketplaceItem when no fields given", async () => {
		mockQueryOne.mockResolvedValueOnce(sampleRow);

		const result = await updateMarketplaceItem("item-1", {});
		expect(result).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// deleteMarketplaceItem
// ---------------------------------------------------------------------------

describe("deleteMarketplaceItem", () => {
	it("returns true when item deleted", async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockExecute as any).mockResolvedValueOnce({ rowCount: 1 });

		const result = await deleteMarketplaceItem("item-1");
		expect(result).toBe(true);
	});

	it("returns false when item not found", async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockExecute as any).mockResolvedValueOnce({ rowCount: 0 });

		const result = await deleteMarketplaceItem("nonexistent");
		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// incrementDownloads
// ---------------------------------------------------------------------------

describe("incrementDownloads", () => {
	it("increments download count and returns updated item", async () => {
		const updated = { ...sampleRow, downloads: 43 };
		mockQueryOne.mockResolvedValueOnce(updated);

		const result = await incrementDownloads("item-1");

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("downloads = downloads + 1"),
			expect.arrayContaining(["item-1"]),
		);
		expect(result!.downloads).toBe(43);
	});

	it("returns null when item not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);

		const result = await incrementDownloads("nonexistent");
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// rateMarketplaceItem
// ---------------------------------------------------------------------------

describe("rateMarketplaceItem", () => {
	it("updates weighted average rating", async () => {
		// Original: rating=4.5, count=10 → new rating=(4.5*10+5)/11 ≈ 4.545
		const updated = { ...sampleRow, rating: 4.545, rating_count: 11 };
		mockQueryOne.mockResolvedValueOnce(updated);

		const result = await rateMarketplaceItem("item-1", 5);

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("rating * rating_count"),
			expect.arrayContaining([5]),
		);
		expect(result!.rating).toBeCloseTo(4.545, 2);
		expect(result!.ratingCount).toBe(11);
	});

	it("returns null when item not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);

		const result = await rateMarketplaceItem("nonexistent", 4);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// countMarketplaceItems
// ---------------------------------------------------------------------------

describe("countMarketplaceItems", () => {
	it("returns total count without filters", async () => {
		mockQueryOne.mockResolvedValueOnce({ count: "5" });

		const count = await countMarketplaceItems();

		expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("COUNT(*)"), []);
		expect(count).toBe(5);
	});

	it("returns count with type filter", async () => {
		mockQueryOne.mockResolvedValueOnce({ count: "3" });

		const count = await countMarketplaceItems({ type: "agent" });

		expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("type = $"), expect.arrayContaining(["agent"]));
		expect(count).toBe(3);
	});

	it("returns 0 when no items match", async () => {
		mockQueryOne.mockResolvedValueOnce({ count: "0" });

		const count = await countMarketplaceItems({ category: "nonexistent" });
		expect(count).toBe(0);
	});
});
