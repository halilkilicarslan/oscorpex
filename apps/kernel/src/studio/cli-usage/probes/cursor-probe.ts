// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Cursor Probe
// Reads token from SQLite DB and calls cursor.com/api/usage-summary.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../logger.js";
import { sanitizeError } from "../binary-locator.js";
import type { AuthStatus, GlobalUsageSnapshot, ProviderProbePermission, UsageQuota } from "../types.js";

const log = createLogger("cli-usage:cursor-probe");

const CURSOR_DB_PATH = join(
	homedir(),
	"Library",
	"Application Support",
	"Cursor",
	"User",
	"globalStorage",
	"state.vscdb",
);

export function readCursorAccessToken(): string | null {
	if (!existsSync(CURSOR_DB_PATH)) return null;
	try {
		const raw = execSync(
			`/usr/bin/sqlite3 "${CURSOR_DB_PATH}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"`,
			{ timeout: 5_000, encoding: "utf-8" },
		).trim();
		return raw || null;
	} catch {
		return null;
	}
}

function extractUserIdFromJWT(token: string): string | null {
	const parts = token.split(".");
	if (parts.length < 2) return null;
	try {
		let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const remainder = base64.length % 4;
		if (remainder > 0) base64 += "=".repeat(4 - remainder);
		const payload = JSON.parse(Buffer.from(base64, "base64").toString("utf-8")) as Record<string, unknown>;
		return (payload.sub as string) || null;
	} catch {
		return null;
	}
}

function quotaStatus(percentRemaining?: number): import("../types.js").QuotaStatus {
	if (percentRemaining == null || !Number.isFinite(percentRemaining)) return "unknown";
	if (percentRemaining <= 0) return "depleted";
	if (percentRemaining < 20) return "critical";
	if (percentRemaining < 50) return "warning";
	return "healthy";
}

export async function probeCursor(
	permissions: ProviderProbePermission,
): Promise<{ global: GlobalUsageSnapshot | null; authStatus: AuthStatus; errors: string[] }> {
	if (!permissions.enabled) return { global: null, authStatus: "unknown", errors: [] };
	if (!permissions.allowAuthFileRead)
		return { global: null, authStatus: "unknown", errors: ["Auth file read permission is disabled"] };

	const accessToken = readCursorAccessToken();
	if (!accessToken)
		return { global: null, authStatus: "missing", errors: ["Cursor auth token not found (not logged in?)"] };

	const userId = extractUserIdFromJWT(accessToken);
	if (!userId) return { global: null, authStatus: "expired", errors: ["Cursor JWT token is invalid"] };

	if (!permissions.allowNetworkProbe)
		return { global: null, authStatus: "connected", errors: ["Network probe is disabled"] };

	try {
		const cookie = `WorkosCursorSessionToken=${userId}::${accessToken}`;
		const res = await fetch("https://cursor.com/api/usage-summary", {
			headers: {
				Cookie: cookie,
				"Content-Type": "application/json",
				"User-Agent": "Oscorpex CLI Usage Observatory",
			},
			signal: AbortSignal.timeout(15_000),
		});

		if (res.status === 401 || res.status === 403) {
			return { global: null, authStatus: "expired", errors: ["Cursor auth expired or unauthorized"] };
		}
		if (!res.ok) return { global: null, authStatus: "connected", errors: [`Cursor usage HTTP ${res.status}`] };

		const body = (await res.json()) as Record<string, unknown>;
		const quotas: UsageQuota[] = [];

		// Parse plan usage
		const individualUsage = body.individualUsage as Record<string, Record<string, unknown>> | undefined;
		const planUsage = individualUsage?.plan;
		if (planUsage?.enabled) {
			const used = Number(planUsage.used ?? 0);
			const limit = Number(planUsage.limit ?? 0);
			if (limit > 0) {
				const pctRemaining = Math.max(0, Math.min(100, ((limit - used) / limit) * 100));
				quotas.push({
					type: "session",
					label: "Monthly requests",
					percentRemaining: pctRemaining,
					percentUsed: 100 - pctRemaining,
					resetText: `${used}/${limit} requests`,
					status: quotaStatus(pctRemaining),
				});
			}
		}

		// Parse on-demand usage
		const onDemand = individualUsage?.onDemand;
		if (onDemand?.enabled) {
			const used = Number(onDemand.used ?? 0);
			const limit = Number(onDemand.limit ?? 0);
			if (limit > 0) {
				const pctRemaining = Math.max(0, Math.min(100, ((limit - used) / limit) * 100));
				quotas.push({
					type: "credits",
					label: "On-demand",
					percentRemaining: pctRemaining,
					percentUsed: 100 - pctRemaining,
					resetText: `${used}/${limit} on-demand`,
					status: quotaStatus(pctRemaining),
				});
			}
		}

		// Unlimited plans
		if (body.isUnlimited) {
			quotas.push({
				type: "session",
				label: "Monthly requests",
				percentRemaining: 100,
				status: "healthy",
			});
		}

		// Account tier
		const membershipType = body.membershipType ? String(body.membershipType).toUpperCase() : undefined;

		return {
			global: {
				quotas,
				accountTier: membershipType,
				source: "provider_api",
				confidence: quotas.length > 0 ? "high" : "low",
			},
			authStatus: "connected",
			errors: quotas.length > 0 ? [] : ["Cursor usage response did not contain quotas"],
		};
	} catch (err) {
		return { global: null, authStatus: "connected", errors: [sanitizeError(err)] };
	}
}
