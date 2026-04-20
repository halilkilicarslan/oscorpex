// ---------------------------------------------------------------------------
// Oscorpex — Provider State Manager (M4 Faz 4.4)
// Tracks rate-limit and failure state per CLI adapter (claude-code, codex, cursor).
// ---------------------------------------------------------------------------

import type { AgentCliTool } from "./types.js";
import { eventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderState {
	adapter: AgentCliTool;
	rateLimited: boolean;
	cooldownUntil: Date | null;
	consecutiveFailures: number;
	lastSuccess: Date | null;
}

// ---------------------------------------------------------------------------
// ProviderStateManager
// ---------------------------------------------------------------------------

class ProviderStateManager {
	private states = new Map<AgentCliTool, ProviderState>();

	constructor() {
		for (const tool of ["claude-code", "codex", "cursor"] as AgentCliTool[]) {
			this.states.set(tool, {
				adapter: tool,
				rateLimited: false,
				cooldownUntil: null,
				consecutiveFailures: 0,
				lastSuccess: null,
			});
		}
	}

	markRateLimited(adapter: AgentCliTool, cooldownMs = 60_000): void {
		const state = this.states.get(adapter);
		if (state) {
			state.rateLimited = true;
			state.cooldownUntil = new Date(Date.now() + cooldownMs);
			// Emit provider:degraded event (v7.0 Section 13)
			eventBus.emit({
				projectId: "",
				type: "provider:degraded",
				payload: { provider: adapter, cooldownMs, reason: "rate_limited" },
			});
		}
	}

	markSuccess(adapter: AgentCliTool): void {
		const state = this.states.get(adapter);
		if (state) {
			state.rateLimited = false;
			state.cooldownUntil = null;
			state.consecutiveFailures = 0;
			state.lastSuccess = new Date();
		}
	}

	markFailure(adapter: AgentCliTool): void {
		const state = this.states.get(adapter);
		if (state) {
			state.consecutiveFailures++;
			if (state.consecutiveFailures >= 3) {
				this.markRateLimited(adapter, 120_000);
			}
		}
	}

	isAvailable(adapter: AgentCliTool): boolean {
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

	getState(adapter: AgentCliTool): ProviderState | undefined {
		return this.states.get(adapter);
	}

	getAllStates(): ProviderState[] {
		return Array.from(this.states.values());
	}

	/** Check if all known providers are currently exhausted (rate-limited or in cooldown) */
	isAllExhausted(): boolean {
		for (const state of this.states.values()) {
			if (this.isAvailable(state.adapter)) return false;
		}
		return true;
	}

	/** Get the earliest cooldown expiry across all providers (for retry scheduling) */
	getEarliestRecoveryMs(): number {
		let earliest = Infinity;
		for (const state of this.states.values()) {
			if (state.cooldownUntil) {
				const remaining = state.cooldownUntil.getTime() - Date.now();
				if (remaining > 0 && remaining < earliest) {
					earliest = remaining;
				}
			}
		}
		return earliest === Infinity ? 60_000 : earliest;
	}
}

export const providerState = new ProviderStateManager();
