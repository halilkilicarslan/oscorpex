// @oscorpex/kernel — Provider registry + execution adapter
// Manages provider adapters and dispatches execution via the execution engine.

import type { ProviderExecutionInput, ProviderExecutionResult, ProviderAdapter } from "@oscorpex/core";
import { createLogger } from "../logger.js";
const log = createLogger("provider-registry");

class ProviderRegistry {
	private adapters = new Map<string, ProviderAdapter>();

	register(id: string, adapter: ProviderAdapter): void {
		this.adapters.set(id, adapter);
	}

	get(id: string): ProviderAdapter | undefined {
		return this.adapters.get(id);
	}

	list(): Array<{ id: string; adapter: ProviderAdapter }> {
		return Array.from(this.adapters.entries()).map(([id, adapter]) => ({ id, adapter }));
	}

	async execute(providerId: string, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const adapter = this.adapters.get(providerId);
		if (!adapter) {
			throw new Error(`Provider "${providerId}" not found in registry`);
		}

		const result = await adapter.execute(input);
		return result;
	}
}

export const providerRegistry = new ProviderRegistry();