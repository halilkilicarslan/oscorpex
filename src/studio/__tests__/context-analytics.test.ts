// ---------------------------------------------------------------------------
// Oscorpex — Context Analytics Tests (v4.0 Faz 4)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getContextMetrics, getPerTaskContextMetrics } from "../context-analytics.js";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
	listContextSources: vi.fn().mockResolvedValue([]),
}));

vi.mock("../pg.js", () => ({
	query: vi.fn().mockResolvedValue([]),
	queryOne: vi.fn().mockResolvedValue({ total_bytes: "0", cnt: "0" }),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getContextMetrics
// ---------------------------------------------------------------------------

describe("getContextMetrics", () => {
	let listContextSources: ReturnType<typeof vi.fn>;
	let queryFn: ReturnType<typeof vi.fn>;
	let queryOneFn: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const db = await import("../db.js");
		listContextSources = db.listContextSources as ReturnType<typeof vi.fn>;

		const pg = await import("../pg.js");
		queryFn = pg.query as ReturnType<typeof vi.fn>;
		queryOneFn = pg.queryOne as ReturnType<typeof vi.fn>;

		// Reset defaults
		listContextSources.mockResolvedValue([]);
		queryFn.mockResolvedValue([]);
		queryOneFn.mockResolvedValue({ total_bytes: "0", cnt: "0" });
	});

	it("should return zero metrics for empty project", async () => {
		const metrics = await getContextMetrics("p1");

		expect(metrics.totalSources).toBe(0);
		expect(metrics.totalChunks).toBe(0);
		expect(metrics.codeChunks).toBe(0);
		expect(metrics.proseChunks).toBe(0);
		expect(metrics.totalEvents).toBe(0);
		expect(metrics.estimatedTokensIndexed).toBe(0);
	});

	it("should compute metrics from sources", async () => {
		listContextSources.mockResolvedValue([
			{ id: "s1", projectId: "p1", label: "task:t1:Auth", chunkCount: 5, codeChunkCount: 3, indexedAt: "2026-04-17" },
			{ id: "s2", projectId: "p1", label: "task:t2:DB", chunkCount: 3, codeChunkCount: 1, indexedAt: "2026-04-17" },
		]);

		// First queryOne: total_bytes, second: event count
		queryOneFn
			.mockResolvedValueOnce({ total_bytes: "16000" })
			.mockResolvedValueOnce({ cnt: "25" });

		// query: events by category
		queryFn.mockResolvedValueOnce([
			{ category: "task", cnt: "15" },
			{ category: "error", cnt: "10" },
		]);

		const metrics = await getContextMetrics("p1");

		expect(metrics.totalSources).toBe(2);
		expect(metrics.totalChunks).toBe(8);
		expect(metrics.codeChunks).toBe(4);
		expect(metrics.proseChunks).toBe(4);
		expect(metrics.totalEvents).toBe(25);
		expect(metrics.eventsByCategory).toEqual({ task: 15, error: 10 });
		expect(metrics.estimatedTokensIndexed).toBe(4000); // 16000 / 4
	});
});

// ---------------------------------------------------------------------------
// getPerTaskContextMetrics
// ---------------------------------------------------------------------------

describe("getPerTaskContextMetrics", () => {
	let listContextSources: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const db = await import("../db.js");
		listContextSources = db.listContextSources as ReturnType<typeof vi.fn>;
		listContextSources.mockResolvedValue([]);
	});

	it("should return empty array for no sources", async () => {
		const result = await getPerTaskContextMetrics("p1");
		expect(result).toEqual([]);
	});

	it("should filter and parse task sources", async () => {
		listContextSources.mockResolvedValue([
			{ id: "s1", projectId: "p1", label: "task:t1:Auth System", chunkCount: 5, codeChunkCount: 3, indexedAt: "2026-04-17" },
			{ id: "s2", projectId: "p1", label: "task:t2:DB Setup", chunkCount: 3, codeChunkCount: 1, indexedAt: "2026-04-17" },
			{ id: "s3", projectId: "p1", label: "manual:readme", chunkCount: 2, codeChunkCount: 0, indexedAt: "2026-04-17" },
		]);

		const result = await getPerTaskContextMetrics("p1");

		expect(result.length).toBe(2);
		expect(result[0].taskId).toBe("t1");
		expect(result[0].taskTitle).toBe("Auth System");
		expect(result[0].chunkCount).toBe(5);
		expect(result[1].taskId).toBe("t2");
		expect(result[1].taskTitle).toBe("DB Setup");
	});

	it("should handle task labels with colons in title", async () => {
		listContextSources.mockResolvedValue([
			{ id: "s1", projectId: "p1", label: "task:t1:Fix: auth bug", chunkCount: 2, codeChunkCount: 1, indexedAt: "2026-04-17" },
		]);

		const result = await getPerTaskContextMetrics("p1");

		expect(result[0].taskTitle).toBe("Fix: auth bug");
	});
});
