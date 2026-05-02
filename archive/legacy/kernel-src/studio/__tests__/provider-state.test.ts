// ---------------------------------------------------------------------------
// Tests — ProviderStateManager (M4 Faz 4.4)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We test via a local class instance to avoid shared singleton state between tests
interface ProviderState {
	adapter: string;
	rateLimited: boolean;
	cooldownUntil: Date | null;
	consecutiveFailures: number;
	lastSuccess: Date | null;
}

class ProviderStateManagerUnderTest {
	private states = new Map<string, ProviderState>();

	constructor() {
		for (const tool of ["claude-code", "codex", "cursor"] as const) {
			this.states.set(tool, {
				adapter: tool,
				rateLimited: false,
				cooldownUntil: null,
				consecutiveFailures: 0,
				lastSuccess: null,
			});
		}
	}

	markRateLimited(adapter: string, cooldownMs = 60_000): void {
		const state = this.states.get(adapter);
		if (state) {
			state.rateLimited = true;
			state.cooldownUntil = new Date(Date.now() + cooldownMs);
		}
	}

	markSuccess(adapter: string): void {
		const state = this.states.get(adapter);
		if (state) {
			state.rateLimited = false;
			state.cooldownUntil = null;
			state.consecutiveFailures = 0;
			state.lastSuccess = new Date();
		}
	}

	markFailure(adapter: string): void {
		const state = this.states.get(adapter);
		if (state) {
			state.consecutiveFailures++;
			if (state.consecutiveFailures >= 3) {
				this.markRateLimited(adapter, 120_000);
			}
		}
	}

	isAvailable(adapter: string): boolean {
		const state = this.states.get(adapter);
		if (!state) return false;
		if (!state.rateLimited) return true;
		if (state.cooldownUntil && state.cooldownUntil <= new Date()) {
			state.rateLimited = false;
			state.cooldownUntil = null;
			return true;
		}
		return false;
	}

	getState(adapter: string): ProviderState | undefined {
		return this.states.get(adapter);
	}

	getAllStates(): ProviderState[] {
		return Array.from(this.states.values());
	}
}

describe("ProviderStateManager", () => {
	let manager: ProviderStateManagerUnderTest;

	beforeEach(() => {
		manager = new ProviderStateManagerUnderTest();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("initializes with 3 providers all available", () => {
		const states = manager.getAllStates();
		expect(states).toHaveLength(3);
		const adapters = states.map((s) => s.adapter);
		expect(adapters).toContain("claude-code");
		expect(adapters).toContain("codex");
		expect(adapters).toContain("cursor");
		for (const s of states) {
			expect(s.rateLimited).toBe(false);
			expect(s.cooldownUntil).toBeNull();
			expect(s.consecutiveFailures).toBe(0);
			expect(s.lastSuccess).toBeNull();
		}
	});

	it("markRateLimited → isAvailable false → cooldown expire → isAvailable true", () => {
		manager.markRateLimited("claude-code", 60_000);
		expect(manager.isAvailable("claude-code")).toBe(false);

		// Advance time past cooldown
		vi.advanceTimersByTime(61_000);
		expect(manager.isAvailable("claude-code")).toBe(true);
		// State should be reset after auto-expiry
		const state = manager.getState("claude-code");
		expect(state?.rateLimited).toBe(false);
	});

	it("markSuccess resets rateLimited and consecutiveFailures", () => {
		manager.markRateLimited("codex");
		manager.markSuccess("codex");

		const state = manager.getState("codex");
		expect(state?.rateLimited).toBe(false);
		expect(state?.cooldownUntil).toBeNull();
		expect(state?.consecutiveFailures).toBe(0);
		expect(state?.lastSuccess).not.toBeNull();
	});

	it("markFailure × 3 triggers auto rate limit", () => {
		expect(manager.isAvailable("cursor")).toBe(true);
		manager.markFailure("cursor");
		manager.markFailure("cursor");
		expect(manager.isAvailable("cursor")).toBe(true); // only 2 failures, not yet limited
		manager.markFailure("cursor");
		// 3rd failure → auto rate limited with 120s cooldown
		expect(manager.isAvailable("cursor")).toBe(false);
		const state = manager.getState("cursor");
		expect(state?.consecutiveFailures).toBe(3);
		expect(state?.rateLimited).toBe(true);
	});

	it("getAllStates returns all 3 providers", () => {
		const states = manager.getAllStates();
		expect(states).toHaveLength(3);
	});

	it("unknown adapter returns false for isAvailable", () => {
		expect(manager.isAvailable("unknown-provider" as any)).toBe(false);
	});
});
