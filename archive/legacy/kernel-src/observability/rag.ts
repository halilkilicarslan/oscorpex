// ---------------------------------------------------------------------------
// Observability — RAG (Retrieval Augmented Generation)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { execute, query, queryOne } from "../studio/pg.js";

interface RagKnowledgeBase {
	id: string;
	name: string;
	description: string;
	type: string;
	embedding_model: string;
	chunk_size: number;
	chunk_overlap: number;
	status: string;
	document_count: number;
	total_chunks: number;
	last_indexed_at: string | null;
	created_at: string;
	updated_at: string;
}

interface RagDocument {
	id: string;
	kb_id: string;
	name: string;
	source: string;
	content_preview: string;
	chunk_count: number;
	size_bytes: number;
	status: string;
	metadata: string;
	created_at: string;
}

interface RagQuery {
	id: string;
	kb_id: string | null;
	query: string;
	results_count: number;
	latency_ms: number | null;
	agent_id: string | null;
	created_at: string;
}

export const ragRoutes = new Hono();

// GET /api/observability/rag/knowledge-bases/stats — MUST be before /:id
ragRoutes.get("/rag/knowledge-bases/stats", async (c) => {
	const [kbRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM rag_knowledge_bases");
	const totalKBs = Number(kbRow?.n ?? 0);

	const [docRow] = await query<{ n: string }>("SELECT COALESCE(SUM(document_count),0) as n FROM rag_knowledge_bases");
	const totalDocuments = Number(docRow?.n ?? 0);

	const [chunkRow] = await query<{ n: string }>("SELECT COALESCE(SUM(total_chunks),0) as n FROM rag_knowledge_bases");
	const totalChunks = Number(chunkRow?.n ?? 0);

	const [queryCountRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM rag_queries");
	const totalQueries = Number(queryCountRow?.n ?? 0);

	const [latencyRow] = await query<{ avg: number | null }>(
		"SELECT AVG(latency_ms) as avg FROM rag_queries WHERE latency_ms IS NOT NULL",
	);
	const avgLatency = latencyRow?.avg ? Math.round(latencyRow.avg) : 0;

	const typeRows = await query<{ type: string; cnt: string }>(
		"SELECT type, COUNT(*) as cnt FROM rag_knowledge_bases GROUP BY type",
	);
	const byType: Record<string, number> = {
		text: 0,
		pdf: 0,
		web: 0,
		code: 0,
		csv: 0,
	};
	for (const row of typeRows) {
		byType[row.type] = Number(row.cnt);
	}

	return c.json({
		totalKBs,
		totalDocuments,
		totalChunks,
		totalQueries,
		avgLatency,
		byType,
	});
});

// GET /api/observability/rag/knowledge-bases
ragRoutes.get("/rag/knowledge-bases", async (c) => {
	const rows = await query<RagKnowledgeBase>("SELECT * FROM rag_knowledge_bases ORDER BY created_at DESC");
	return c.json({ knowledgeBases: rows });
});

// POST /api/observability/rag/knowledge-bases
ragRoutes.post("/rag/knowledge-bases", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		description?: string;
		type?: string;
		embedding_model?: string;
		chunk_size?: number;
		chunk_overlap?: number;
	};

	if (!body.name) return c.json({ error: "name is required" }, 400);

	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO rag_knowledge_bases (id, name, description, type, embedding_model, chunk_size, chunk_overlap, status, document_count, total_chunks, last_indexed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 0, 0, NULL, $8, $9)`,
		[
			id,
			body.name,
			body.description ?? "",
			body.type ?? "text",
			body.embedding_model ?? "text-embedding-3-small",
			body.chunk_size ?? 512,
			body.chunk_overlap ?? 50,
			now,
			now,
		],
	);

	const kb = await queryOne<RagKnowledgeBase>("SELECT * FROM rag_knowledge_bases WHERE id = $1", [id]);
	if (!kb) throw new Error("Failed to create knowledge base");
	return c.json(kb, 201);
});

// GET /api/observability/rag/knowledge-bases/:id
ragRoutes.get("/rag/knowledge-bases/:id", async (c) => {
	const id = c.req.param("id");
	const kb = await queryOne<RagKnowledgeBase>("SELECT * FROM rag_knowledge_bases WHERE id = $1", [id]);
	if (!kb) return c.json({ error: "Not found" }, 404);

	const documents = await query<RagDocument>("SELECT * FROM rag_documents WHERE kb_id = $1 ORDER BY created_at DESC", [
		id,
	]);
	return c.json({ ...kb, documents });
});

// PUT /api/observability/rag/knowledge-bases/:id
ragRoutes.put("/rag/knowledge-bases/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<RagKnowledgeBase>("SELECT * FROM rag_knowledge_bases WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const body = (await c.req.json()) as Partial<RagKnowledgeBase>;
	const now = new Date().toISOString();

	await execute(
		`UPDATE rag_knowledge_bases SET
      name = $1,
      description = $2,
      type = $3,
      embedding_model = $4,
      chunk_size = $5,
      chunk_overlap = $6,
      status = $7,
      updated_at = $8
    WHERE id = $9`,
		[
			body.name ?? existing.name,
			body.description ?? existing.description,
			body.type ?? existing.type,
			body.embedding_model ?? existing.embedding_model,
			body.chunk_size ?? existing.chunk_size,
			body.chunk_overlap ?? existing.chunk_overlap,
			body.status ?? existing.status,
			now,
			id,
		],
	);

	const updated = await queryOne<RagKnowledgeBase>("SELECT * FROM rag_knowledge_bases WHERE id = $1", [id]);
	if (!updated) throw new Error("Failed to update knowledge base");
	return c.json(updated);
});

// DELETE /api/observability/rag/knowledge-bases/:id
ragRoutes.delete("/rag/knowledge-bases/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<{ id: string }>("SELECT id FROM rag_knowledge_bases WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	await execute("DELETE FROM rag_documents WHERE kb_id = $1", [id]);
	await execute("DELETE FROM rag_knowledge_bases WHERE id = $1", [id]);
	return c.json({ success: true });
});

// POST /api/observability/rag/knowledge-bases/:id/documents
ragRoutes.post("/rag/knowledge-bases/:id/documents", async (c) => {
	const kbId = c.req.param("id");
	const kb = await queryOne<RagKnowledgeBase>("SELECT * FROM rag_knowledge_bases WHERE id = $1", [kbId]);
	if (!kb) return c.json({ error: "Knowledge base not found" }, 404);

	const body = (await c.req.json()) as {
		name: string;
		source?: string;
		content?: string;
		chunk_count?: number;
		size_bytes?: number;
		metadata?: Record<string, unknown>;
	};

	if (!body.name) return c.json({ error: "name is required" }, 400);

	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const contentPreview = body.content ? body.content.slice(0, 500) : "";
	const chunkCount = body.chunk_count ?? 0;
	const sizeBytes = body.size_bytes ?? (body.content ? new TextEncoder().encode(body.content).length : 0);

	await execute(
		`INSERT INTO rag_documents (id, kb_id, name, source, content_preview, chunk_count, size_bytes, status, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'indexed', $8, $9)`,
		[
			id,
			kbId,
			body.name,
			body.source ?? "",
			contentPreview,
			chunkCount,
			sizeBytes,
			JSON.stringify(body.metadata ?? {}),
			now,
		],
	);

	await execute(
		`UPDATE rag_knowledge_bases SET
      document_count = document_count + 1,
      total_chunks = total_chunks + $1,
      last_indexed_at = $2,
      updated_at = $3
    WHERE id = $4`,
		[chunkCount, now, now, kbId],
	);

	const doc = await queryOne<RagDocument>("SELECT * FROM rag_documents WHERE id = $1", [id]);
	if (!doc) throw new Error("Failed to create RAG document");
	return c.json(doc, 201);
});

// DELETE /api/observability/rag/knowledge-bases/:id/documents/:docId
ragRoutes.delete("/rag/knowledge-bases/:id/documents/:docId", async (c) => {
	const kbId = c.req.param("id");
	const docId = c.req.param("docId");

	const doc = await queryOne<RagDocument>("SELECT * FROM rag_documents WHERE id = $1 AND kb_id = $2", [docId, kbId]);
	if (!doc) return c.json({ error: "Not found" }, 404);

	await execute("DELETE FROM rag_documents WHERE id = $1", [docId]);
	await execute(
		`UPDATE rag_knowledge_bases SET
      document_count = GREATEST(0, document_count - 1),
      total_chunks = GREATEST(0, total_chunks - $1),
      updated_at = $2
    WHERE id = $3`,
		[doc.chunk_count, new Date().toISOString(), kbId],
	);

	return c.json({ success: true });
});

// GET /api/observability/rag/queries
ragRoutes.get("/rag/queries", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const kbId = c.req.query("kb_id");

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (kbId) {
		conditions.push(`q.kb_id = $${params.length + 1}`);
		params.push(kbId);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const [countRow] = await query<{ n: string }>(`SELECT COUNT(*) as n FROM rag_queries q ${where}`, params);
	const total = Number(countRow?.n ?? 0);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rows = await query<RagQuery & { kb_name: string | null }>(
		`SELECT q.*, kb.name as kb_name
     FROM rag_queries q
     LEFT JOIN rag_knowledge_bases kb ON kb.id = q.kb_id
     ${where}
     ORDER BY q.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	return c.json({ queries: rows, total, limit, offset });
});

// POST /api/observability/rag/queries
ragRoutes.post("/rag/queries", async (c) => {
	const body = (await c.req.json()) as {
		kb_id?: string;
		query: string;
		results_count?: number;
		latency_ms?: number;
		agent_id?: string;
	};

	if (!body.query) return c.json({ error: "query is required" }, 400);

	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO rag_queries (id, kb_id, query, results_count, latency_ms, agent_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, body.kb_id ?? null, body.query, body.results_count ?? 0, body.latency_ms ?? null, body.agent_id ?? null, now],
	);

	const q = await queryOne<RagQuery>("SELECT * FROM rag_queries WHERE id = $1", [id]);
	if (!q) throw new Error("Failed to create RAG query");
	return c.json(q, 201);
});

// ---------------------------------------------------------------------------
// RAG — Codebase indexing & search routes
// ---------------------------------------------------------------------------

// POST /api/observability/rag/knowledge-bases/:id/index-codebase
ragRoutes.post("/rag/knowledge-bases/:id/index-codebase", async (c) => {
	const kbId = c.req.param("id");

	const kb = await queryOne<{ id: string }>("SELECT id FROM rag_knowledge_bases WHERE id = $1", [kbId]);
	if (!kb) return c.json({ error: "Knowledge base not found" }, 404);

	const body = (await c.req.json()) as {
		projectPath: string;
		extensions?: string[];
		excludeDirs?: string[];
		maxFileSize?: number;
		chunkSize?: number;
		chunkOverlap?: number;
	};

	if (!body.projectPath) return c.json({ error: "projectPath is required" }, 400);

	const { documentIndexer } = await import("../studio/document-indexer.js");

	try {
		const result = await documentIndexer.indexCodebase({
			projectPath: body.projectPath,
			kbId,
			extensions: body.extensions,
			excludeDirs: body.excludeDirs,
			maxFileSize: body.maxFileSize,
			chunkSize: body.chunkSize,
			chunkOverlap: body.chunkOverlap,
		});

		return c.json(result);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : "Indexing failed";
		return c.json({ error: msg }, 500);
	}
});

// POST /api/observability/rag/knowledge-bases/:id/reindex
ragRoutes.post("/rag/knowledge-bases/:id/reindex", async (c) => {
	const kbId = c.req.param("id");

	const kb = await queryOne<{ id: string }>("SELECT id FROM rag_knowledge_bases WHERE id = $1", [kbId]);
	if (!kb) return c.json({ error: "Knowledge base not found" }, 404);

	const body = (await c.req.json()) as {
		projectPath: string;
		sinceCommit?: string;
	};

	if (!body.projectPath) return c.json({ error: "projectPath is required" }, 400);

	const { documentIndexer } = await import("../studio/document-indexer.js");

	try {
		const result = await documentIndexer.reindexChanged(body.projectPath, kbId, body.sinceCommit);

		return c.json(result);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : "Re-index failed";
		return c.json({ error: msg }, 500);
	}
});

// POST /api/observability/rag/search
ragRoutes.post("/rag/search", async (c) => {
	const body = (await c.req.json()) as {
		kbId: string;
		query: string;
		topK?: number;
		model?: string;
	};

	if (!body.kbId) return c.json({ error: "kbId is required" }, 400);
	if (!body.query) return c.json({ error: "query is required" }, 400);

	const kb = await queryOne<{ id: string }>("SELECT id FROM rag_knowledge_bases WHERE id = $1", [body.kbId]);
	if (!kb) return c.json({ error: "Knowledge base not found" }, 404);

	const { vectorStore } = await import("../studio/vector-store.js");

	const startMs = Date.now();
	let results: unknown[] = [];

	try {
		results = await vectorStore.searchSimilar(body.kbId, body.query, body.topK, body.model);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : "Search failed";
		return c.json({ error: msg }, 500);
	}

	const latencyMs = Date.now() - startMs;

	// Log query to rag_queries table (best-effort — do not fail the response)
	try {
		const queryId = crypto.randomUUID();
		const now = new Date().toISOString();
		await execute(
			`INSERT INTO rag_queries (id, kb_id, query, results_count, latency_ms, agent_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
			[queryId, body.kbId, body.query, results.length, latencyMs, now],
		);
	} catch {
		// best-effort logging
	}

	return c.json({ results, latencyMs });
});
