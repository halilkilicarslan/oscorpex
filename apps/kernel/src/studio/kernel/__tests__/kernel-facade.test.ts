// ---------------------------------------------------------------------------
// Kernel Facade Smoke Tests (S1-03 + S1-04)
// Verifies all subsystem adapters are wired without throwing stubs.
// Full integration tests require DB setup (see existing test suite).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { kernel } from "../index.js";

describe("Kernel Facade — Subsystem Wiring", () => {
	it("verification runner is wired and not a stub", () => {
		expect(() => kernel.verification).not.toThrow();
		expect(kernel.verification).toBeDefined();
	});

	it("policy engine is wired and not a stub", () => {
		expect(() => kernel.policy).not.toThrow();
		expect(kernel.policy).toBeDefined();
	});

	it("cost reporter is wired and not a stub", () => {
		expect(() => kernel.cost).not.toThrow();
		expect(kernel.cost).toBeDefined();
	});

	it("memory provider is wired and not a stub", () => {
		expect(() => kernel.memory).not.toThrow();
		expect(kernel.memory).toBeDefined();
	});

	it("replay store is wired and not a stub", () => {
		expect(() => kernel.replay).not.toThrow();
		expect(kernel.replay).toBeDefined();
	});

	it("provider registry is wired", () => {
		expect(kernel.providers).toBeDefined();
	});

	it("task graph is wired and not a stub", () => {
		expect(() => kernel.graph).not.toThrow();
		expect(kernel.graph).toBeDefined();
	});

	it("hook registry is accessible", () => {
		expect(kernel.hooks).toBeDefined();
	});

	it("event publisher is accessible", () => {
		expect(kernel.events).toBeDefined();
	});

	it("task store is accessible", () => {
		expect(kernel.tasks).toBeDefined();
	});

	it("run store is accessible and not a stub", () => {
		expect(() => kernel.runs).not.toThrow();
		expect(kernel.runs).toBeDefined();
	});

	it("scheduler is accessible", () => {
		expect(kernel.scheduler).toBeDefined();
	});
});

describe("Kernel Facade — Run State Machine", () => {
	it("canTransitionRun allows valid transitions", async () => {
		const { canTransitionRun } = await import("@oscorpex/core");
		expect(canTransitionRun("created", "running")).toBe(true);
		expect(canTransitionRun("running", "paused")).toBe(true);
		expect(canTransitionRun("running", "completed")).toBe(true);
		expect(canTransitionRun("running", "failed")).toBe(true);
		expect(canTransitionRun("paused", "running")).toBe(true);
		expect(canTransitionRun("failed", "running")).toBe(true);
	});

	it("canTransitionRun rejects invalid transitions", async () => {
		const { canTransitionRun } = await import("@oscorpex/core");
		expect(canTransitionRun("created", "completed")).toBe(false);
		expect(canTransitionRun("completed", "running")).toBe(false);
		expect(canTransitionRun("failed", "completed")).toBe(false);
	});
});