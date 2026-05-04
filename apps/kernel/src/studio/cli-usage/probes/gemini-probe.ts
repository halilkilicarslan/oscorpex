// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Gemini Probe
// Probes Gemini CLI via local OAuth credentials and Cloud Code quota API.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../logger.js";
import { sanitizeError } from "../binary-locator.js";
import type { AuthStatus, GlobalUsageSnapshot, ProviderProbePermission, UsageQuota } from "../types.js";

const log = createLogger("cli-usage:gemini-probe");

function loadJSONFile(path: string): Record<string, unknown> | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
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

export async function probeGemini(
	permissions: ProviderProbePermission,
): Promise<{ global: GlobalUsageSnapshot | null; authStatus: AuthStatus; errors: string[] }> {
	if (!permissions.enabled) return { global: null, authStatus: "unknown", errors: [] };
	if (!permissions.allowAuthFileRead)
		return { global: null, authStatus: "unknown", errors: ["Auth file read permission is disabled"] };

	const credsPath = join(homedir(), ".gemini", "oauth_creds.json");
	const creds = loadJSONFile(credsPath);
	if (!creds) return { global: null, authStatus: "missing", errors: ["Gemini OAuth credentials not found"] };
	if (!permissions.allowNetworkProbe)
		return { global: null, authStatus: "connected", errors: ["Network probe is disabled"] };

	const accessToken = creds.access_token as string | undefined;
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
		const body = (await res.json()) as Record<string, unknown>;
		const buckets = Array.isArray(body.buckets) ? (body.buckets as Record<string, unknown>[]) : [];
		const quotas = buckets
			.map((bucket) => {
				const fraction = Number(bucket.remainingFraction);
				if (!Number.isFinite(fraction)) return null;
				const percentRemaining = Math.max(0, Math.min(100, fraction * 100));
				return {
					type: "model_specific" as const,
					label: (bucket.modelId as string | undefined) || "Gemini model",
					percentRemaining,
					percentUsed: 100 - percentRemaining,
					resetsAt: bucket.resetTime as string | undefined,
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
