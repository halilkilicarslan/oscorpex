// @oscorpex/provider-sdk — CLI adapter interface and execution types
// These types define the contract that all CLI provider adapters must implement.
// Extracted from kernel's cli-adapter.ts for provider-agnostic use.

export interface CLIAdapterOptions {
	projectId: string;
	taskId: string;
	agentId: string;
	agentName: string;
	repoPath: string;
	prompt: string;
	systemPrompt: string;
	timeoutMs: number;
	allowedTools?: string[];
	model?: string;
	signal?: AbortSignal;
	onLog?: (line: string) => void;
}

export interface CLIExecutionResult {
	text: string;
	filesCreated: string[];
	filesModified: string[];
	logs: string[];
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalCostUsd: number;
	durationMs: number;
	model: string;
}

export interface CLIAdapter {
	readonly name: string;
	isAvailable(): Promise<boolean>;
	execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult>;
}

// ---------------------------------------------------------------------------
// Tool governance — shared across adapters
// ---------------------------------------------------------------------------

export const FULL_TOOL_ACCESS = ["Read", "Edit", "Write", "Bash", "Glob", "Grep"];

export function buildToolGovernanceSection(allowedTools?: string[]): string {
	if (!allowedTools || allowedTools.length === 0) return "";
	return [
		"## Tool Governance",
		`Allowed tools only: ${allowedTools.join(", ")}`,
		"If a required action is not possible with the allowed tools, stop and report the limitation instead of improvising with a forbidden tool.",
	].join("\n");
}

export function hasFullToolAccess(allowedTools?: string[]): boolean {
	if (!allowedTools || allowedTools.length === 0) return true;
	return (
		allowedTools.length === FULL_TOOL_ACCESS.length &&
		FULL_TOOL_ACCESS.every((tool) => allowedTools.includes(tool))
	);
}