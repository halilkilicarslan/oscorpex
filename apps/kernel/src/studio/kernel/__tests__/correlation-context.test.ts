// ---------------------------------------------------------------------------
// Correlation Context Tracking Tests (S4-05)
// Verifies correlation/causation IDs are auto-populated from async context
// when events are emitted without explicit IDs.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import {
	getCorrelationIds,
	getCurrentCausationId,
	getCurrentCorrelationId,
	withCorrelation,
} from "../../correlation-context.js";

describe("CorrelationContext", () => {
	it("generates a new correlationId outside any context", () => {
		const id = getCurrentCorrelationId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("returns undefined causationId outside any context", () => {
		expect(getCurrentCausationId()).toBeUndefined();
	});

	it("inherits correlationId inside withCorrelation", async () => {
		const parentId = "parent-123";
		await withCorrelation(async () => {
			expect(getCurrentCorrelationId()).toBe(parentId);
		}, parentId);
	});

	it("propagates causationId through nested contexts", async () => {
		const rootId = "root-456";
		await withCorrelation(async () => {
			expect(getCurrentCorrelationId()).toBe(rootId);
			expect(getCurrentCausationId()).toBeUndefined();

			await withCorrelation(async () => {
				expect(getCurrentCorrelationId()).toBe(rootId);
				expect(getCurrentCausationId()).toBe(rootId);
			}, rootId);
		}, rootId);
	});

	it("getCorrelationIds returns both values", async () => {
		await withCorrelation(async () => {
			const ids = getCorrelationIds();
			expect(ids.correlationId).toBeDefined();
			expect(typeof ids.correlationId).toBe("string");
		});
	});

	it("isolates parallel contexts", async () => {
		const ids: string[] = [];
		await Promise.all([
			withCorrelation(async () => {
				ids.push(getCurrentCorrelationId());
			}, "ctx-a"),
			withCorrelation(async () => {
				ids.push(getCurrentCorrelationId());
			}, "ctx-b"),
		]);
		expect(ids).toContain("ctx-a");
		expect(ids).toContain("ctx-b");
	});
});
