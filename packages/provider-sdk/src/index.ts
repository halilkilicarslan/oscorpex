// @oscorpex/provider-sdk — Provider adapter contract and health types
// Re-exported from @oscorpex/core for convenience + extended with CLI-specific types.

export type {
	ProviderExecutionInput,
	ProviderExecutionUsage,
	ProviderExecutionResult,
	ProviderCapabilities,
	ProviderHealth,
} from "@oscorpex/core";
export type { ProviderAdapter } from "@oscorpex/core";

// CLI-specific types
export type { CLIAdapter, CLIAdapterOptions, CLIExecutionResult } from "./cli-adapter.js";
export { FULL_TOOL_ACCESS, buildToolGovernanceSection, hasFullToolAccess } from "./cli-adapter.js";

// Cost calculation
export type { ModelPricing } from "./cost.js";
export { MODEL_PRICING, calculateCost, defaultModelForType } from "./cost.js";

// Cancel behavior matrix
export { CANCEL_BEHAVIOR_MATRIX } from "./cancel-behavior.js";
export type { CancelBehaviorEntry } from "./cancel-behavior.js";

// Re-export core errors that providers should throw
export {
	ProviderUnavailableError,
	ProviderTimeoutError,
	ProviderExecutionError,
	ProviderRateLimitError,
} from "@oscorpex/core";