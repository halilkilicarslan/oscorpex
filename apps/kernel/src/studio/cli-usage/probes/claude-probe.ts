// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Claude Probe
// Probes Claude CLI via OAuth API, Admin API, CLI commands, and local JSONL.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../logger.js";
import { sanitizeError, runCommand } from "../binary-locator.js";
import { claudeOAuthNeedsRefresh, loadClaudeOAuthCredentials, refreshClaudeOAuthToken, CLAUDE_OAUTH_CLIENT_ID } from "../oauth.js";
import type {
	AuthStatus,
	CLIProviderDef,
	ClaudeJSONLRecord,
	DailyUsage,
	GlobalUsageSnapshot,
	ProviderProbePermission,
	QuotaStatus,
	UsageQuota,
} from "../types.js";

const log = createLogger("cli-usage:claude-probe");

// ---------------------------------------------------------------------------
// Quota helpers
// ---------------------------------------------------------------------------

function quotaStatus(percentRemaining?: number): QuotaStatus {
	if (percentRemaining == null || !Number.isFinite(percentRemaining)) return "unknown";
	if (percentRemaining <= 0) return "depleted";
	if (percentRemaining < 20) return "critical";
	if (percentRemaining < 50) return "warning";
	return "healthy";
}

// ---------------------------------------------------------------------------
// JSONL helpers
// ---------------------------------------------------------------------------

export function findRecentClaudeJSONLFiles(): string[] {
	const root = join(homedir(), ".claude", "projects");
	if (!existsSync(root)) return [];
	const since = Date.now() - 2 * 24 * 60 * 60 * 1000;
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			try {
				const stat = statSync(full);
				if (stat.isDirectory()) walk(full);
				if (stat.isFile() && full.endsWith(".jsonl") && stat.mtimeMs >= since) files.push(full);
			} catch {
				// ignore
			}
		}
	};
	walk(root);
	return files;
}

export function parseClaudeJSONLRecords(): ClaudeJSONLRecord[] {
	const records: ClaudeJSONLRecord[] = [];
	for (const file of findRecentClaudeJSONLFiles()) {
		let content = "";
		try {
			content = readFileSync(file, "utf-8");
		} catch {
			continue;
		}
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const json = JSON.parse(line) as Record<string, unknown>;
				if (json.type !== "assistant") continue;
				const message = json.message as Record<string, unknown> | undefined;
				const usage = message?.usage as Record<string, number> | undefined;
				const model = message?.model as string | undefined;
				const timestamp = json.timestamp ? new Date(json.timestamp as string) : null;
				if (!usage || !model || !timestamp || Number.isNaN(timestamp.getTime())) continue;
				records.push({
					model,
					inputTokens: usage.input_tokens ?? 0,
					outputTokens: usage.output_tokens ?? 0,
					cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
					cacheReadTokens: usage.cache_read_input_tokens ?? 0,
					timestamp,
				});
			} catch {
				// ignore malformed lines
			}
		}
	}
	return records;
}

function startOfToday(): string {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	return date.toISOString();
}

function summarizeClaudeDailyUsage(): DailyUsage {
	const todayStart = new Date(startOfToday()).getTime();
	const records = parseClaudeJSONLRecords().filter((record) => record.timestamp.getTime() >= todayStart);
	const tokens = records.reduce((sum, record) => sum + record.inputTokens + record.outputTokens, 0);
	const sessions = records.length > 0 ? Math.max(1, Math.ceil(records.length / 12)) : 0;
	return {
		tokens,
		costUsd: 0,
		sessionCount: sessions,
		workingTimeMs: 0,
	};
}

// ---------------------------------------------------------------------------
// CLI output parsing
// ---------------------------------------------------------------------------

function parsePercentQuota(text: string, providerId: string): UsageQuota[] {
	const clean = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
	const quotas: UsageQuota[] = [];
	const lines = clean.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].toLowerCase();
		const window = lines.slice(i, i + 8).join(" ");
		// Match both "N% left|remaining" and "N% used"
		const pctMatch = window.match(/([0-9]{1,3})%\s+(?:left|remaining|used)/i);
		if (!pctMatch) continue;
		const rawVal = Math.max(0, Math.min(100, Number.parseInt(pctMatch[1], 10)));
		const isUsed = /used/i.test(pctMatch[0]);
		const percentRemaining = isUsed ? Math.max(0, 100 - rawVal) : rawVal;
		const resetMatch = window.match(/resets?\s+(?:in\s+)?([^|•\n]+)/i);
		if (line.includes("weekly") || line.includes("current week")) {
			quotas.push({
				type: "weekly",
				label: "Weekly",
				percentRemaining,
				percentUsed: 100 - percentRemaining,
				resetText: resetMatch?.[0],
				status: quotaStatus(percentRemaining),
			});
		} else if (line.includes("opus")) {
			quotas.push({
				type: "model_specific",
				label: "Weekly (Opus)",
				percentRemaining,
				percentUsed: 100 - percentRemaining,
				resetText: resetMatch?.[0],
				status: quotaStatus(percentRemaining),
			});
		} else if (line.includes("sonnet")) {
			quotas.push({
				type: "model_specific",
				label: "Weekly (Sonnet)",
				percentRemaining,
				percentUsed: 100 - percentRemaining,
				resetText: resetMatch?.[0],
				status: quotaStatus(percentRemaining),
			});
		} else if (line.includes("model")) {
			quotas.push({
				type: "model_specific",
				label: line.slice(0, 60).trim() || `${providerId} model`,
				percentRemaining,
				percentUsed: 100 - percentRemaining,
				resetText: resetMatch?.[0],
				status: quotaStatus(percentRemaining),
			});
		} else if (
			line.includes("5h") ||
			line.includes("session") ||
			line.includes("limit") ||
			line.includes("current session")
		) {
			quotas.push({
				type: "session",
				label: line.includes("5h") ? "5h limit" : "Session",
				percentRemaining,
				percentUsed: 100 - percentRemaining,
				resetText: resetMatch?.[0],
				status: quotaStatus(percentRemaining),
			});
		}
	}
	return quotas;
}

function parseClaudeCost(text: string): GlobalUsageSnapshot | null {
	const costMatch = text.match(/total\s+cost:\s*\$?([\d,.]+)/i);
	if (!costMatch) return null;
	const cost = Number.parseFloat(costMatch[1].replace(/,/g, ""));
	return {
		quotas: [
			{
				type: "credits",
				label: "Current session cost",
				dollarRemaining: undefined,
				percentRemaining: undefined,
				percentUsed: undefined,
				status: "unknown",
			},
		],
		dailyUsage: { tokens: 0, costUsd: Number.isFinite(cost) ? cost : 0, sessionCount: 1, workingTimeMs: 0 },
		source: "cli_cost",
		confidence: "medium",
	};
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

function getAnthropicAdminKey(): string | undefined {
	return process.env.ANTHROPIC_ADMIN_API_KEY || process.env.ANTHROPIC_ADMIN_KEY || process.env.CLAUDE_ADMIN_API_KEY;
}

function utcDateString(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

function sumNumbersByKey(value: unknown, predicate: (key: string) => boolean): number {
	let total = 0;
	const visit = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
			if (typeof nested === "number" && Number.isFinite(nested) && predicate(key)) {
				total += nested;
			} else if (nested && typeof nested === "object") {
				visit(nested);
			}
		}
	};
	visit(value);
	return total;
}

export async function fetchClaudeAdminUsagePage(adminKey: string, page?: string): Promise<unknown> {
	const params = new URLSearchParams({ starting_at: utcDateString(), limit: "1000" });
	if (page) params.set("page", page);
	const res = await fetch(`https://api.anthropic.com/v1/organizations/usage_report/claude_code?${params}`, {
		headers: {
			"anthropic-version": "2023-06-01",
			"x-api-key": adminKey,
			"User-Agent": "Oscorpex CLI Usage Observatory",
			Accept: "application/json",
		},
		signal: AbortSignal.timeout(20_000),
	});
	if (res.status === 401 || res.status === 403) {
		throw new Error("Claude Admin API key is invalid or lacks usage permissions");
	}
	if (!res.ok) {
		throw new Error(`Claude Admin API HTTP ${res.status}`);
	}
	return res.json();
}

async function probeClaudeAdminAPI(): Promise<GlobalUsageSnapshot | null> {
	const adminKey = getAnthropicAdminKey();
	if (!adminKey) return null;

	const records: unknown[] = [];
	let page: string | undefined;
	for (let i = 0; i < 5; i++) {
		const body = await fetchClaudeAdminUsagePage(adminKey, page) as Record<string, unknown>;
		if (Array.isArray(body.data)) records.push(...body.data);
		if (!body.has_more || !body.next_page) break;
		page = body.next_page as string;
	}

	const inputTokens = sumNumbersByKey(records, (key) => /input.*token/i.test(key));
	const outputTokens = sumNumbersByKey(records, (key) => /output.*token/i.test(key));
	const cacheTokens = sumNumbersByKey(records, (key) => /cache.*token/i.test(key));
	const totalTokensFromExplicit = sumNumbersByKey(records, (key) => /^total.*token/i.test(key));
	const totalTokens = totalTokensFromExplicit || inputTokens + outputTokens + cacheTokens;
	const totalCost = sumNumbersByKey(records, (key) => /cost|usd|amount/i.test(key));
	const sessionCount = sumNumbersByKey(records, (key) => /num_sessions|sessions/i.test(key));

	return {
		quotas: [],
		dailyUsage: {
			tokens: Math.round(totalTokens),
			costUsd: Number(totalCost.toFixed(4)),
			sessionCount: Math.round(sessionCount),
			workingTimeMs: 0,
		},
		source: "provider_api",
		confidence: records.length > 0 ? "high" : "medium",
		accountTier: "Claude Admin API",
	};
}

// ---------------------------------------------------------------------------
// OAuth Usage API
// ---------------------------------------------------------------------------

interface ClaudeOAuthUsageResponse {
	five_hour?: { utilization?: number; resets_at?: string };
	seven_day?: { utilization?: number; resets_at?: string };
	seven_day_sonnet?: { utilization?: number; resets_at?: string };
	seven_day_opus?: { utilization?: number; resets_at?: string };
	extra_usage?: { is_enabled?: boolean; used_credits?: number; monthly_limit?: number };
}

async function probeClaudeOAuthAPI(): Promise<{ global: GlobalUsageSnapshot; authStatus: AuthStatus } | null> {
	let creds = loadClaudeOAuthCredentials();
	if (!creds) return null;

	// Refresh if needed
	if (claudeOAuthNeedsRefresh(creds)) {
		const refreshed = await refreshClaudeOAuthToken(creds);
		if (refreshed) {
			creds = refreshed;
		} else if (!creds.expiresAt) {
			// Token has no expiry info and no refresh possible — try anyway
		} else {
			return null; // expired and refresh failed
		}
	}

	// Fetch usage
	let res: Response;
	try {
		res = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Authorization: `Bearer ${creds.accessToken}`,
				Accept: "application/json",
				"Content-Type": "application/json",
				"anthropic-beta": "oauth-2025-04-20",
				"User-Agent": "Oscorpex CLI Usage Observatory",
			},
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		return null;
	}

	if (res.status === 401 || res.status === 403) {
		// Try refresh once on auth failure
		if (creds.refreshToken) {
			const refreshed = await refreshClaudeOAuthToken(creds);
			if (!refreshed) return null;
			try {
				res = await fetch("https://api.anthropic.com/api/oauth/usage", {
					headers: {
						Authorization: `Bearer ${refreshed.accessToken}`,
						Accept: "application/json",
						"Content-Type": "application/json",
						"anthropic-beta": "oauth-2025-04-20",
						"User-Agent": "Oscorpex CLI Usage Observatory",
					},
					signal: AbortSignal.timeout(15_000),
				});
				if (!res.ok) return null;
			} catch {
				return null;
			}
		} else {
			return null;
		}
	}

	if (!res.ok) return null;

	let body: ClaudeOAuthUsageResponse;
	try {
		body = (await res.json()) as ClaudeOAuthUsageResponse;
	} catch {
		return null;
	}

	const quotas: UsageQuota[] = [];

	// 5-hour session quota
	if (body.five_hour?.utilization != null) {
		const pctRemaining = Math.max(0, Math.min(100, 100 - body.five_hour.utilization));
		quotas.push({
			type: "session",
			label: "5h session",
			percentRemaining: pctRemaining,
			percentUsed: body.five_hour.utilization,
			resetsAt: body.five_hour.resets_at,
			resetText: body.five_hour.resets_at ? `Resets ${body.five_hour.resets_at}` : undefined,
			status: quotaStatus(pctRemaining),
		});
	}

	// 7-day weekly quota
	if (body.seven_day?.utilization != null) {
		const pctRemaining = Math.max(0, Math.min(100, 100 - body.seven_day.utilization));
		quotas.push({
			type: "weekly",
			label: "Weekly (all models)",
			percentRemaining: pctRemaining,
			percentUsed: body.seven_day.utilization,
			resetsAt: body.seven_day.resets_at,
			resetText: body.seven_day.resets_at ? `Resets ${body.seven_day.resets_at}` : undefined,
			status: quotaStatus(pctRemaining),
		});
	}

	// Sonnet-specific quota
	if (body.seven_day_sonnet?.utilization != null) {
		const pctRemaining = Math.max(0, Math.min(100, 100 - body.seven_day_sonnet.utilization));
		quotas.push({
			type: "model_specific",
			label: "Weekly (Sonnet)",
			percentRemaining: pctRemaining,
			percentUsed: body.seven_day_sonnet.utilization,
			resetsAt: body.seven_day_sonnet.resets_at,
			resetText: body.seven_day_sonnet.resets_at ? `Resets ${body.seven_day_sonnet.resets_at}` : undefined,
			status: quotaStatus(pctRemaining),
		});
	}

	// Opus-specific quota
	if (body.seven_day_opus?.utilization != null) {
		const pctRemaining = Math.max(0, Math.min(100, 100 - body.seven_day_opus.utilization));
		quotas.push({
			type: "model_specific",
			label: "Weekly (Opus)",
			percentRemaining: pctRemaining,
			percentUsed: body.seven_day_opus.utilization,
			resetsAt: body.seven_day_opus.resets_at,
			resetText: body.seven_day_opus.resets_at ? `Resets ${body.seven_day_opus.resets_at}` : undefined,
			status: quotaStatus(pctRemaining),
		});
	}

	// Extra usage (Pro/Max accounts)
	if (body.extra_usage?.is_enabled && body.extra_usage.used_credits != null) {
		const costUsd = body.extra_usage.used_credits / 100;
		const budgetUsd = body.extra_usage.monthly_limit != null ? body.extra_usage.monthly_limit / 100 : undefined;
		quotas.push({
			type: "credits",
			label: "Extra usage",
			dollarRemaining: budgetUsd != null ? Math.max(0, budgetUsd - costUsd) : undefined,
			percentRemaining: budgetUsd ? Math.max(0, Math.min(100, ((budgetUsd - costUsd) / budgetUsd) * 100)) : undefined,
			percentUsed: budgetUsd ? Math.min(100, (costUsd / budgetUsd) * 100) : undefined,
			status: budgetUsd ? quotaStatus(Math.max(0, ((budgetUsd - costUsd) / budgetUsd) * 100)) : "unknown",
		});
	}

	// Detect account tier
	const tierMap: Record<string, string> = {
		claude_max: "Claude Max",
		max: "Claude Max",
		claude_pro: "Claude Pro",
		pro: "Claude Pro",
		team: "Claude Team",
		api: "Claude API",
		claude_api: "Claude API",
	};
	const accountTier = creds.subscriptionType
		? (tierMap[creds.subscriptionType.toLowerCase()] ?? creds.subscriptionType)
		: undefined;

	return {
		global: {
			quotas,
			dailyUsage: undefined,
			accountTier,
			source: "provider_api",
			confidence: quotas.length > 0 ? "high" : "medium",
		},
		authStatus: "connected",
	};
}

// ---------------------------------------------------------------------------
// Main probe entry point
// ---------------------------------------------------------------------------

export async function probeClaude(
	def: CLIProviderDef,
	binaryPath: string,
	permissions: ProviderProbePermission,
): Promise<{ global: GlobalUsageSnapshot | null; authStatus: AuthStatus; errors: string[] }> {
	if (!permissions.enabled) return { global: null, authStatus: "unknown", errors: [] };
	const errors: string[] = [];

	// Strategy 1: OAuth API (most reliable — structured JSON, no CLI parsing)
	if (permissions.allowAuthFileRead) {
		try {
			const oauthResult = await probeClaudeOAuthAPI();
			if (oauthResult) {
				if (permissions.allowAuthFileRead && !oauthResult.global.dailyUsage?.tokens) {
					oauthResult.global.dailyUsage = summarizeClaudeDailyUsage();
				}
				return { global: oauthResult.global, authStatus: oauthResult.authStatus, errors };
			}
			errors.push("Claude OAuth credentials not found or expired; falling back to other probes");
		} catch (err) {
			errors.push(sanitizeError(err));
		}
	}

	// Strategy 2: Admin API (organization-level, requires ANTHROPIC_ADMIN_API_KEY)
	if (permissions.allowNetworkProbe) {
		try {
			const global = await probeClaudeAdminAPI();
			if (global) {
				if (permissions.allowAuthFileRead && !global.dailyUsage?.tokens) {
					global.dailyUsage = summarizeClaudeDailyUsage();
				}
				return { global, authStatus: "connected", errors };
			}
			errors.push("Claude Admin API key is not configured; falling back to CLI probes");
		} catch (err) {
			errors.push(sanitizeError(err));
		}
	}

	// Strategy 3: CLI /usage (fragile — parses text output)
	try {
		const usage = await runCommand(binaryPath, ["/usage", "--allowed-tools", ""], {
			timeoutMs: 20_000,
			envExclusions: ["CLAUDE_CODE_OAUTH_TOKEN"],
		});
		if (usage.code === 0) {
			const quotas = parsePercentQuota(`${usage.stdout}\n${usage.stderr}`, def.id);
			if (quotas.length > 0) {
				const global: GlobalUsageSnapshot = { quotas, source: "cli_usage", confidence: "high" };
				if (permissions.allowAuthFileRead) global.dailyUsage = summarizeClaudeDailyUsage();
				return { global, authStatus: "connected", errors };
			}
		}
		errors.push("Claude /usage did not return parseable quotas");
	} catch (err) {
		errors.push(sanitizeError(err));
	}

	// Strategy 4: CLI /cost (for API billing accounts)
	try {
		const cost = await runCommand(binaryPath, ["/cost", "--allowed-tools", ""], {
			timeoutMs: 15_000,
			envExclusions: ["CLAUDE_CODE_OAUTH_TOKEN"],
		});
		const global = parseClaudeCost(`${cost.stdout}\n${cost.stderr}`);
		if (global) {
			if (permissions.allowAuthFileRead) global.dailyUsage = summarizeClaudeDailyUsage();
			return { global, authStatus: "connected", errors };
		}
	} catch (err) {
		errors.push(sanitizeError(err));
	}

	// Strategy 5: Local JSONL only (no global quota info, but at least daily stats)
	if (permissions.allowAuthFileRead) {
		const dailyUsage = summarizeClaudeDailyUsage();
		if (dailyUsage.tokens > 0) {
			return {
				global: {
					quotas: [],
					dailyUsage,
					source: "local_jsonl",
					confidence: "low",
				},
				authStatus: "unknown",
				errors,
			};
		}
	}

	return { global: null, authStatus: "unknown", errors };
}
