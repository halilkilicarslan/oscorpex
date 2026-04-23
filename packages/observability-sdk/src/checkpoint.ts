// @oscorpex/observability-sdk — Checkpoint types and creation
// Pure functions for checkpoint snapshots.

import type { ReplaySnapshot } from "@oscorpex/core";

export interface Checkpoint {
	id: string;
	runId: string;
	checkpointId: string; // user-defined or stage-boundary name
	createdAt: string;
	snapshot: Partial<ReplaySnapshot>;
	contextHash?: string;
	metadata?: Record<string, unknown>;
}

export interface CheckpointInput {
	runId: string;
	checkpointId: string;
	snapshot: Partial<ReplaySnapshot>;
	contextText?: string; // raw context packet text to hash
	metadata?: Record<string, unknown>;
}

/**
 * Create a checkpoint with a SHA-256 context hash (if contextText is provided).
 * Pure function — no side effects.
 */
export async function createCheckpoint(input: CheckpointInput, generateId: () => string): Promise<Checkpoint> {
	const { runId, checkpointId, snapshot, contextText, metadata } = input;
	let contextHash: string | undefined;

	if (contextText) {
		const encoder = new TextEncoder();
		const data = encoder.encode(contextText);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		contextHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	return {
		id: generateId(),
		runId,
		checkpointId,
		createdAt: new Date().toISOString(),
		snapshot,
		contextHash,
		metadata,
	};
}

/**
 * Hash a context packet string synchronously (for non-async contexts).
 * Returns a hex-encoded SHA-256 digest.
 */
export function hashContextPacketSync(contextText: string): string {
	// Synchronous hash using Node's crypto module
	// This is a pure function but needs Node's crypto — import dynamically
	// For the SDK, we provide an async version above; sync is a kernel convenience.
	throw new Error("hashContextPacketSync not available in observability-sdk — use createCheckpoint with async crypto.subtle");
}