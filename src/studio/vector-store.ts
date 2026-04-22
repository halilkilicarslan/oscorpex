// ---------------------------------------------------------------------------
// Oscorpex — Vector Store with Embedding Engine
// PostgreSQL + pgvector tabanlı embedding depolama ve native cosine similarity arama.
// text-embedding-3-small → 1536 boyutlu vektörler, pgvector <=> operatörü ile aranır.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { execute, getPool, query, queryOne } from "./pg.js";
import { createLogger } from "./logger.js";
const log = createLogger("vector-store");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
	chunkId: string;
	docId: string;
	kbId: string;
	content: string;
	score: number;
	metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Vector Serialization
// ---------------------------------------------------------------------------

/** number[] → pgvector string formatı: '[0.1,0.2,...]' */
function vectorToString(v: number[]): string {
	return `[${v.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Embedding Functions
// ---------------------------------------------------------------------------

/**
 * Birden fazla metin için toplu embedding üretir.
 * AI SDK v6'nın `embedMany` fonksiyonunu kullanır.
 */
export async function generateEmbeddings(texts: string[], model = "text-embedding-3-small"): Promise<number[][]> {
	if (texts.length === 0) return [];

	const embeddingModel = openai.embedding(model);
	const { embeddings } = await embedMany({
		model: embeddingModel,
		values: texts,
	});
	return embeddings;
}

/**
 * Tek bir metin için embedding üretir.
 * AI SDK v6'nın `embed` fonksiyonunu kullanır.
 */
export async function generateEmbedding(text: string, model = "text-embedding-3-small"): Promise<number[]> {
	const embeddingModel = openai.embedding(model);
	const { embedding } = await embed({ model: embeddingModel, value: text });
	return embedding;
}

// ---------------------------------------------------------------------------
// Text Chunking
// ---------------------------------------------------------------------------

/**
 * Metni örtüşmeli parçalara böler.
 * Mümkün olduğunda cümle sınırlarını (`. ` veya `\n`) kullanır.
 *
 * @param text       - Bölünecek ham metin
 * @param chunkSize  - Maksimum karakter sayısı (varsayılan: 512)
 * @param overlap    - Parçalar arası örtüşme (varsayılan: 50)
 */
export function chunkText(text: string, chunkSize = 512, overlap = 50): string[] {
	if (!text || text.trim().length === 0) return [];

	// Cümle sınırlarına göre bölümlere ayır
	const sentences = text
		.split(/(?<=\. )|(?<=\n)/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	const chunks: string[] = [];
	let current = "";

	for (const sentence of sentences) {
		// Tek cümle bile chunk'tan büyükse zorla böl
		if (sentence.length >= chunkSize) {
			// Mevcut birikimi kaydet
			if (current.trim()) {
				chunks.push(current.trim());
				current = "";
			}
			// Büyük cümleyi karakter bazlı parçala
			let start = 0;
			while (start < sentence.length) {
				const end = start + chunkSize;
				chunks.push(sentence.slice(start, end).trim());
				start = end - overlap;
			}
			continue;
		}

		// Normal durum: cümle eklenince sınırı aşar mı?
		const candidate = current ? `${current} ${sentence}` : sentence;
		if (candidate.length > chunkSize) {
			if (current.trim()) {
				chunks.push(current.trim());
				// Örtüşme: mevcut chunk'un son `overlap` karakterini bir sonrakine taşı
				const tail = current.slice(Math.max(0, current.length - overlap));
				current = tail ? `${tail} ${sentence}` : sentence;
			} else {
				chunks.push(sentence);
				current = "";
			}
		} else {
			current = candidate;
		}
	}

	if (current.trim()) {
		chunks.push(current.trim());
	}

	return chunks.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Bir chunk embedding'ini PostgreSQL'e kaydeder.
 * @returns Yeni kaydın UUID'si
 */
export async function storeEmbedding(
	kbId: string,
	docId: string,
	chunkIndex: number,
	content: string,
	vector: number[],
	metadata?: Record<string, unknown>,
): Promise<string> {
	const id = randomUUID();

	await execute(
		`INSERT INTO rag_embeddings (id, kb_id, doc_id, chunk_index, content, metadata, vector, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[
			id,
			kbId,
			docId,
			chunkIndex,
			content,
			metadata ? JSON.stringify(metadata) : null,
			vectorToString(vector),
			new Date().toISOString(),
		],
	);

	return id;
}

/** Bir dokümana ait tüm embedding'leri siler. */
export async function deleteDocEmbeddings(docId: string): Promise<void> {
	await execute("DELETE FROM rag_embeddings WHERE doc_id = $1", [docId]);
}

/** Bir knowledge base'e ait tüm embedding'leri siler. */
export async function deleteKBEmbeddings(kbId: string): Promise<void> {
	await execute("DELETE FROM rag_embeddings WHERE kb_id = $1", [kbId]);
}

// ---------------------------------------------------------------------------
// Similarity Search
// ---------------------------------------------------------------------------

/**
 * Verilen knowledge base içinde pgvector native cosine similarity ile
 * en yakın chunk'ları bulur.
 *
 * pgvector `<=>` operatörü cosine distance döndürür; `1 - distance = similarity`.
 *
 * @param kbId      - Aranacak knowledge base'in ID'si
 * @param queryText - Arama sorgusu (metin)
 * @param topK      - Döndürülecek maksimum sonuç sayısı (varsayılan: 5)
 * @param model     - Embedding modeli (varsayılan: text-embedding-3-small)
 */
export async function searchSimilar(
	kbId: string,
	queryText: string,
	topK = 5,
	model = "text-embedding-3-small",
): Promise<SearchResult[]> {
	if (!queryText.trim()) return [];

	log.info(`[VectorStore] Searching kbId=${kbId} topK=${topK} query="${queryText.slice(0, 80)}..."`);

	// 1. Sorgu embedding'i üret
	const queryVector = await generateEmbedding(queryText, model);

	// 2. pgvector native cosine distance ile en yakın chunk'ları getir
	const rows = await query<{
		id: string;
		doc_id: string;
		kb_id: string;
		content: string;
		metadata: string | null;
		score: number;
	}>(
		`SELECT id, doc_id, kb_id, content, metadata,
		        1 - (vector <=> $1::vector) AS score
		 FROM rag_embeddings
		 WHERE kb_id = $2
		 ORDER BY vector <=> $1::vector
		 LIMIT $3`,
		[vectorToString(queryVector), kbId, topK],
	);

	if (rows.length === 0) {
		log.info(`[VectorStore] No embeddings found for kbId=${kbId}`);
		return [];
	}

	const results = rows.map((row) => ({
		chunkId: row.id,
		docId: row.doc_id,
		kbId: row.kb_id,
		content: row.content,
		score: row.score,
		metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
	}));

	log.info(
		`[VectorStore] Search complete: ${rows.length} results, top score=${results[0]?.score.toFixed(4) ?? "n/a"}`,
	);

	return results;
}

// ---------------------------------------------------------------------------
// Full Indexing Pipeline
// ---------------------------------------------------------------------------

/**
 * Tam indeksleme pipeline'ı: chunk → embed → store.
 *
 * Dökümanı parçalara böler, toplu embedding üretir ve PostgreSQL'e kaydeder.
 * Mevcut embedding'ler önce silinir (yeniden indeksleme desteği).
 * Tüm insert işlemleri tek bir transaction içinde gerçekleşir.
 *
 * @returns Oluşturulan chunk sayısı
 */
export async function indexDocument(
	kbId: string,
	docId: string,
	content: string,
	chunkSize = 512,
	chunkOverlap = 50,
	model = "text-embedding-3-small",
): Promise<{ chunkCount: number }> {
	if (!content || !content.trim()) {
		log.warn(`[VectorStore] indexDocument called with empty content for docId=${docId}`);
		return { chunkCount: 0 };
	}

	log.info(`[VectorStore] Indexing docId=${docId} kbId=${kbId} model=${model}`);

	// 1. Metni chunk'lara böl
	const chunks = chunkText(content, chunkSize, chunkOverlap);
	if (chunks.length === 0) {
		log.warn(`[VectorStore] No chunks produced for docId=${docId}`);
		return { chunkCount: 0 };
	}

	log.info(`[VectorStore] Generated ${chunks.length} chunks, requesting embeddings...`);

	// 2. Toplu embedding üret
	let embeddings: number[][];
	try {
		embeddings = await generateEmbeddings(chunks, model);
	} catch (err) {
		log.error(`[VectorStore] Embedding API error for docId=${docId}:` + " " + String(err));
		throw err;
	}

	// 3. Transaction içinde: önce mevcut embedding'leri sil, sonra yenilerini ekle
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");

		// Mevcut embedding'leri temizle (yeniden indeksleme)
		await client.query("DELETE FROM rag_embeddings WHERE doc_id = $1", [docId]);

		// Batch insert
		for (let i = 0; i < chunks.length; i++) {
			const id = randomUUID();
			await client.query(
				`INSERT INTO rag_embeddings (id, kb_id, doc_id, chunk_index, content, metadata, vector, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				[id, kbId, docId, i, chunks[i], null, vectorToString(embeddings[i]), new Date().toISOString()],
			);
		}

		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}

	log.info(`[VectorStore] Indexed ${chunks.length} chunks for docId=${docId}`);

	return { chunkCount: chunks.length };
}

// ---------------------------------------------------------------------------
// Default export (convenience object)
// ---------------------------------------------------------------------------

export const vectorStore = {
	generateEmbedding,
	generateEmbeddings,
	chunkText,
	storeEmbedding,
	searchSimilar,
	indexDocument,
	deleteDocEmbeddings,
	deleteKBEmbeddings,
};

export default vectorStore;
