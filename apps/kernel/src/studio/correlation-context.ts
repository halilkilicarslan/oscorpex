// ---------------------------------------------------------------------------
// Oscorpex — Correlation Context Tracking
// Provides AsyncLocalStorage-based correlation/causation ID propagation
// across async call chains. All event emitters should use getCurrentCorrelationId()
// to maintain causal chains.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface CorrelationContext {
	correlationId: string;
	causationId?: string;
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Run the given function inside a correlation context.
 * If no parent context exists, a new correlationId is generated.
 * If a parent exists, the current correlationId is inherited and
 * the previous correlationId becomes causationId.
 */
export function withCorrelation<T>(fn: () => Promise<T>, overrideCorrelationId?: string): Promise<T> {
	const parent = correlationStorage.getStore();
	const correlationId = overrideCorrelationId ?? parent?.correlationId ?? randomUUID();
	const causationId = parent?.correlationId;

	return correlationStorage.run({ correlationId, causationId }, fn);
}

/** Get the current correlation ID from async context, or generate a new one. */
export function getCurrentCorrelationId(): string {
	return correlationStorage.getStore()?.correlationId ?? randomUUID();
}

/** Get the current causation ID from async context (previous correlationId in chain). */
export function getCurrentCausationId(): string | undefined {
	return correlationStorage.getStore()?.causationId;
}

/** Get both IDs as a pair for event emission. */
export function getCorrelationIds(): { correlationId: string; causationId?: string } {
	const store = correlationStorage.getStore();
	return {
		correlationId: store?.correlationId ?? randomUUID(),
		causationId: store?.causationId,
	};
}

/** Returns true if we are currently inside a correlation context. */
export function hasCorrelationContext(): boolean {
	return correlationStorage.getStore() !== undefined;
}