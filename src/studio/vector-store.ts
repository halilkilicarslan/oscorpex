// ---------------------------------------------------------------------------
// AI Dev Studio — Vector Store with Embedding Engine
// SQLite (better-sqlite3) tabanlı embedding depolama ve cosine similarity arama.
// Harici vektör DB'ye ihtiyaç duymaz; Float32Array → BLOB olarak saklanır.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { getDb } from "./db.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let _tablesInitialised = false;

function ensureTables(): void {
	if (_tablesInitialised) return;
	const db = getDb();
	db.exec(`
    CREATE TABLE IF NOT EXISTS rag_embeddings (
      id           TEXT PRIMARY KEY,
      kb_id        TEXT NOT NULL,
      doc_id       TEXT NOT NULL,
      chunk_index  INTEGER NOT NULL,
      content      TEXT NOT NULL,
      metadata     TEXT,
      vector       BLOB NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rag_emb_kb  ON rag_embeddings(kb_id);
    CREATE INDEX IF NOT EXISTS idx_rag_emb_doc ON rag_embeddings(doc_id);
  `);
	_tablesInitialised = true;
}

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
// Embedding Functions
// ---------------------------------------------------------------------------

/**
 * Birden fazla metin için toplu embedding üretir.
 * AI SDK v6'nın `embedMany` fonksiyonunu kullanır.
 */
export async function generateEmbeddings(
	texts: string[],
	model = "text-embedding-3-small",
): Promise<number[][]> {
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
export async function generateEmbedding(
	text: string,
	model = "text-embedding-3-small",
): Promise<number[]> {
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
export function chunkText(
	text: string,
	chunkSize = 512,
	overlap = 50,
): string[] {
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
// Vector Storage Helpers
// ---------------------------------------------------------------------------

/** number[] → Buffer (Float32Array aracılığıyla) */
function vectorToBuffer(vector: number[]): Buffer {
	const float32 = new Float32Array(vector);
	return Buffer.from(float32.buffer);
}

/** Buffer → number[] (Float32Array aracılığıyla) */
function bufferToVector(buf: Buffer): number[] {
	const float32 = new Float32Array(
		buf.buffer,
		buf.byteOffset,
		buf.byteLength / 4,
	);
	return Array.from(float32);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Bir chunk embedding'ini SQLite'e kaydeder.
 * @returns Yeni kaydın UUID'si
 */
export function storeEmbedding(
	kbId: string,
	docId: string,
	chunkIndex: number,
	content: string,
	vector: number[],
	metadata?: Record<string, unknown>,
): string {
	ensureTables();
	const db = getDb();
	const id = randomUUID();
	const now = new Date().toISOString();

	db.prepare(`
    INSERT INTO rag_embeddings (id, kb_id, doc_id, chunk_index, content, metadata, vector, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		id,
		kbId,
		docId,
		chunkIndex,
		content,
		metadata ? JSON.stringify(metadata) : null,
		vectorToBuffer(vector),
		now,
	);

	return id;
}

/** Bir dokümana ait tüm embedding'leri siler. */
export function deleteDocEmbeddings(docId: string): void {
	ensureTables();
	getDb().prepare("DELETE FROM rag_embeddings WHERE doc_id = ?").run(docId);
}

/** Bir knowledge base'e ait tüm embedding'leri siler. */
export function deleteKBEmbeddings(kbId: string): void {
	ensureTables();
	getDb().prepare("DELETE FROM rag_embeddings WHERE kb_id = ?").run(kbId);
}

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom === 0) return 0;
	return dot / denom;
}

// ---------------------------------------------------------------------------
// Similarity Search
// ---------------------------------------------------------------------------

interface EmbeddingRow {
	id: string;
	kb_id: string;
	doc_id: string;
	content: string;
	metadata: string | null;
	vector: Buffer;
}

/**
 * Verilen knowledge base içinde cosine similarity ile en yakın chunk'ları bulur.
 *
 * @param kbId  - Aranacak knowledge base'in ID'si
 * @param query - Arama sorgusu (metin)
 * @param topK  - Döndürülecek maksimum sonuç sayısı (varsayılan: 5)
 * @param model - Embedding modeli (varsayılan: text-embedding-3-small)
 */
export async function searchSimilar(
	kbId: string,
	query: string,
	topK = 5,
	model = "text-embedding-3-small",
): Promise<SearchResult[]> {
	ensureTables();

	if (!query.trim()) return [];

	console.log(
		`[VectorStore] Searching kbId=${kbId} topK=${topK} query="${query.slice(0, 80)}..."`,
	);

	// 1. Sorgu embedding'i üret
	const queryVector = await generateEmbedding(query, model);

	// 2. KB'ye ait tüm embedding'leri yükle
	const rows = getDb()
		.prepare(
			"SELECT id, kb_id, doc_id, content, metadata, vector FROM rag_embeddings WHERE kb_id = ?",
		)
		.all(kbId) as EmbeddingRow[];

	if (rows.length === 0) {
		console.log(`[VectorStore] No embeddings found for kbId=${kbId}`);
		return [];
	}

	// 3. Cosine similarity hesapla
	const scored = rows.map((row) => {
		const vec = bufferToVector(row.vector);
		const score = cosineSimilarity(queryVector, vec);
		return {
			chunkId: row.id,
			docId: row.doc_id,
			kbId: row.kb_id,
			content: row.content,
			score,
			metadata: row.metadata
				? (JSON.parse(row.metadata) as Record<string, unknown>)
				: null,
		};
	});

	// 4. Skora göre sırala ve top-K döndür
	scored.sort((a, b) => b.score - a.score);
	const results = scored.slice(0, topK);

	console.log(
		`[VectorStore] Search complete: ${rows.length} chunks scanned, top score=${results[0]?.score.toFixed(4) ?? "n/a"}`,
	);

	return results;
}

// ---------------------------------------------------------------------------
// Full Indexing Pipeline
// ---------------------------------------------------------------------------

/**
 * Tam indeksleme pipeline'ı: chunk → embed → store.
 *
 * Dökümanı parçalara böler, toplu embedding üretir ve SQLite'e kaydeder.
 * Mevcut embedding'ler önce silinir (yeniden indeksleme desteği).
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
	ensureTables();

	if (!content || !content.trim()) {
		console.warn(
			`[VectorStore] indexDocument called with empty content for docId=${docId}`,
		);
		return { chunkCount: 0 };
	}

	console.log(
		`[VectorStore] Indexing docId=${docId} kbId=${kbId} model=${model}`,
	);

	// Mevcut embedding'leri temizle (yeniden indeksleme)
	deleteDocEmbeddings(docId);

	// 1. Metni chunk'lara böl
	const chunks = chunkText(content, chunkSize, chunkOverlap);
	if (chunks.length === 0) {
		console.warn(`[VectorStore] No chunks produced for docId=${docId}`);
		return { chunkCount: 0 };
	}

	console.log(
		`[VectorStore] Generated ${chunks.length} chunks, requesting embeddings...`,
	);

	// 2. Toplu embedding üret
	let embeddings: number[][];
	try {
		embeddings = await generateEmbeddings(chunks, model);
	} catch (err) {
		console.error(`[VectorStore] Embedding API error for docId=${docId}:`, err);
		throw err;
	}

	// 3. Her chunk'ı SQLite'e kaydet
	const db = getDb();
	const insertMany = db.transaction(() => {
		for (let i = 0; i < chunks.length; i++) {
			storeEmbedding(kbId, docId, i, chunks[i], embeddings[i]);
		}
	});
	insertMany();

	console.log(
		`[VectorStore] Indexed ${chunks.length} chunks for docId=${docId}`,
	);

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
