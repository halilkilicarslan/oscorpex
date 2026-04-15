// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory
// Tracks local AI coding CLIs, global provider quota snapshots, and Oscorpex
// token/cost attribution without storing credentials or raw provider payloads.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execute, query, queryOne } from "./pg.js";

export type CLIProviderId = "claude" | "codex" | "gemini" | "aider";
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

interface CLIProviderDef {
	id: CLIProviderId;
	label: string;
	binary: string;
	versionArgs: string[];
	cliToolAliases: string[];
	modelHints: string[];
	providerHints: string[];
}

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
		id: "aider",
		label: "Aider",
		binary: "aider",
		versionArgs: ["--version"],
		cliToolAliases: ["aider"],
		modelHints: [],
		providerHints: [],
	},
];

const TOKENISH_KEYS = /token|secret|credential|cookie|authorization|access|refresh|api[_-]?key/i;
let ensureTablesPromise: Promise<void> | null = null;

function ensureCLIUsageTables(): Promise<void> {
	if (!ensureTablesPromise) {
		ensureTablesPromise = (async () => {
			await execute(`
				CREATE TABLE IF NOT EXISTS cli_probe_settings (
					provider_id TEXT PRIMARY KEY,
					enabled INTEGER NOT NULL DEFAULT 0,
					allow_auth_file_read INTEGER NOT NULL DEFAULT 0,
					allow_network_probe INTEGER NOT NULL DEFAULT 0,
					refresh_interval_sec INTEGER NOT NULL DEFAULT 300,
					updated_at TEXT NOT NULL
				)
			`);
			await execute(`
				CREATE TABLE IF NOT EXISTS cli_usage_snapshots (
					id TEXT PRIMARY KEY,
					provider_id TEXT NOT NULL,
					snapshot_json TEXT NOT NULL,
					captured_at TEXT NOT NULL,
					source TEXT NOT NULL DEFAULT 'unavailable',
					confidence TEXT NOT NULL DEFAULT 'low'
				)
			`);
			await execute(`
				CREATE TABLE IF NOT EXISTS cli_probe_events (
					id TEXT PRIMARY KEY,
					provider_id TEXT NOT NULL,
					status TEXT NOT NULL,
					message TEXT NOT NULL DEFAULT '',
					created_at TEXT NOT NULL
				)
			`);
			await execute("CREATE INDEX IF NOT EXISTS idx_cli_usage_snapshots_provider ON cli_usage_snapshots(provider_id)");
			await execute("CREATE INDEX IF NOT EXISTS idx_cli_usage_snapshots_captured ON cli_usage_snapshots(captured_at)");
			await execute("CREATE INDEX IF NOT EXISTS idx_cli_probe_events_provider ON cli_probe_events(provider_id)");
		})();
	}
	return ensureTablesPromise;
}

function now(): string {
	return new Date().toISOString();
}

function startOfToday(): string {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	return date.toISOString();
}

function startOfWeek(): string {
	const date = new Date();
	date.setDate(date.getDate() - 7);
	return date.toISOString();
}

function quotaStatus(percentRemaining?: number): QuotaStatus {
	if (percentRemaining == null || !Number.isFinite(percentRemaining)) return "unknown";
	if (percentRemaining <= 0) return "depleted";
	if (percentRemaining < 20) return "critical";
	if (percentRemaining < 50) return "warning";
	return "healthy";
}

function worstQuotaStatus(quotas: UsageQuota[]): QuotaStatus {
	const severity: Record<QuotaStatus, number> = { unknown: 0, healthy: 1, warning: 2, critical: 3, depleted: 4 };
	return quotas.map((quota) => quota.status).sort((a, b) => severity[b] - severity[a])[0] ?? "unknown";
}

function lowestPercentRemaining(quotas: UsageQuota[]): number | undefined {
	const values = quotas
		.map((quota) => quota.percentRemaining)
		.filter((value): value is number => value !== undefined && Number.isFinite(value));
	if (values.length === 0) return undefined;
	return Math.min(...values);
}

function sanitizeError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").slice(0, 400);
}

function assertNoTokenishValues(value: unknown): void {
	if (!value || typeof value !== "object") return;
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (TOKENISH_KEYS.test(key)) {
			throw new Error(`Refusing to persist token-like snapshot key: ${key}`);
		}
		if (typeof nested === "object") assertNoTokenishValues(nested);
	}
}

function commonPaths(): string[] {
	const home = homedir();
	return [
		`${home}/.local/bin`,
		`${home}/.cargo/bin`,
		`${home}/bin`,
		"/opt/homebrew/bin",
		"/usr/local/bin",
		`${home}/.npm-global/bin`,
		`${home}/Library/pnpm`,
		`${home}/.nvm/versions`,
	];
}

function findInCommonPaths(binary: string): string | undefined {
	for (const base of commonPaths()) {
		const direct = join(base, binary);
		if (existsSync(direct)) return direct;

		if (base.includes(".nvm/versions")) {
			const nodeRoot = join(base, "node");
			if (!existsSync(nodeRoot)) continue;
			try {
				const versions = readdirSync(nodeRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
				for (const version of versions) {
					const candidate = join(nodeRoot, version, "bin", binary);
					if (existsSync(candidate)) return candidate;
				}
			} catch {
				// ignore
			}
		}
	}
	return undefined;
}

function locateBinary(binary: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const shell = process.env.SHELL || "/bin/zsh";
		const proc = spawn(shell, ["-lc", `command -v ${binary}`], {
			stdio: ["ignore", "pipe", "ignore"],
			env: { ...process.env, PATH: process.env.PATH },
		});
		let output = "";
		proc.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString("utf-8");
		});
		proc.on("close", (code) => {
			const resolved = code === 0 ? output.trim().split("\n")[0] : undefined;
			resolve(resolved || findInCommonPaths(binary));
		});
		proc.on("error", () => resolve(findInCommonPaths(binary)));
		setTimeout(() => {
			try {
				proc.kill();
			} catch {
				// ignore
			}
			resolve(findInCommonPaths(binary));
		}, 3_000);
	});
}

function runCommand(
	binary: string,
	args: string[],
	options?: { input?: string; timeoutMs?: number; envExclusions?: string[] },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const env = { ...process.env };
		for (const key of options?.envExclusions ?? []) {
			delete env[key];
		}

		const proc = spawn(binary, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
			shell: false,
		});
		let stdout = "";
		let stderr = "";
		const maxOutput = 80_000;
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {
				// ignore
			}
			reject(new Error(`Command timed out: ${binary} ${args.join(" ")}`));
		}, options?.timeoutMs ?? 15_000);

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdout = (stdout + chunk.toString("utf-8")).slice(-maxOutput);
		});
		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf-8")).slice(-maxOutput);
		});
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		if (options?.input) {
			proc.stdin?.write(options.input);
		}
		proc.stdin?.end();
	});
}

async function probeBinary(def: CLIProviderDef): Promise<{ installed: boolean; binaryPath?: string; version?: string; errors: string[] }> {
	const binaryPath = await locateBinary(def.binary);
	if (!binaryPath) return { installed: false, errors: [] };

	try {
		const result = await runCommand(binaryPath, def.versionArgs, { timeoutMs: 5_000 });
		const version = (result.stdout.trim() || result.stderr.trim()).split("\n")[0];
		return { installed: true, binaryPath, version, errors: result.code === 0 ? [] : [`version exited with code ${result.code}`] };
	} catch (err) {
		return { installed: true, binaryPath, errors: [sanitizeError(err)] };
	}
}

export async function getCLIProbeSettings(providerId: CLIProviderId): Promise<ProviderProbePermission> {
	await ensureCLIUsageTables();
	const row = await queryOne<any>("SELECT * FROM cli_probe_settings WHERE provider_id = $1", [providerId]);
	return {
		enabled: Boolean(row?.enabled),
		allowAuthFileRead: Boolean(row?.allow_auth_file_read),
		allowNetworkProbe: Boolean(row?.allow_network_probe),
		refreshIntervalSec: Number.parseInt(row?.refresh_interval_sec ?? "300", 10),
	};
}

export async function setCLIProbeSettings(
	providerId: CLIProviderId,
	settings: Partial<ProviderProbePermission>,
): Promise<ProviderProbePermission> {
	await ensureCLIUsageTables();
	const existing = await getCLIProbeSettings(providerId);
	const next = {
		enabled: settings.enabled ?? existing.enabled,
		allowAuthFileRead: settings.allowAuthFileRead ?? existing.allowAuthFileRead,
		allowNetworkProbe: settings.allowNetworkProbe ?? existing.allowNetworkProbe,
		refreshIntervalSec: settings.refreshIntervalSec ?? existing.refreshIntervalSec,
	};
	await execute(
		`INSERT INTO cli_probe_settings (provider_id, enabled, allow_auth_file_read, allow_network_probe, refresh_interval_sec, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (provider_id) DO UPDATE SET
		   enabled = EXCLUDED.enabled,
		   allow_auth_file_read = EXCLUDED.allow_auth_file_read,
		   allow_network_probe = EXCLUDED.allow_network_probe,
		   refresh_interval_sec = EXCLUDED.refresh_interval_sec,
		   updated_at = EXCLUDED.updated_at`,
		[
			providerId,
			next.enabled ? 1 : 0,
			next.allowAuthFileRead ? 1 : 0,
			next.allowNetworkProbe ? 1 : 0,
			next.refreshIntervalSec,
			now(),
		],
	);
	return next;
}

async function recordProbeEvent(providerId: CLIProviderId, status: string, message: string): Promise<void> {
	await ensureCLIUsageTables();
	await execute(
		"INSERT INTO cli_probe_events (id, provider_id, status, message, created_at) VALUES ($1, $2, $3, $4, $5)",
		[randomUUID(), providerId, status, message.slice(0, 500), now()],
	).catch(() => {});
}

async function persistSnapshot(snapshot: CLIUsageSnapshot): Promise<void> {
	await ensureCLIUsageTables();
	assertNoTokenishValues(snapshot.global);
	await execute(
		"INSERT INTO cli_usage_snapshots (id, provider_id, snapshot_json, captured_at, source, confidence) VALUES ($1, $2, $3, $4, $5, $6)",
		[
			randomUUID(),
			snapshot.providerId,
			JSON.stringify(snapshot),
			snapshot.lastCheckedAt,
			snapshot.global?.source ?? "unavailable",
			snapshot.global?.confidence ?? "low",
		],
	);
}

export async function latestCLIUsageSnapshots(): Promise<CLIUsageSnapshot[]> {
	await ensureCLIUsageTables();
	const rows = await query<any>(
		`SELECT DISTINCT ON (provider_id) provider_id, snapshot_json
		 FROM cli_usage_snapshots
		 ORDER BY provider_id, captured_at DESC`,
	);
	return rows.map((row) => JSON.parse(row.snapshot_json) as CLIUsageSnapshot);
}

export async function getCLIUsageHistory(providerId?: CLIProviderId, limit = 100): Promise<CLIUsageTrendPoint[]> {
	await ensureCLIUsageTables();
	const cappedLimit = Math.min(Math.max(limit, 1), 500);
	const rows = providerId
		? await query<any>(
				`SELECT provider_id, snapshot_json, captured_at, source, confidence
				 FROM cli_usage_snapshots
				 WHERE provider_id = $1
				 ORDER BY captured_at DESC
				 LIMIT $2`,
				[providerId, cappedLimit],
			)
		: await query<any>(
				`SELECT provider_id, snapshot_json, captured_at, source, confidence
				 FROM cli_usage_snapshots
				 ORDER BY captured_at DESC
				 LIMIT $1`,
				[cappedLimit],
			);

	return rows.map((row) => {
		const snapshot = JSON.parse(row.snapshot_json) as CLIUsageSnapshot;
		const quotas = snapshot.global?.quotas ?? [];
		return {
			providerId: row.provider_id,
			capturedAt: row.captured_at,
			source: row.source,
			confidence: row.confidence,
			worstStatus: worstQuotaStatus(quotas),
			lowestPercentRemaining: lowestPercentRemaining(quotas),
		};
	});
}

export async function getCLIProbeEvents(providerId?: CLIProviderId, limit = 50): Promise<CLIProbeEvent[]> {
	await ensureCLIUsageTables();
	const cappedLimit = Math.min(Math.max(limit, 1), 200);
	const rows = providerId
		? await query<any>(
				`SELECT * FROM cli_probe_events WHERE provider_id = $1 ORDER BY created_at DESC LIMIT $2`,
				[providerId, cappedLimit],
			)
		: await query<any>(`SELECT * FROM cli_probe_events ORDER BY created_at DESC LIMIT $1`, [cappedLimit]);

	return rows.map((row) => ({
		id: row.id,
		providerId: row.provider_id,
		status: row.status,
		message: row.message,
		createdAt: row.created_at,
	}));
}

async function getOscorpexUsage(def: CLIProviderDef): Promise<OscorpexUsageSnapshot> {
	const today = startOfToday();
	const week = startOfWeek();
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

	const todayRow = await queryOne<any>(
		`SELECT COALESCE(SUM(tu.total_tokens),0) AS tokens, COALESCE(SUM(tu.cost_usd),0) AS cost
		 FROM token_usage tu
		 LEFT JOIN project_agents pa ON pa.id = tu.agent_id
		 WHERE tu.created_at >= $1 AND ${usageWhere}`,
		[today, cliAliases, modelPatterns, providerPatterns],
	);
	const weekRow = await queryOne<any>(
		`SELECT COALESCE(SUM(tu.total_tokens),0) AS tokens, COALESCE(SUM(tu.cost_usd),0) AS cost
		 FROM token_usage tu
		 LEFT JOIN project_agents pa ON pa.id = tu.agent_id
		 WHERE tu.created_at >= $1 AND ${usageWhere}`,
		[week, cliAliases, modelPatterns, providerPatterns],
	);
	const runRow = await queryOne<any>(
		"SELECT COUNT(*) AS cnt FROM agent_runs WHERE cli_tool = ANY($1) AND created_at >= $2",
		[cliAliases, week],
	);
	const failureRow = await queryOne<any>(
		`SELECT COUNT(*) AS cnt
		 FROM events e
		 LEFT JOIN project_agents pa ON pa.id = e.agent_id
		 WHERE e.type = 'task:failed' AND e.timestamp >= $1 AND pa.cli_tool = ANY($2)`,
		[week, cliAliases],
	);
	const breakdownRows = await query<any>(
		`SELECT p.id AS project_id, p.name AS project_name, COALESCE(SUM(tu.total_tokens),0) AS tokens, COALESCE(SUM(tu.cost_usd),0) AS cost
		 FROM token_usage tu
		 JOIN projects p ON p.id = tu.project_id
		 LEFT JOIN project_agents pa ON pa.id = tu.agent_id
		 WHERE tu.created_at >= $1 AND ${usageWhere}
		 GROUP BY p.id, p.name
		 ORDER BY cost DESC
		 LIMIT 10`,
		[week, cliAliases, modelPatterns, providerPatterns],
	);

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

function parsePercentQuota(text: string, providerId: CLIProviderId): UsageQuota[] {
	const clean = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
	const quotas: UsageQuota[] = [];
	const lines = clean.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].toLowerCase();
		const window = lines.slice(i, i + 8).join(" ");
		const pctMatch = window.match(/([0-9]{1,3})%\s+(?:left|remaining)/i);
		if (!pctMatch) continue;
		const percentRemaining = Math.max(0, Math.min(100, Number.parseInt(pctMatch[1], 10)));
		const resetMatch = window.match(/resets?\s+(?:in\s+)?([^|•\n]+)/i);
		if (line.includes("weekly")) {
			quotas.push({
				type: "weekly",
				label: "Weekly",
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
		} else if (line.includes("5h") || line.includes("session") || line.includes("limit")) {
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

interface ClaudeJSONLRecord {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	timestamp: Date;
}

function findRecentClaudeJSONLFiles(): string[] {
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

function parseClaudeJSONLRecords(): ClaudeJSONLRecord[] {
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
				const json = JSON.parse(line);
				if (json.type !== "assistant") continue;
				const usage = json.message?.usage;
				const model = json.message?.model;
				const timestamp = json.timestamp ? new Date(json.timestamp) : null;
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

async function fetchClaudeAdminUsagePage(adminKey: string, page?: string): Promise<any> {
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

	const records: any[] = [];
	let page: string | undefined;
	for (let i = 0; i < 5; i++) {
		const body = await fetchClaudeAdminUsagePage(adminKey, page);
		if (Array.isArray(body.data)) records.push(...body.data);
		if (!body.has_more || !body.next_page) break;
		page = body.next_page;
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

async function probeClaude(def: CLIProviderDef, binaryPath: string, permissions: ProviderProbePermission): Promise<{ global: GlobalUsageSnapshot | null; authStatus: AuthStatus; errors: string[] }> {
	if (!permissions.enabled) return { global: null, authStatus: "unknown", errors: [] };
	const errors: string[] = [];
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

	return { global: null, authStatus: "unknown", errors };
}

function loadJSONFile(path: string): Record<string, any> | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function findCodexAccessToken(json: Record<string, any> | null): string | undefined {
	if (!json) return undefined;
	return json.access_token || json.accessToken || json.tokens?.access_token || json.auth?.access_token;
}

async function probeCodex(def: CLIProviderDef, permissions: ProviderProbePermission): Promise<{ global: GlobalUsageSnapshot | null; authStatus: AuthStatus; errors: string[] }> {
	if (!permissions.enabled) return { global: null, authStatus: "unknown", errors: [] };
	if (!permissions.allowAuthFileRead) return { global: null, authStatus: "unknown", errors: ["Auth file read permission is disabled"] };

	const authPath = join(homedir(), ".codex", "auth.json");
	const auth = loadJSONFile(authPath);
	if (!auth) return { global: null, authStatus: "missing", errors: ["Codex auth file not found"] };
	if (!permissions.allowNetworkProbe) return { global: null, authStatus: "connected", errors: ["Network probe is disabled"] };

	const accessToken = findCodexAccessToken(auth);
	if (!accessToken) return { global: null, authStatus: "expired", errors: ["Codex access token not found"] };

	try {
		const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "Oscorpex CLI Usage Observatory" },
			signal: AbortSignal.timeout(15_000),
		});
		if (res.status === 401 || res.status === 403) {
			return { global: null, authStatus: "expired", errors: ["Codex auth expired or unauthorized"] };
		}
		if (!res.ok) return { global: null, authStatus: "connected", errors: [`Codex usage HTTP ${res.status}`] };
		const body = await res.json() as any;
		const quotas: UsageQuota[] = [];
		const primaryUsed = Number(res.headers.get("x-codex-primary-used-percent") ?? body.rate_limit?.primary_window?.used_percent);
		const secondaryUsed = Number(res.headers.get("x-codex-secondary-used-percent") ?? body.rate_limit?.secondary_window?.used_percent);
		const primaryReset = resetDateFromWindow(body.rate_limit?.primary_window);
		const secondaryReset = resetDateFromWindow(body.rate_limit?.secondary_window);
		if (Number.isFinite(primaryUsed)) {
			const remaining = Math.max(0, 100 - primaryUsed);
			quotas.push({
				type: "session",
				label: "Primary / session",
				percentRemaining: remaining,
				percentUsed: primaryUsed,
				resetsAt: primaryReset,
				resetText: primaryReset ? `Resets ${primaryReset}` : undefined,
				status: quotaStatus(remaining),
			});
		}
		if (Number.isFinite(secondaryUsed)) {
			const remaining = Math.max(0, 100 - secondaryUsed);
			quotas.push({
				type: "weekly",
				label: "Secondary / weekly",
				percentRemaining: remaining,
				percentUsed: secondaryUsed,
				resetsAt: secondaryReset,
				resetText: secondaryReset ? `Resets ${secondaryReset}` : undefined,
				status: quotaStatus(remaining),
			});
		}
		const credits = Number(res.headers.get("x-codex-credits-balance") ?? body.credits?.balance);
		if (Number.isFinite(credits)) {
			quotas.push({ type: "credits", label: "Credits", dollarRemaining: credits, status: "unknown" });
		}
		return {
			global: {
				quotas,
				accountTier: body.plan_type ? String(body.plan_type).toUpperCase() : undefined,
				source: "provider_api",
				confidence: quotas.length > 0 ? "high" : "low",
			},
			authStatus: "connected",
			errors: quotas.length > 0 ? [] : ["Codex usage response did not contain quotas"],
		};
	} catch (err) {
		return { global: null, authStatus: "connected", errors: [sanitizeError(err)] };
	}
}

function resetDateFromWindow(window: any): string | undefined {
	if (!window) return undefined;
	const nowSeconds = Date.now() / 1000;
	if (Number.isFinite(window.reset_at)) return new Date(window.reset_at * 1000).toISOString();
	if (Number.isFinite(window.reset_after_seconds)) return new Date((nowSeconds + window.reset_after_seconds) * 1000).toISOString();
	return undefined;
}

async function probeGemini(permissions: ProviderProbePermission): Promise<{ global: GlobalUsageSnapshot | null; authStatus: AuthStatus; errors: string[] }> {
	if (!permissions.enabled) return { global: null, authStatus: "unknown", errors: [] };
	if (!permissions.allowAuthFileRead) return { global: null, authStatus: "unknown", errors: ["Auth file read permission is disabled"] };

	const credsPath = join(homedir(), ".gemini", "oauth_creds.json");
	const creds = loadJSONFile(credsPath);
	if (!creds) return { global: null, authStatus: "missing", errors: ["Gemini OAuth credentials not found"] };
	if (!permissions.allowNetworkProbe) return { global: null, authStatus: "connected", errors: ["Network probe is disabled"] };

	const accessToken = creds.access_token;
	if (!accessToken) return { global: null, authStatus: "expired", errors: ["Gemini access token not found"] };

	try {
		const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
			method: "POST",
			headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
			body: "{}",
			signal: AbortSignal.timeout(15_000),
		});
		if (res.status === 401 || res.status === 403) {
			return { global: null, authStatus: "expired", errors: ["Gemini auth expired or unauthorized"] };
		}
		if (!res.ok) return { global: null, authStatus: "connected", errors: [`Gemini quota HTTP ${res.status}`] };
		const body = await res.json() as any;
		const buckets = Array.isArray(body.buckets) ? body.buckets : [];
		const quotas = buckets
			.map((bucket: any) => {
				const fraction = Number(bucket.remainingFraction);
				if (!Number.isFinite(fraction)) return null;
				const percentRemaining = Math.max(0, Math.min(100, fraction * 100));
				return {
					type: "model_specific" as const,
					label: bucket.modelId || "Gemini model",
					percentRemaining,
					percentUsed: 100 - percentRemaining,
					resetsAt: bucket.resetTime,
					resetText: bucket.resetTime ? `Resets ${bucket.resetTime}` : undefined,
					status: quotaStatus(percentRemaining),
				};
			})
			.filter(Boolean) as UsageQuota[];
		return {
			global: { quotas, source: "provider_api", confidence: quotas.length > 0 ? "high" : "low" },
			authStatus: "connected",
			errors: quotas.length > 0 ? [] : ["Gemini quota response did not contain quotas"],
		};
	} catch (err) {
		return { global: null, authStatus: "connected", errors: [sanitizeError(err)] };
	}
}

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
	let authStatus: AuthStatus = providerId === "aider" ? "not_supported" : "unknown";

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
		} else if (providerId === "aider") {
			global = {
				quotas: [],
				source: "unavailable",
				confidence: "low",
			};
			errors.push("Aider quota is delegated to its underlying model provider");
		}
	}

	if (!permissions.enabled && providerId !== "aider") {
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
			await persistSnapshot(snapshot).catch((err) => recordProbeEvent(providerId, "error", sanitizeError(err)));
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
	const entries = await Promise.all(PROVIDERS.map(async (provider) => [provider.id, await getOscorpexUsage(provider)] as const));
	return Object.fromEntries(entries) as Record<CLIProviderId, OscorpexUsageSnapshot>;
}

export function isCLIProviderId(value: string): value is CLIProviderId {
	return PROVIDERS.some((provider) => provider.id === value);
}
