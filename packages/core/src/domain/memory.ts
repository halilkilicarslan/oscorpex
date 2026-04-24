// @oscorpex/core — Context packet and memory domain types

export type ContextPacketMode = "planner" | "execution" | "review" | "team_architect" | "recovery" | "verification";

export interface ContextPacket {
	id: string;
	taskId: string;
	mode: ContextPacketMode;
	text: string;
	tokenEstimate: number;
	sections: Record<string, number>;
	refs: string[];
}

export interface ContextPacketOptions {
	projectId: string;
	taskId?: string;
	agentId?: string;
	mode: ContextPacketMode;
	maxTokens?: number;
}

export interface ProjectContextSnapshot {
	projectId: string;
	kind: string;
	summaryJson: Record<string, unknown>;
	sourceVersion: number;
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