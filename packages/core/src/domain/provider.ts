// @oscorpex/core — Provider execution domain types
// Canonical types for provider adapter input/output, capabilities, and health.

export interface ProviderExecutionInput {
	runId: string;
	taskId: string;
	provider: string;
	repoPath: string;
	prompt: string;
	systemPrompt?: string;
	timeoutMs: number;
	allowedTools?: string[];
	model?: string;
	contextRefs?: string[];
	signal?: AbortSignal;
}

export interface ProviderExecutionUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	estimatedCostUsd?: number;
	billedCostUsd?: number;
}

export interface ProviderExecutionResult {
	provider: string;
	model?: string;
	text: string;
	filesCreated: string[];
	filesModified: string[];
	logs: string[];
	usage?: ProviderExecutionUsage;
	startedAt: string;
	completedAt: string;
	metadata?: {
		durationMs?: number;
		[key: string]: unknown;
	};
}

export interface ProviderCapabilities {
	supportsToolRestriction: boolean;
	supportsStreaming: boolean;
	supportsResume: boolean;
	supportsCancel: boolean;
	supportsStructuredOutput: boolean;
	supportsSandboxHinting: boolean;
	supportedModels?: string[];
}

export interface ProviderHealth {
	healthy: boolean;
	rateLimited?: boolean;
	cooldownUntil?: string;
	message?: string;
}

export interface ProviderAdapter {
	readonly id: string;
	capabilities(): ProviderCapabilities;
	isAvailable(): Promise<boolean>;
	execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult>;
	cancel(input: { runId: string; taskId: string }): Promise<void>;
	health(): Promise<ProviderHealth>;
}