// ---------------------------------------------------------------------------
// RagPage Types & Constants
// ---------------------------------------------------------------------------

export const API_BASE = '/api/observability';

export interface KnowledgeBase {
	id: string;
	name: string;
	description: string;
	type: 'text' | 'pdf' | 'web' | 'code' | 'csv';
	embedding_model: string;
	chunk_size: number;
	chunk_overlap: number;
	status: 'active' | 'indexing' | 'error';
	document_count: number;
	total_chunks: number;
	last_indexed_at: string | null;
	created_at: string;
	updated_at: string;
	documents?: RagDocument[];
}

export interface RagDocument {
	id: string;
	kb_id: string;
	name: string;
	source: string;
	content_preview: string;
	chunk_count: number;
	size_bytes: number;
	status: 'pending' | 'indexed' | 'error';
	metadata: string;
	created_at: string;
}

export interface RagQuery {
	id: string;
	kb_id: string | null;
	kb_name: string | null;
	query: string;
	results_count: number;
	latency_ms: number | null;
	agent_id: string | null;
	created_at: string;
}

export interface Stats {
	totalKBs: number;
	totalDocuments: number;
	totalChunks: number;
	totalQueries: number;
	avgLatency: number;
	byType: Record<string, number>;
}

export const KB_TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
	text: { icon: '\u{1F4C4}', color: '#a3a3a3', label: 'Text' },
	pdf: { icon: '\u{1F4C3}', color: '#f87171', label: 'PDF' },
	web: { icon: '\u{1F30D}', color: '#60a5fa', label: 'Web' },
	code: { icon: '\u{1F4BB}', color: '#34d399', label: 'Code' },
	csv: { icon: '\u{1F4CA}', color: '#fbbf24', label: 'CSV' },
};
