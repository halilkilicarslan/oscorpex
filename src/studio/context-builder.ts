// ---------------------------------------------------------------------------
// Oscorpex — Context Builder
// Enhances agent task prompts with RAG-retrieved codebase context.
// ---------------------------------------------------------------------------

import { searchContext } from "./context-store.js";
import { execute, query, queryOne } from "./pg.js";
import { searchSimilar } from "./vector-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RAGContext {
	relevantChunks: Array<{
		content: string;
		source: string; // filename or doc name
		score: number;
	}>;
	totalTokensEstimate: number;
}

interface KBRow {
	id: string;
	name: string;
}

// ---------------------------------------------------------------------------
// 1. Find Project KB
// ---------------------------------------------------------------------------

/**
 * Find the knowledge base associated with a project by searching rag_knowledge_bases
 * for a KB whose name contains the project name. Uses the studio DB (same DB as
 * rag_* tables — see observability-routes.ts initRagTables which calls pg helpers).
 */
async function findProjectKB(projectId: string): Promise<{ kbId: string; name: string } | null> {
	try {
		// Ensure the table exists (idempotent — mirrors initRagTables guard)
		await execute(`
      CREATE TABLE IF NOT EXISTS rag_knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        type TEXT NOT NULL DEFAULT 'text',
        embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
        chunk_size INTEGER NOT NULL DEFAULT 512,
        chunk_overlap INTEGER NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'active',
        document_count INTEGER NOT NULL DEFAULT 0,
        total_chunks INTEGER NOT NULL DEFAULT 0,
        last_indexed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

		// First try: exact match on project ID stored in description or name
		// Strategy: KB name contains the project id OR the project name.
		// We resolve the project name from the projects table so we can match by name too.
		const projectRow = await queryOne<{ name: string }>("SELECT name FROM projects WHERE id = $1", [projectId]);

		if (!projectRow) {
			return null;
		}

		const projectName = projectRow.name.toLowerCase();

		// Fetch all active KBs and find the best match
		const kbs = await query<KBRow>(`SELECT id, name FROM rag_knowledge_bases WHERE status = 'active'`);

		if (kbs.length === 0) {
			return null;
		}

		// Prefer exact project-id match, then name substring match
		const byId = kbs.find((kb) => kb.name.toLowerCase().includes(projectId.toLowerCase()));
		if (byId) {
			return { kbId: byId.id, name: byId.name };
		}

		const byName = kbs.find((kb) => kb.name.toLowerCase().includes(projectName));
		if (byName) {
			return { kbId: byName.id, name: byName.name };
		}

		return null;
	} catch (err) {
		console.warn("[context-builder] findProjectKB failed:", err);
		return null;
	}
}

// ---------------------------------------------------------------------------
// 2. Build RAG Context
// ---------------------------------------------------------------------------

/**
 * Search the project's knowledge base for chunks relevant to the given task.
 * Returns null when no KB is found or when the vector store is unavailable.
 *
 * @param projectId      Studio project ID
 * @param taskTitle      Task title used as part of the search query
 * @param taskDescription Task description (first 200 chars used in query)
 * @param maxChunks      Maximum number of chunks to retrieve (default: 5)
 * @param maxTokens      Token budget for injected context (default: 4000)
 */
async function buildRAGContext(
	projectId: string,
	taskTitle: string,
	taskDescription: string,
	maxChunks = 5,
	maxTokens = 4000,
): Promise<RAGContext | null> {
	const descriptionSnippet = (taskDescription ?? "").slice(0, 200);
	const searchQuery = [taskTitle, descriptionSnippet].filter(Boolean).join(" — ");

	const relevantChunks: RAGContext["relevantChunks"] = [];
	let usedTokens = 0;

	// 1. Try pgvector RAG from project KB
	const kb = await findProjectKB(projectId);
	if (kb) {
		const candidates = await searchSimilar(kb.kbId, searchQuery, maxChunks);
		const RELEVANCE_THRESHOLD = 0.3;
		const filtered = candidates.filter((c) => c.score >= RELEVANCE_THRESHOLD);

		for (const hit of filtered) {
			const chunkTokens = Math.ceil(hit.content.length / 4);
			const meta = hit.metadata as Record<string, unknown> | undefined;
			const source = String(meta?.source ?? meta?.filename ?? "unknown");

			if (usedTokens + chunkTokens > maxTokens) {
				const allowedChars = (maxTokens - usedTokens) * 4;
				if (allowedChars <= 0) break;
				relevantChunks.push({ content: hit.content.slice(0, allowedChars), source, score: hit.score });
				usedTokens = maxTokens;
				break;
			}

			relevantChunks.push({ content: hit.content, source, score: hit.score });
			usedTokens += chunkTokens;
		}
	}

	// 2. FTS fallback/augment — fill remaining budget with tsvector search
	if (usedTokens < maxTokens) {
		try {
			const ftsResults = await searchContext({
				projectId,
				queries: [taskTitle, descriptionSnippet].filter(Boolean),
				limit: maxChunks,
				maxTokens: maxTokens - usedTokens,
			});

			for (const r of ftsResults) {
				// Avoid duplicates — skip if content already present from RAG
				const isDupe = relevantChunks.some(
					(rc) => rc.source === r.source && rc.content.slice(0, 100) === r.content.slice(0, 100),
				);
				if (isDupe) continue;

				const chunkTokens = Math.ceil(r.content.length / 4);
				if (usedTokens + chunkTokens > maxTokens) break;

				relevantChunks.push({ content: r.content, source: r.source, score: r.rank });
				usedTokens += chunkTokens;
			}
		} catch {
			// FTS unavailable — non-blocking
		}
	}

	if (relevantChunks.length === 0) {
		return null;
	}

	return {
		relevantChunks,
		totalTokensEstimate: usedTokens,
	};
}

// ---------------------------------------------------------------------------
// 3. Format Context for Prompt
// ---------------------------------------------------------------------------

/**
 * Format RAG context as a markdown section ready for prompt injection.
 */
function formatRAGContext(context: RAGContext): string {
	const lines: string[] = [
		"## Relevant Codebase Context (RAG)",
		"",
		"The following code snippets are relevant to your task. Read them carefully before making changes:",
		"",
	];

	for (const chunk of context.relevantChunks) {
		const relevanceLabel = chunk.score.toFixed(2);
		lines.push(`### ${chunk.source} (relevance: ${relevanceLabel})`);
		lines.push("```typescript");
		lines.push(chunk.content);
		lines.push("```");
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { findProjectKB, buildRAGContext, formatRAGContext };
export type { RAGContext };
