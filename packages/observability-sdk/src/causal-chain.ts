// @oscorpex/observability-sdk — Causal chain builder
// Builds an operator-visible causal chain from a sequence of events.
// Pure function — no DB dependencies.

export interface CausalEvent {
	id: string;
	timestamp: string;
	type: string;
	actor: string; // agent, user, system
	action: string;
	outcome?: string;
	parentEventId?: string;
	metadata?: Record<string, unknown>;
}

export interface CausalChain {
	runId: string;
	events: CausalEvent[];
	rootEventIds: string[];
}

/**
 * Build a causal chain from a flat list of events.
 * Links events via parentEventId to form a tree.
 * Returns roots (events with no parent) and the full ordered list.
 */
export function buildCausalChain(runId: string, events: CausalEvent[]): CausalChain {
	const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	const rootEventIds = sorted.filter((e) => !e.parentEventId).map((e) => e.id);
	return { runId, events: sorted, rootEventIds };
}

/**
 * Find the path from a root event to a target event in the causal chain.
 * Returns the event IDs along the path, or null if not found.
 */
export function findCausalPath(chain: CausalChain, targetEventId: string): string[] | null {
	const eventMap = new Map(chain.events.map((e) => [e.id, e]));
	const path: string[] = [];
	let current = eventMap.get(targetEventId);

	while (current) {
		path.unshift(current.id);
		if (!current.parentEventId) break;
		current = eventMap.get(current.parentEventId);
	}

	return path.length > 0 ? path : null;
}