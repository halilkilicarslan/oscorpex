// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Persistence
// Handles DB table creation, snapshot persistence, and query operations.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../db.js";
import { createLogger } from "../logger.js";
import { assertNoTokenishValues } from "./binary-locator.js";
import type { CLIProbeEvent, CLIProviderId, CLIUsageSnapshot, CLIUsageTrendPoint, ProviderProbePermission } from "./types.js";

const log = createLogger("cli-usage:persistence");

let ensureTablesPromise: Promise<void> | null = null;

export function ensureCLIUsageTables(): Promise<void> {
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
		})().catch((err) => {
			ensureTablesPromise = null;
			throw err;
		});
	}
	return ensureTablesPromise;
}

function now(): string {
	return new Date().toISOString();
}

function worstQuotaStatus(quotas: import("./types.js").UsageQuota[]): import("./types.js").QuotaStatus {
	const severity: Record<import("./types.js").QuotaStatus, number> = {
		unknown: 0,
		healthy: 1,
		warning: 2,
		critical: 3,
		depleted: 4,
	};
	return quotas.map((quota) => quota.status).sort((a, b) => severity[b] - severity[a])[0] ?? "unknown";
}

function lowestPercentRemaining(quotas: import("./types.js").UsageQuota[]): number | undefined {
	const values = quotas
		.map((quota) => quota.percentRemaining)
		.filter((value): value is number => value !== undefined && Number.isFinite(value));
	if (values.length === 0) return undefined;
	return Math.min(...values);
}

export async function getCLIProbeSettings(providerId: CLIProviderId): Promise<ProviderProbePermission> {
	await ensureCLIUsageTables();
	const row = await queryOne<Record<string, unknown>>(
		"SELECT * FROM cli_probe_settings WHERE provider_id = $1",
		[providerId],
	);
	return {
		enabled: Boolean(row?.enabled),
		allowAuthFileRead: Boolean(row?.allow_auth_file_read),
		allowNetworkProbe: Boolean(row?.allow_network_probe),
		refreshIntervalSec: Number.parseInt(String(row?.refresh_interval_sec ?? "300"), 10),
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

export async function recordProbeEvent(providerId: CLIProviderId, status: string, message: string): Promise<void> {
	await ensureCLIUsageTables();
	await execute(
		"INSERT INTO cli_probe_events (id, provider_id, status, message, created_at) VALUES ($1, $2, $3, $4, $5)",
		[randomUUID(), providerId, status, message.slice(0, 500), now()],
	).catch((err) => log.warn("[cli-usage] recordProbeEvent failed:" + " " + String((err as Error).message)));
}

export async function persistSnapshot(snapshot: CLIUsageSnapshot): Promise<void> {
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
	const rows = await query<Record<string, string>>(
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
		? await query<Record<string, string>>(
				`SELECT provider_id, snapshot_json, captured_at, source, confidence
				 FROM cli_usage_snapshots
				 WHERE provider_id = $1
				 ORDER BY captured_at DESC
				 LIMIT $2`,
				[providerId, cappedLimit],
			)
		: await query<Record<string, string>>(
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
			providerId: row.provider_id as CLIProviderId,
			capturedAt: row.captured_at,
			source: row.source as import("./types.js").UsageSource,
			confidence: row.confidence as import("./types.js").UsageConfidence,
			worstStatus: worstQuotaStatus(quotas),
			lowestPercentRemaining: lowestPercentRemaining(quotas),
		};
	});
}

export async function getCLIProbeEvents(providerId?: CLIProviderId, limit = 50): Promise<CLIProbeEvent[]> {
	await ensureCLIUsageTables();
	const cappedLimit = Math.min(Math.max(limit, 1), 200);
	const rows = providerId
		? await query<Record<string, string>>(
				`SELECT * FROM cli_probe_events WHERE provider_id = $1 ORDER BY created_at DESC LIMIT $2`,
				[providerId, cappedLimit],
			)
		: await query<Record<string, string>>(
				`SELECT * FROM cli_probe_events ORDER BY created_at DESC LIMIT $1`,
				[cappedLimit],
			);

	return rows.map((row) => ({
		id: row.id,
		providerId: row.provider_id as CLIProviderId,
		status: row.status,
		message: row.message,
		createdAt: row.created_at,
	}));
}
