// ---------------------------------------------------------------------------
// Oscorpex — Context Store (v4.0)
// FTS-based content indexing + search with chunking algorithms.
// Adapts context-mode's chunking strategies for PostgreSQL tsvector + pg_trgm.
// ---------------------------------------------------------------------------

import {
	cleanupStaleSources,
	deleteContextSource,
	getContextSource,
	insertChunks,
	insertSearchLog,
	listContextSources,
	searchChunks,
	upsertContextSource,
} from "./db.js";
import { execute } from "./pg.js";
import type { ContextContentType, ContextSearchOptions, ContextSearchResult, ContextSource } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHUNK_BYTES = 4096;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MAX_TOKENS = 3000;
const BYTES_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Chunking: Markdown
// ---------------------------------------------------------------------------

interface RawChunk {
	title: string;
	content: string;
	contentType: ContextContentType;
}

export function chunkMarkdown(text: string, sourceLabel: string): RawChunk[] {
	const lines = text.split("\n");
	const chunks: RawChunk[] = [];
	const headingStack: string[] = [];
	let currentLines: string[] = [];
	let inCodeBlock = false;

	function flush() {
		if (currentLines.length === 0) return;
		const content = currentLines.join("\n").trim();
		if (!content) {
			currentLines = [];
			return;
		}
		const title = headingStack.length > 0 ? headingStack.join(" > ") : sourceLabel;
		const contentType: ContextContentType = content.includes("```") ? "code" : "prose";

		// Split oversized chunks at paragraph boundaries
		if (Buffer.byteLength(content, "utf-8") > MAX_CHUNK_BYTES) {
			const subChunks = splitOversized(content, title, contentType);
			chunks.push(...subChunks);
		} else {
			chunks.push({ title, content, contentType });
		}
		currentLines = [];
	}

	for (const line of lines) {
		// Track code block boundaries
		if (line.trimStart().startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			currentLines.push(line);
			continue;
		}

		// Don't split inside code blocks
		if (inCodeBlock) {
			currentLines.push(line);
			continue;
		}

		// Heading detection (H1-H4)
		const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
		if (headingMatch) {
			flush();
			const level = headingMatch[1].length;
			const headingText = headingMatch[2].trim();
			// Maintain hierarchical heading stack
			while (headingStack.length >= level) headingStack.pop();
			headingStack.push(headingText);
			currentLines.push(line);
			continue;
		}

		currentLines.push(line);
	}

	flush();
	return chunks;
}

function splitOversized(content: string, title: string, contentType: ContextContentType): RawChunk[] {
	const paragraphs = content.split(/\n\n+/);
	const results: RawChunk[] = [];
	let buffer: string[] = [];
	let bufferBytes = 0;
	let partNum = 1;

	for (const para of paragraphs) {
		const paraBytes = Buffer.byteLength(para, "utf-8");
		if (bufferBytes + paraBytes > MAX_CHUNK_BYTES && buffer.length > 0) {
			results.push({ title: `${title} (${partNum})`, content: buffer.join("\n\n"), contentType });
			buffer = [];
			bufferBytes = 0;
			partNum++;
		}
		buffer.push(para);
		bufferBytes += paraBytes;
	}

	if (buffer.length > 0) {
		const suffix = partNum > 1 ? ` (${partNum})` : "";
		results.push({ title: `${title}${suffix}`, content: buffer.join("\n\n"), contentType });
	}

	return results;
}

// ---------------------------------------------------------------------------
// Chunking: JSON
// ---------------------------------------------------------------------------

export function chunkJSON(text: string, sourceLabel: string): RawChunk[] {
	try {
		const obj = JSON.parse(text);
		return chunkJSONValue(obj, sourceLabel);
	} catch {
		// Fallback to plain text chunking if JSON is invalid
		return chunkPlainText(text, sourceLabel);
	}
}

function chunkJSONValue(value: unknown, keyPath: string): RawChunk[] {
	if (Array.isArray(value)) {
		return chunkJSONArray(value, keyPath);
	}
	if (value !== null && typeof value === "object") {
		return chunkJSONObject(value as Record<string, unknown>, keyPath);
	}
	// Scalar: single chunk
	return [{ title: keyPath, content: JSON.stringify(value, null, 2), contentType: "prose" }];
}

function chunkJSONObject(obj: Record<string, unknown>, keyPath: string): RawChunk[] {
	const serialized = JSON.stringify(obj, null, 2);

	// Flat object that fits in one chunk
	if (Buffer.byteLength(serialized, "utf-8") <= MAX_CHUNK_BYTES) {
		return [{ title: keyPath, content: serialized, contentType: "prose" }];
	}

	// Recurse into nested keys
	const chunks: RawChunk[] = [];
	for (const [key, val] of Object.entries(obj)) {
		chunks.push(...chunkJSONValue(val, `${keyPath}.${key}`));
	}
	return chunks;
}

function chunkJSONArray(arr: unknown[], keyPath: string): RawChunk[] {
	const serialized = JSON.stringify(arr, null, 2);

	if (Buffer.byteLength(serialized, "utf-8") <= MAX_CHUNK_BYTES) {
		return [{ title: keyPath, content: serialized, contentType: "prose" }];
	}

	// Batch array items using identity fields
	const identityFields = ["id", "name", "title", "path", "slug"];
	const chunks: RawChunk[] = [];
	let batch: unknown[] = [];
	let batchBytes = 0;
	let batchNum = 1;

	for (const item of arr) {
		const itemStr = JSON.stringify(item, null, 2);
		const itemBytes = Buffer.byteLength(itemStr, "utf-8");

		if (batchBytes + itemBytes > MAX_CHUNK_BYTES && batch.length > 0) {
			const batchTitle = buildArrayBatchTitle(batch, keyPath, batchNum, identityFields);
			chunks.push({ title: batchTitle, content: JSON.stringify(batch, null, 2), contentType: "prose" });
			batch = [];
			batchBytes = 0;
			batchNum++;
		}

		batch.push(item);
		batchBytes += itemBytes;
	}

	if (batch.length > 0) {
		const batchTitle = buildArrayBatchTitle(batch, keyPath, batchNum, identityFields);
		chunks.push({ title: batchTitle, content: JSON.stringify(batch, null, 2), contentType: "prose" });
	}

	return chunks;
}

function buildArrayBatchTitle(batch: unknown[], keyPath: string, batchNum: number, identityFields: string[]): string {
	const first = batch[0];
	if (first && typeof first === "object" && first !== null) {
		for (const field of identityFields) {
			const val = (first as Record<string, unknown>)[field];
			if (typeof val === "string") {
				return `${keyPath}[${val}…]`;
			}
		}
	}
	return `${keyPath}[batch ${batchNum}]`;
}

// ---------------------------------------------------------------------------
// Chunking: Plain Text
// ---------------------------------------------------------------------------

export function chunkPlainText(text: string, sourceLabel: string): RawChunk[] {
	if (!text.trim()) return [];

	// Try blank-line split first
	const sections = text.split(/\n\n+/).filter((s) => s.trim());

	if (sections.length >= 3 && sections.length <= 200) {
		const chunks: RawChunk[] = [];
		let partNum = 1;
		let buffer: string[] = [];
		let bufferBytes = 0;

		for (const section of sections) {
			const sectionBytes = Buffer.byteLength(section, "utf-8");
			if (bufferBytes + sectionBytes > MAX_CHUNK_BYTES && buffer.length > 0) {
				chunks.push({
					title: `${sourceLabel} (${partNum})`,
					content: buffer.join("\n\n"),
					contentType: "prose",
				});
				buffer = [];
				bufferBytes = 0;
				partNum++;
			}
			buffer.push(section);
			bufferBytes += sectionBytes;
		}

		if (buffer.length > 0) {
			const suffix = partNum > 1 ? ` (${partNum})` : "";
			chunks.push({ title: `${sourceLabel}${suffix}`, content: buffer.join("\n\n"), contentType: "prose" });
		}

		return chunks;
	}

	// Fallback: fixed-size line groups with 2-line overlap
	const lines = text.split("\n").filter((l) => l.trim());
	if (lines.length === 0) return [];

	const groupSize = 20;
	const overlap = 2;
	const chunks: RawChunk[] = [];

	for (let i = 0; i < lines.length; i += groupSize - overlap) {
		const slice = lines.slice(i, i + groupSize);
		if (slice.length === 0) break;
		chunks.push({
			title: `${sourceLabel} (lines ${i + 1}-${i + slice.length})`,
			content: slice.join("\n"),
			contentType: "prose",
		});
	}

	return chunks;
}

// ---------------------------------------------------------------------------
// Auto-detect content type
// ---------------------------------------------------------------------------

function detectContentType(content: string): "markdown" | "json" | "plain" {
	const trimmed = content.trimStart();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			JSON.parse(trimmed);
			return "json";
		} catch {
			// not valid JSON
		}
	}
	if (/^#{1,4}\s/m.test(content) || /^```/m.test(content)) {
		return "markdown";
	}
	return "plain";
}

// ---------------------------------------------------------------------------
// Public API: Index Content
// ---------------------------------------------------------------------------

export async function indexContent(
	projectId: string,
	content: string,
	sourceLabel: string,
	type?: "markdown" | "json" | "plain",
): Promise<number> {
	const contentType = type ?? detectContentType(content);

	let rawChunks: RawChunk[];
	switch (contentType) {
		case "markdown":
			rawChunks = chunkMarkdown(content, sourceLabel);
			break;
		case "json":
			rawChunks = chunkJSON(content, sourceLabel);
			break;
		default:
			rawChunks = chunkPlainText(content, sourceLabel);
			break;
	}

	if (rawChunks.length === 0) return 0;

	const codeCount = rawChunks.filter((c) => c.contentType === "code").length;

	// Upsert the source record
	const source = await upsertContextSource(projectId, sourceLabel, rawChunks.length, codeCount);

	// Re-fetch source to get the actual ID (upsert may return new or existing)
	const existing = await getContextSource(projectId, sourceLabel);
	const sourceId = existing?.id ?? source.id;

	// Insert chunks
	return insertChunks(sourceId, rawChunks);
}

// ---------------------------------------------------------------------------
// Public API: Search Context
// ---------------------------------------------------------------------------

export async function searchContext(opts: ContextSearchOptions): Promise<ContextSearchResult[]> {
	const { projectId, queries, limit = DEFAULT_SEARCH_LIMIT, maxTokens = DEFAULT_MAX_TOKENS } = opts;
	const searchStart = Date.now();

	// Merge results from all queries via RRF
	const allResults: ContextSearchResult[] = [];
	for (const q of queries) {
		const qStart = Date.now();
		const results = await searchChunks(projectId, q, {
			limit,
			source: opts.source,
			contentType: opts.contentType,
		});
		allResults.push(...results);

		// v4.1: Log individual query for observability
		const topRank = results.length > 0 ? Math.max(...results.map((r) => r.rank)) : null;
		insertSearchLog(projectId, q, results.length, topRank, Date.now() - qStart, opts.source, opts.contentType).catch(
			() => {},
		);
	}

	// Deduplicate by title+source, keep highest rank
	const deduped = new Map<string, ContextSearchResult>();
	for (const r of allResults) {
		const key = `${r.source}::${r.title}`;
		const existing = deduped.get(key);
		if (!existing || r.rank > existing.rank) {
			deduped.set(key, r);
		}
	}

	// Sort by rank, apply token budget
	const sorted = Array.from(deduped.values()).sort((a, b) => b.rank - a.rank);
	const results: ContextSearchResult[] = [];
	let tokenBudget = maxTokens;

	for (const r of sorted) {
		const tokens = Math.ceil(Buffer.byteLength(r.content, "utf-8") / BYTES_PER_TOKEN);
		if (tokens > tokenBudget) continue;
		tokenBudget -= tokens;
		results.push(r);
		if (results.length >= limit) break;
	}

	// Track search call + hits (non-blocking)
	recordSearchMetrics(projectId, results.length).catch(() => {});

	return results;
}

// ---------------------------------------------------------------------------
// Search Tracking
// ---------------------------------------------------------------------------

async function recordSearchMetrics(projectId: string, hitCount: number): Promise<void> {
	await execute(
		`
		INSERT INTO context_search_stats (project_id, search_calls, search_hits)
		VALUES ($1, 1, $2)
		ON CONFLICT (project_id)
		DO UPDATE SET search_calls = context_search_stats.search_calls + 1,
		             search_hits = context_search_stats.search_hits + EXCLUDED.search_hits
		`,
		[projectId, hitCount],
	);
}

// ---------------------------------------------------------------------------
// Public API: Cleanup
// ---------------------------------------------------------------------------

export async function cleanupStale(projectId: string, maxAgeDays = 7): Promise<number> {
	return cleanupStaleSources(projectId, maxAgeDays);
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { getContextSource, listContextSources, deleteContextSource };
