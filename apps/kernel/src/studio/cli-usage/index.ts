// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Public API
// Re-exports the full public surface so existing consumers importing from
// "./cli-usage.js" continue to work without modification.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db.js";
import { createLogger } from "../logger.js";
import { probeBinary, sanitizeError } from "./binary-locator.js";
import { cachedCredentials } from "./oauth.js";
import {
	getCLIProbeSettings,
	latestCLIUsageSnapshots,
	persistSnapshot,
	recordProbeEvent,
} from "./persistence.js";
import { probeClaude } from "./probes/claude-probe.js";
import { probeCodex } from "./probes/codex-probe.js";
import { probeCursor } from "./probes/cursor-probe.js";
import { probeGemini } from "./probes/gemini-probe.js";
import type {
	AuthStatus,
	CLIProviderDef,
	CLIProviderId,
	CLIUsageSnapshot,
	GlobalUsageSnapshot,
	OscorpexUsageSnapshot,
	ProviderProbePermission,
	UsageAttribution,
} from "./types.js";

const log = createLogger("cli-usage");

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: CLIProviderDef[] = [
	{
		id: "claude",
		label: "Claude CLI",
		binary: "claude",
		versionArgs: ["--version"],
		cliToolAliases: ["claude", "claude-code"],
		modelHints: ["claude"],
		providerHints: ["anthropic"],
	},
	{
		id: "codex",
		label: "Codex CLI",
		binary: "codex",
		versionArgs: ["--version"],
		cliToolAliases: ["codex"],
		modelHints: ["gpt", "o3", "o4", "o1"],
		providerHints: ["openai"],
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		versionArgs: ["--version"],
		cliToolAliases: ["gemini"],
		modelHints: ["gemini"],
		providerHints: ["google"],
	},
	{
		id: "cursor",
		label: "Cursor",
		binary: "cursor",
		versionArgs: ["--version"],
		cliToolAliases: ["cursor"],
		modelHints: ["cursor"],
		providerHints: ["cursor"],
	},
];

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

function now(): string {
	return new Date().toISOString();
}

function startOfToday(): string {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	return date.toISOString();
}

function sevenDaysAgo(): string {
	const date = new Date();
	date.setDate(date.getDate() - 7);
	return date.toISOString();
}

// ---------------------------------------------------------------------------
// Oscorpex internal usage query
// ---------------------------------------------------------------------------

async function getOscorpexUsage(def: CLIProviderDef): Promise<OscorpexUsageSnapshot> {
	const today = startOfToday();
	const week = sevenDaysAgo();
	const cliAliases = def.cliToolAliases;
	const modelHints = def.modelHints;
	const providerHints = def.providerHints;

	const usageWhere = `
    (
      pa.cli_tool = ANY($2)
      OR tu.model ILIKE ANY($3)
      OR tu.provider ILIKE ANY($4)
    )
  `;
	const modelPatterns = modelHints.map((hint) => `%${hint}%`);
	const providerPatterns = providerHints.map((hint) => `%${hint}%`);

	const [todayRow, weekRow, runRow, failureRow, breakdownRows] = await Promise.all([
		queryOne<Record<string, string>>(
			`SELECT COALESCE(SUM(tu.total_tokens),0) AS tokens, COALESCE(SUM(tu.cost_usd),0) AS cost
			 FROM token_usage tu
			 LEFT JOIN project_agents pa ON pa.id = tu.agent_id
			 WHERE tu.created_at >= $1 AND ${usageWhere}`,
			[today, cliAliases, modelPatterns, providerPatterns],
		),
		queryOne<Record<string, string>>(
			`SELECT COALESCE(SUM(tu.total_tokens),0) AS tokens, COALESCE(SUM(tu.cost_usd),0) AS cost
			 FROM token_usage tu
			 LEFT JOIN project_agents pa ON pa.id = tu.agent_id
			 WHERE tu.created_at >= $1 AND ${usageWhere}`,
			[week, cliAliases, modelPatterns, providerPatterns],
		),
		queryOne<Record<string, string>>(
			"SELECT COUNT(*) AS cnt FROM agent_runs WHERE cli_tool = ANY($1) AND created_at >= $2",
			[cliAliases, week],
		),
		queryOne<Record<string, string>>(
			`SELECT COUNT(*) AS cnt
			 FROM events e
			 LEFT JOIN project_agents pa ON pa.id = e.agent_id
			 WHERE e.type = 'task:failed' AND e.timestamp >= $1 AND pa.cli_tool = ANY($2)`,
			[week, cliAliases],
		),
		query<Record<string, string>>(
			`SELECT p.id AS project_id, p.name AS project_name, COALESCE(SUM(tu.total_tokens),0) AS tokens, COALESCE(SUM(tu.cost_usd),0) AS cost
			 FROM token_usage tu
			 JOIN projects p ON p.id = tu.project_id
			 LEFT JOIN project_agents pa ON pa.id = tu.agent_id
			 WHERE tu.created_at >= $1 AND ${usageWhere}
			 GROUP BY p.id, p.name
			 ORDER BY cost DESC
			 LIMIT 10`,
			[week, cliAliases, modelPatterns, providerPatterns],
		),
	]);

	return {
		todayTokens: Number.parseInt(todayRow?.tokens ?? "0", 10),
		weekTokens: Number.parseInt(weekRow?.tokens ?? "0", 10),
		todayCostUsd: Number.parseFloat(todayRow?.cost ?? "0"),
		weekCostUsd: Number.parseFloat(weekRow?.cost ?? "0"),
		runCount: Number.parseInt(runRow?.cnt ?? "0", 10),
		failureCount: Number.parseInt(failureRow?.cnt ?? "0", 10),
		projectBreakdown: breakdownRows.map((row) => ({
			projectId: row.project_id,
			projectName: row.project_name,
			tokens: Number.parseInt(row.tokens ?? "0", 10),
			costUsd: Number.parseFloat(row.cost ?? "0"),
		})),
	};
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

function attribution(global: GlobalUsageSnapshot | null, oscorpex: OscorpexUsageSnapshot): UsageAttribution | null {
	const dailyTokens = global?.dailyUsage?.tokens;
	if (!dailyTokens || dailyTokens <= 0) {
		return { comparable: false, reason: "Global usage source is not token-comparable with Oscorpex usage" };
	}
	const share = Math.min(100, Math.round((oscorpex.todayTokens / dailyTokens) * 100));
	return {
		comparable: true,
		oscorpexSharePercent: share,
		externalSharePercent: Math.max(0, 100 - share),
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getCLIUsageSnapshot(providerId: CLIProviderId, refresh = false): Promise<CLIUsageSnapshot> {
	const def = PROVIDERS.find((provider) => provider.id === providerId);
	if (!def) throw new Error(`Unknown CLI provider: ${providerId}`);

	const [permissions, binary, oscorpex] = await Promise.all([
		getCLIProbeSettings(providerId),
		probeBinary(def),
		getOscorpexUsage(def),
	]);

	const errors = [...binary.errors];
	let global: GlobalUsageSnapshot | null = null;
	let authStatus: AuthStatus = "unknown";

	if (binary.installed && (refresh || permissions.enabled)) {
		if (providerId === "claude" && binary.binaryPath) {
			const result = await probeClaude(def, binary.binaryPath, permissions);
			global = result.global;
			authStatus = result.authStatus;
			errors.push(...result.errors);
		} else if (providerId === "codex") {
			const result = await probeCodex(def, permissions);
			global = result.global;
			authStatus = result.authStatus;
			errors.push(...result.errors);
		} else if (providerId === "gemini") {
			const result = await probeGemini(permissions);
			global = result.global;
			authStatus = result.authStatus;
			errors.push(...result.errors);
		} else if (providerId === "cursor") {
			const result = await probeCursor(permissions);
			global = result.global;
			authStatus = result.authStatus;
			errors.push(...result.errors);
		}
	}

	if (!permissions.enabled) {
		errors.push("Global quota probe requires provider opt-in");
	}

	const snapshot: CLIUsageSnapshot = {
		providerId,
		label: def.label,
		installed: binary.installed,
		binaryPath: binary.binaryPath,
		version: binary.version,
		authStatus,
		global,
		oscorpex,
		attribution: attribution(global, oscorpex),
		permissions,
		lastCheckedAt: now(),
		errors,
	};

	if (refresh) {
		if (permissions.enabled) {
			await persistSnapshot(snapshot).catch((err) =>
				recordProbeEvent(providerId, "error", sanitizeError(err)),
			);
			await recordProbeEvent(providerId, snapshot.global ? "refreshed" : "unavailable", `${def.label} refreshed`);
		} else {
			await recordProbeEvent(providerId, "skipped", `${def.label} global probe is disabled`);
		}
	}
	return snapshot;
}

export async function listCLIUsageSnapshots(refresh = false): Promise<CLIUsageSnapshot[]> {
	return Promise.all(PROVIDERS.map((provider) => getCLIUsageSnapshot(provider.id, refresh)));
}

export async function getOscorpexCLIUsage(): Promise<Record<CLIProviderId, OscorpexUsageSnapshot>> {
	const entries = await Promise.all(
		PROVIDERS.map(async (provider) => [provider.id, await getOscorpexUsage(provider)] as const),
	);
	return Object.fromEntries(entries) as Record<CLIProviderId, OscorpexUsageSnapshot>;
}

export function isCLIProviderId(value: string): value is CLIProviderId {
	return PROVIDERS.some((provider) => provider.id === value);
}

// Re-export persistence functions used by routes
export { getCLIProbeSettings, setCLIProbeSettings, latestCLIUsageSnapshots, getCLIUsageHistory, getCLIProbeEvents } from "./persistence.js";

// Re-export all types
export type {
	CLIProviderId,
	QuotaStatus,
	AuthStatus,
	UsageSource,
	UsageConfidence,
	ProviderProbePermission,
	UsageQuota,
	DailyUsage,
	WeeklyUsage,
	GlobalUsageSnapshot,
	OscorpexUsageSnapshot,
	UsageAttribution,
	CLIProbeEvent,
	CLIUsageTrendPoint,
	CLIUsageSnapshot,
	CLIProviderDef,
	ClaudeJSONLRecord,
} from "./types.js";
