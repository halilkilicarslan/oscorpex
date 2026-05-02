// ---------------------------------------------------------------------------
// Oscorpex — Memory Architecture Types (v3.4)
// ---------------------------------------------------------------------------

export interface ProjectContextSnapshot {
	projectId: string;
	kind: string;
	summaryJson: Record<string, unknown>;
	sourceVersion: number;
	updatedAt: string;
}

export interface ConversationCompaction {
	projectId: string;
	channel: string;
	lastMessageId: string;
	summary: string;
	updatedAt: string;
}

export interface MemoryFact {
	projectId: string;
	scope: string;
	key: string;
	value: string;
	confidence: number;
	source: string;
	updatedAt: string;
}
