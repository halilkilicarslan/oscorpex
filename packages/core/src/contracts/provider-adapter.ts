// @oscorpex/core — ProviderAdapter contract
// The canonical interface that all AI provider adapters must implement.

import type {
	ProviderExecutionInput,
	ProviderExecutionResult,
	ProviderCapabilities,
	ProviderHealth,
} from "../domain/provider.js";

export interface ProviderAdapter {
	readonly id: string;
	capabilities(): ProviderCapabilities;
	isAvailable(): Promise<boolean>;
	execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult>;
	cancel(input: { runId: string; taskId: string }): Promise<void>;
	health(): Promise<ProviderHealth>;
}