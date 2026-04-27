// ---------------------------------------------------------------------------
// Oscorpex — Provider State Manager (M4 Faz 4.4)
// Tracks rate-limit and failure state per CLI adapter (claude-code, codex, cursor).
// ---------------------------------------------------------------------------

import type { AgentCliTool } from "./types.js";
import { eventBus } from "./event-bus.js";
import { query, execute as pgExec } from "./pg.js";
import { providerRuntimeCache } from "./provider-runtime-cache.js";
import type { ProviderErrorClassification } from "@oscorpex/provider-sdk";
import { createLogger } from "./logger.js";
const log = createLogger("provider-state");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CooldownTrigger =
	| "unavailable"
	| "spawn_failure"
	| "rate_limited"
	| "repeated_timeout"
	| "cli_error"
	| "manual";

export interface ProviderState {
	adapter: AgentCliTool;
	rateLimited: boolean;
	cooldownUntil: Date | null;
	consecutiveFailures: number;
	lastSuccess: Date | null;
	lastCooldownTrigger?: CooldownTrigger;
	lastCooldownAt?: Date;
}

// ---------------------------------------------------------------------------
// Cooldown durations per trigger (milliseconds)
// ---------------------------------------------------------------------------

const COOLDOWN_DURATIONS: Record<CooldownTrigger, number> = {
	unavailable: 30_000,
	spawn_failure: 60_000,
	rate_limited: 60_000,
	repeated_timeout: 90_000,
	cli_error: 0, // no automatic cooldown for single cli errors
	manual: 30_000,
};

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

	// ---------------------------------------------------------------------------
	// Cooldown entry points
	// ---------------------------------------------------------------------------

	/**
	 * Puts provider into cooldown with a specific trigger classification.
	 * Uses trigger-aware durations.
	 */
	markCooldown(adapter: AgentCliTool, trigger: CooldownTrigger, customMs?: number): void {
		const state = this.states.get(adapter);
		if (!state) return;

		const durationMs = customMs ?? COOLDOWN_DURATIONS[trigger] ?? 30_000;
		if (durationMs <= 0) return; // zero-duration triggers skip cooldown

		state.rateLimited = true;
		state.cooldownUntil = new Date(Date.now() + durationMs);
		state.lastCooldownTrigger = trigger;
		state.lastCooldownAt = new Date();

		// Invalidate runtime availability cache on cooldown start
		providerRuntimeCache.invalidateAvailability(adapter, "cooldown_start");

		// Emit provider:degraded event with classification
		eventBus.emitTransient({
			projectId: "__global__",
			type: "provider:degraded",
			payload: { provider: adapter, cooldownMs: durationMs, reason: trigger },
		});

		log.info(`[provider-state] ${adapter} cooldown: ${trigger} (${durationMs}ms)`);
		this.persistToDb().catch((err) => log.warn("[provider-state] Non-blocking operation failed:", err?.message ?? err));
	}

	/** Legacy alias — defaults to rate_limited trigger */
	markRateLimited(adapter: AgentCliTool, cooldownMs = 60_000): void {
		this.markCooldown(adapter, "rate_limited", cooldownMs);
	}

	markSuccess(adapter: AgentCliTool): void {
		const state = this.states.get(adapter);
		if (state) {
			state.rateLimited = false;
			state.cooldownUntil = null;
			state.consecutiveFailures = 0;
			state.lastSuccess = new Date();
			this.persistToDb().catch((err) => log.warn("[provider-state] Non-blocking operation failed:", err?.message ?? err));
		}
	}

	markFailure(adapter: AgentCliTool, classification?: ProviderErrorClassification): void {
		const state = this.states.get(adapter);
		if (!state) return;

		state.consecutiveFailures++;
		providerRuntimeCache.invalidateAvailability(adapter, "execution_failure");

		// TASK 6: Trigger cooldown based on classification
		if (classification) {
			if (classification === "spawn_failure") {
				this.markCooldown(adapter, "spawn_failure");
			} else if (classification === "unavailable") {
				this.markCooldown(adapter, "unavailable");
			} else if (classification === "timeout" && state.consecutiveFailures >= 3) {
				this.markCooldown(adapter, "repeated_timeout");
			}
		}

		// Legacy: after 3 failures of any kind, hard cooldown
		if (state.consecutiveFailures >= 3) {
			this.markCooldown(adapter, "cli_error", 120_000);
		} else {
			this.persistToDb().catch((err) => log.warn("[provider-state] Non-blocking operation failed:", err?.message ?? err));
		}
	}

	isAvailable(adapter: AgentCliTool): boolean {
		const state = this.states.get(adapter);
		if (!state) return false;
		if (!state.rateLimited) return true;
		if (state.cooldownUntil && state.cooldownUntil <= new Date()) {
			// Cooldown expired — clear state and invalidate cache so next check refreshes
			state.rateLimited = false;
			state.cooldownUntil = null;
			providerRuntimeCache.invalidateAvailability(adapter, "cooldown_recheck");
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

	// --- v8.0: Persistence —  survive process restarts ---

	/** Persist current state to DB. Called after every state change. */
	async persistToDb(): Promise<void> {
		try {
			for (const state of this.states.values()) {
				await pgExec(
					`INSERT INTO provider_state (adapter, rate_limited, cooldown_until, consecutive_failures, last_success)
					 VALUES ($1, $2, $3, $4, $5)
					 ON CONFLICT (adapter) DO UPDATE SET
					   rate_limited = $2, cooldown_until = $3,
					   consecutive_failures = $4, last_success = $5,
					   updated_at = now()`,
					[
						state.adapter,
						state.rateLimited,
						state.cooldownUntil?.toISOString() ?? null,
						state.consecutiveFailures,
						state.lastSuccess?.toISOString() ?? null,
					],
				);
			}
		} catch (err) {
			log.warn("[provider-state] Failed to persist state:" + " " + String(err));
		}
	}

	/** Load state from DB on startup. Restores cooldowns that haven't expired. */
	async loadFromDb(): Promise<void> {
		try {
			const rows = await query<{
				adapter: string;
				rate_limited: boolean;
				cooldown_until: string | null;
				consecutive_failures: number;
				last_success: string | null;
				last_cooldown_trigger: string | null;
				last_cooldown_at: string | null;
			}>("SELECT * FROM provider_state");
			for (const row of rows) {
				const adapter = row.adapter as AgentCliTool;
				const existing = this.states.get(adapter);
				if (!existing) continue;
				const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until) : null;
				const stillCooling = cooldownUntil && cooldownUntil > new Date();
				existing.rateLimited = stillCooling ? row.rate_limited : false;
				existing.cooldownUntil = stillCooling ? cooldownUntil : null;
				existing.consecutiveFailures = row.consecutive_failures;
				existing.lastSuccess = row.last_success ? new Date(row.last_success) : null;
				existing.lastCooldownTrigger = (row.last_cooldown_trigger as CooldownTrigger) ?? undefined;
				existing.lastCooldownAt = row.last_cooldown_at ? new Date(row.last_cooldown_at) : undefined;
			}
			log.info("[provider-state] Loaded state from DB");
		} catch {
			// Table may not exist yet on first run — non-blocking
		}
	}
}

export const providerState = new ProviderStateManager();
