// ---------------------------------------------------------------------------
// Oscorpex — Context Store Tests (v4.0)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { chunkMarkdown, chunkPlainText } from "../context-store.js";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
});

vi.mock("../db.js", () => ({
	upsertContextSource: vi.fn().mockResolvedValue({
		id: "src-1",
		projectId: "p1",
		label: "test-source",
		chunkCount: 0,
		codeChunkCount: 0,
		indexedAt: "2026-04-17T00:00:00.000Z",
	}),
	getContextSource: vi.fn().mockResolvedValue({
		id: "src-1",
		projectId: "p1",
		label: "test-source",
		chunkCount: 0,
		codeChunkCount: 0,
		indexedAt: "2026-04-17T00:00:00.000Z",
	}),
	insertChunks: vi.fn().mockResolvedValue(3),
	searchChunks: vi.fn().mockResolvedValue([]),
	listContextSources: vi.fn().mockResolvedValue([]),
	deleteContextSource: vi.fn().mockResolvedValue(undefined),
	cleanupStaleSources: vi.fn().mockResolvedValue(2),
}));

// ---------------------------------------------------------------------------
// Markdown Chunking
// ---------------------------------------------------------------------------

describe("chunkMarkdown", () => {
	it("should split on headings", () => {
		const md = `# Introduction
Some intro text.

## Setup
Setup instructions.

## Usage
Usage details.`;

		const chunks = chunkMarkdown(md, "doc");
		expect(chunks.length).toBe(3);
		expect(chunks[0].title).toBe("Introduction");
		expect(chunks[1].title).toBe("Introduction > Setup");
		expect(chunks[2].title).toBe("Introduction > Usage");
	});

	it("should preserve code blocks intact", () => {
		const md = `# Code Example

\`\`\`typescript
function hello() {
  console.log("world");
}
\`\`\`

Some text after.`;

		const chunks = chunkMarkdown(md, "doc");
		expect(chunks.length).toBe(1);
		expect(chunks[0].content).toContain("```typescript");
		expect(chunks[0].content).toContain("```");
		expect(chunks[0].contentType).toBe("code");
	});

	it("should handle hierarchical heading stack (H1 > H2 > H3)", () => {
		const md = `# Top
## Mid
### Deep
Content here.`;

		const chunks = chunkMarkdown(md, "doc");
		const lastChunk = chunks[chunks.length - 1];
		expect(lastChunk.title).toBe("Top > Mid > Deep");
	});

	it("should split oversized chunks at paragraph boundaries", () => {
		const bigParagraph = "A".repeat(2000);
		const md = `# Big Section

${bigParagraph}

${bigParagraph}

${bigParagraph}`;

		const chunks = chunkMarkdown(md, "doc");
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(Buffer.byteLength(chunk.content, "utf-8")).toBeLessThanOrEqual(4096 + 100); // small tolerance
		}
	});

	it("should return empty array for empty content", () => {
		const chunks = chunkMarkdown("", "doc");
		expect(chunks).toEqual([]);
	});

	it("should handle content with no headings", () => {
		const chunks = chunkMarkdown("Just plain text.\nMore text.", "my-source");
		expect(chunks.length).toBe(1);
		expect(chunks[0].title).toBe("my-source");
	});
});

// ---------------------------------------------------------------------------
// Plain Text Chunking
// ---------------------------------------------------------------------------

describe("chunkPlainText", () => {
	it("should split on blank lines when 3-200 sections", () => {
		const text = Array.from({ length: 5 }, (_, i) => `Section ${i + 1} content.`).join("\n\n");
		const chunks = chunkPlainText(text, "log");
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		expect(chunks[0].title).toContain("log");
	});

	it("should use fixed-size groups for very many sections", () => {
		const text = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`).join("\n");
		const chunks = chunkPlainText(text, "big-log");
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks[0].title).toContain("lines");
	});

	it("should handle empty text", () => {
		const chunks = chunkPlainText("", "empty");
		expect(chunks.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// JSON Chunking
// ---------------------------------------------------------------------------

describe("chunkJSON", () => {
	// Use dynamic import to test chunkJSON since it depends on internal functions
	let chunkJSON: typeof import("../context-store.js").chunkJSON;

	beforeEach(async () => {
		const mod = await import("../context-store.js");
		chunkJSON = mod.chunkJSON;
	});

	it("should handle a small flat object as single chunk", () => {
		const json = JSON.stringify({ name: "test", value: 42 });
		const chunks = chunkJSON(json, "config");
		expect(chunks.length).toBe(1);
		expect(chunks[0].title).toBe("config");
	});

	it("should recurse into nested objects", () => {
		const obj: Record<string, unknown> = {};
		for (let i = 0; i < 20; i++) {
			obj[`key${i}`] = { nested: "A".repeat(300) };
		}
		const json = JSON.stringify(obj);
		const chunks = chunkJSON(json, "big-config");
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("should batch array items", () => {
		const arr = Array.from({ length: 50 }, (_, i) => ({
			id: `item-${i}`,
			description: "B".repeat(200),
		}));
		const json = JSON.stringify(arr);
		const chunks = chunkJSON(json, "items");
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("should fallback to plain text on invalid JSON", () => {
		const chunks = chunkJSON("not valid json {", "bad");
		expect(chunks.length).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// Index + Search (mocked DB)
// ---------------------------------------------------------------------------

describe("indexContent", () => {
	let indexContent: typeof import("../context-store.js").indexContent;
	let upsertContextSource: ReturnType<typeof vi.fn>;
	let insertChunks: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const mod = await import("../context-store.js");
		indexContent = mod.indexContent;

		const db = await import("../db.js");
		upsertContextSource = db.upsertContextSource as ReturnType<typeof vi.fn>;
		insertChunks = db.insertChunks as ReturnType<typeof vi.fn>;
	});

	it("should detect markdown and index chunks", async () => {
		const md = `# Hello\nWorld\n## Section\nContent`;
		const count = await indexContent("p1", md, "readme");

		expect(upsertContextSource).toHaveBeenCalledWith("p1", "readme", expect.any(Number), expect.any(Number));
		expect(insertChunks).toHaveBeenCalled();
		expect(count).toBe(3); // mocked return
	});

	it("should detect JSON and index chunks", async () => {
		const json = JSON.stringify({ key: "value" });
		const count = await indexContent("p1", json, "config", "json");

		expect(upsertContextSource).toHaveBeenCalled();
		expect(count).toBe(3);
	});

	it("should return 0 for empty content", async () => {
		const count = await indexContent("p1", "", "empty");
		expect(count).toBe(0);
	});
});

describe("searchContext", () => {
	let searchContext: typeof import("../context-store.js").searchContext;
	let searchChunks: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const mod = await import("../context-store.js");
		searchContext = mod.searchContext;

		const db = await import("../db.js");
		searchChunks = db.searchChunks as ReturnType<typeof vi.fn>;
	});

	it("should call searchChunks for each query", async () => {
		searchChunks.mockResolvedValue([
			{
				title: "Auth Middleware",
				content: "exports auth middleware...",
				source: "task:1",
				rank: 0.5,
				contentType: "code",
				matchLayer: "tsvector",
			},
		]);

		const results = await searchContext({
			projectId: "p1",
			queries: ["authentication", "middleware"],
		});

		expect(searchChunks).toHaveBeenCalledTimes(2);
		expect(results.length).toBe(1); // deduplicated
	});

	it("should respect token budget", async () => {
		searchChunks.mockResolvedValue([
			{
				title: "Big Chunk",
				content: "X".repeat(20_000), // ~5000 tokens
				source: "task:1",
				rank: 0.8,
				contentType: "prose",
				matchLayer: "tsvector",
			},
		]);

		const results = await searchContext({
			projectId: "p1",
			queries: ["test"],
			maxTokens: 1000, // budget too small
		});

		expect(results.length).toBe(0);
	});

	it("should return empty for no matches", async () => {
		searchChunks.mockResolvedValue([]);
		const results = await searchContext({ projectId: "p1", queries: ["nonexistent"] });
		expect(results.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe("cleanupStale", () => {
	it("should delegate to cleanupStaleSources", async () => {
		const { cleanupStale } = await import("../context-store.js");
		const { cleanupStaleSources } = await import("../db.js");

		const count = await cleanupStale("p1", 14);
		expect(cleanupStaleSources).toHaveBeenCalledWith("p1", 14);
		expect(count).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Source re-index (dedup)
// ---------------------------------------------------------------------------

describe("source re-index dedup", () => {
	it("should upsert same label without creating duplicate", async () => {
		const { indexContent } = await import("../context-store.js");
		const { upsertContextSource } = await import("../db.js");

		await indexContent("p1", "# First\nContent", "same-label");
		await indexContent("p1", "# Updated\nNew content", "same-label");

		const calls = (upsertContextSource as ReturnType<typeof vi.fn>).mock.calls;
		const labelCalls = calls.filter((c) => c[1] === "same-label");
		expect(labelCalls.length).toBe(2); // both called upsert (ON CONFLICT updates)
	});
});
