// ---------------------------------------------------------------------------
// Oscorpex — Context Store & Context Packet Types
// ---------------------------------------------------------------------------

export type ContextContentType = "code" | "prose";
export type ContextMatchLayer = "tsvector" | "trigram";

export interface ContextSource {
	id: string;
	projectId: string;
	label: string;
	chunkCount: number;
	codeChunkCount: number;
	indexedAt: string;
}

export interface ContextChunk {
	id: number;
	sourceId: string;
	title: string;
	content: string;
	contentType: ContextContentType;
}

export interface ContextSearchOptions {
	projectId: string;
	queries: string[];
	limit?: number;
	source?: string;
	contentType?: ContextContentType;
	maxTokens?: number;
}

export interface ContextSearchResult {
	title: string;
	content: string;
	source: string;
	rank: number;
	contentType: ContextContentType;
	matchLayer: ContextMatchLayer;
}

// ---- Context Packet (v3.4) -------------------------------------------------

export type ContextPacketMode = "planner" | "execution" | "review" | "team_architect";

export interface ContextPacketOptions {
	projectId: string;
	taskId?: string;
	agentId?: string;
	mode: ContextPacketMode;
	maxTokens?: number;
}
