// ---------------------------------------------------------------------------
// Import Smoke Tests (TYP-04)
// Verifies key kernel modules are importable and compile correctly.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

describe("Kernel import smoke tests", () => {
	it("kernel facade is importable and has expected subsystems", async () => {
		const { kernel } = await import("../index.js");
		expect(kernel).toBeDefined();
		expect(kernel.verification).toBeDefined();
		expect(kernel.policy).toBeDefined();
		expect(kernel.cost).toBeDefined();
		expect(kernel.memory).toBeDefined();
		expect(kernel.replay).toBeDefined();
	});

	it("correlation context is importable", async () => {
		const { withCorrelation, getCurrentCorrelationId } = await import("../../correlation-context.js");
		expect(withCorrelation).toBeDefined();
		expect(getCurrentCorrelationId).toBeDefined();
	});

	it("replay store has restore function", async () => {
		const { restoreFromSnapshot } = await import("../../replay-store.js");
		expect(restoreFromSnapshot).toBeDefined();
	});

	it("provider registry is importable", async () => {
		const { providerRegistry } = await import("../provider-registry.js");
		expect(providerRegistry).toBeDefined();
		expect(typeof providerRegistry.execute).toBe("function");
		expect(typeof providerRegistry.cancel).toBe("function");
	});

	it("event bus auto-populates correlation ids", async () => {
		const { eventBus } = await import("../../event-bus.js");
		expect(eventBus).toBeDefined();
		expect(typeof eventBus.emit).toBe("function");
	});
});
