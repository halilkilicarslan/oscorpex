// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Types
// ---------------------------------------------------------------------------

export type CLIProviderId = "claude" | "codex" | "gemini" | "cursor";
export type QuotaStatus = "healthy" | "warning" | "critical" | "depleted" | "unknown";
export type AuthStatus = "connected" | "missing" | "expired" | "unknown" | "not_supported";
export type UsageSource = "cli_usage" | "cli_cost" | "local_jsonl" | "provider_api" | "unavailable";
export type UsageConfidence = "high" | "medium" | "low";

export interface ProviderProbePermission {
	enabled: boolean;
	allowAuthFileRead: boolean;
	allowNetworkProbe: boolean;
	refreshIntervalSec: number;
}

export interface UsageQuota {
	type: "session" | "weekly" | "daily" | "model_specific" | "credits";
	label: string;
	percentRemaining?: number;
	percentUsed?: number;
	resetsAt?: string;
	resetText?: string;
	dollarRemaining?: number;
	status: QuotaStatus;
}

export interface DailyUsage {
	tokens: number;
	costUsd: number;
	sessionCount: number;
	workingTimeMs: number;
}

export interface WeeklyUsage {
	tokens: number;
	costUsd: number;
}

export interface GlobalUsageSnapshot {
	quotas: UsageQuota[];
	dailyUsage?: DailyUsage;
	weeklyUsage?: WeeklyUsage;
	accountTier?: string;
	accountEmail?: string;
	source: UsageSource;
	confidence: UsageConfidence;
}

export interface OscorpexUsageSnapshot {
	todayTokens: number;
	weekTokens: number;
	todayCostUsd: number;
	weekCostUsd: number;
	runCount: number;
	failureCount: number;
	projectBreakdown: Array<{
		projectId: string;
		projectName: string;
		tokens: number;
		costUsd: number;
	}>;
}

export interface UsageAttribution {
	comparable: boolean;
	oscorpexSharePercent?: number;
	externalSharePercent?: number;
	reason?: string;
}

export interface CLIProbeEvent {
	id: string;
	providerId: CLIProviderId;
	status: string;
	message: string;
	createdAt: string;
}

export interface CLIUsageTrendPoint {
	providerId: CLIProviderId;
	capturedAt: string;
	source: UsageSource;
	confidence: UsageConfidence;
	worstStatus: QuotaStatus;
	lowestPercentRemaining?: number;
}

export interface CLIUsageSnapshot {
	providerId: CLIProviderId;
	label: string;
	installed: boolean;
	binaryPath?: string;
	version?: string;
	authStatus: AuthStatus;
	global: GlobalUsageSnapshot | null;
	oscorpex: OscorpexUsageSnapshot;
	attribution: UsageAttribution | null;
	permissions: ProviderProbePermission;
	lastCheckedAt: string;
	errors: string[];
}

export interface CLIProviderDef {
	id: CLIProviderId;
	label: string;
	binary: string;
	versionArgs: string[];
	cliToolAliases: string[];
	modelHints: string[];
	providerHints: string[];
}

export interface ClaudeJSONLRecord {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	timestamp: Date;
}
