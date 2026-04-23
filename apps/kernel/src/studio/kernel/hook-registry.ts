// @oscorpex/kernel — In-memory hook registry
// Implements the HookRegistry contract from @oscorpex/core.
// Hooks are called synchronously or asynchronously at well-defined lifecycle points.

import type {
	HookPhase,
	HookContext,
	HookResult,
	HookRegistration,
	HookRegistry,
} from "@oscorpex/core";

class InMemoryHookRegistry implements HookRegistry {
	private hooks = new Map<HookPhase, HookRegistration[]>();

	register(registration: HookRegistration): void {
		const phaseHooks = this.hooks.get(registration.phase) ?? [];
		phaseHooks.push(registration);
		phaseHooks.sort((a, b) => a.priority - b.priority);
		this.hooks.set(registration.phase, phaseHooks);
	}

	unregister(hookId: string): void {
		for (const [phase, registrations] of this.hooks) {
			const filtered = registrations.filter((r) => r.id !== hookId);
			if (filtered.length !== registrations.length) {
				this.hooks.set(phase, filtered);
			}
		}
	}

	getHooks(phase: HookPhase): HookRegistration[] {
		return this.hooks.get(phase) ?? [];
	}

	clear(): void {
		this.hooks.clear();
	}
}

export const hookRegistry = new InMemoryHookRegistry();

/**
 * Execute all hooks registered for the given phase.
 * Sync hooks run first (by priority), then async hooks.
 * Returns false if any hook returns { proceed: false }.
 */
export async function runHooks(phase: HookPhase, ctx: HookContext): Promise<boolean> {
	const registrations = hookRegistry.getHooks(phase);
	for (const reg of registrations) {
		try {
			const result: HookResult = await reg.hook(ctx);
			if (!result.proceed) {
				return false;
			}
			if (result.modifiedContext) {
				Object.assign(ctx, result.modifiedContext);
			}
		} catch {
			// Hook errors are non-blocking — log and continue
		}
	}
	return true;
}