// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Codex Probe
// Probes Codex CLI via local auth file and ChatGPT usage API.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../logger.js";
import { sanitizeError } from "../binary-locator.js";
import type { AuthStatus, CLIProviderDef, GlobalUsageSnapshot, ProviderProbePermission, UsageQuota } from "../types.js";

const log = createLogger("cli-usage:codex-probe");

function loadJSONFile(path: string): Record<string, unknown> | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function findCodexAccessToken(json: Record<string, unknown> | null): string | undefined {
	if (!json) return undefined;
	return (
		(json.access_token as string | undefined) ||
		(json.accessToken as string | undefined) ||
		((json.tokens as Record<string, unknown> | undefined)?.access_token as string | undefined) ||
		((json.auth as Record<string, unknown> | undefined)?.access_token as string | undefined)
	);
}

function resetDateFromWindow(window: Record<string, unknown> | undefined): string | undefined {
	if (!window) return undefined;
	const nowSeconds = Date.now() / 1000;
	if (Number.isFinite(window.reset_at)) return new Date((window.reset_at as number) * 1000).toISOString();
	if (Number.isFinite(window.reset_after_seconds))
		return new Date((nowSeconds + (window.reset_after_seconds as number)) * 1000).toISOString();
	return undefined;
}

function quotaStatus(percentRemaining?: number): import("../types.js").QuotaStatus {
	if (percentRemaining == null || !Number.isFinite(percentRemaining)) return "unknown";
	if (percentRemaining <= 0) return "depleted";
	if (percentRemaining < 20) return "critical";
	if (percentRemaining < 50) return "warning";
	return "healthy";
}

export async function probeCodex(
	def: CLIProviderDef,
	permissions: ProviderProbePermission,
): Promise<{ global: GlobalUsageSnapshot | null; authStatus: AuthStatus; errors: string[] }> {
	if (!permissions.enabled) return { global: null, authStatus: "unknown", errors: [] };
	if (!permissions.allowAuthFileRead)
		return { global: null, authStatus: "unknown", errors: ["Auth file read permission is disabled"] };

	const authPath = join(homedir(), ".codex", "auth.json");
	const auth = loadJSONFile(authPath);
	if (!auth) return { global: null, authStatus: "missing", errors: ["Codex auth file not found"] };
	if (!permissions.allowNetworkProbe)
		return { global: null, authStatus: "connected", errors: ["Network probe is disabled"] };

	const accessToken = findCodexAccessToken(auth);
	if (!accessToken) return { global: null, authStatus: "expired", errors: ["Codex access token not found"] };

	try {
		const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
				"User-Agent": "Oscorpex CLI Usage Observatory",
			},
			signal: AbortSignal.timeout(15_000),
		});
		if (res.status === 401 || res.status === 403) {
			return { global: null, authStatus: "expired", errors: ["Codex auth expired or unauthorized"] };
		}
		if (!res.ok) return { global: null, authStatus: "connected", errors: [`Codex usage HTTP ${res.status}`] };
		const body = (await res.json()) as Record<string, unknown>;
		const quotas: UsageQuota[] = [];
		const rateLimit = body.rate_limit as Record<string, Record<string, unknown>> | undefined;
		const primaryUsed = Number(
			res.headers.get("x-codex-primary-used-percent") ?? rateLimit?.primary_window?.used_percent,
		);
		const secondaryUsed = Number(
			res.headers.get("x-codex-secondary-used-percent") ?? rateLimit?.secondary_window?.used_percent,
		);
		const primaryReset = resetDateFromWindow(rateLimit?.primary_window);
		const secondaryReset = resetDateFromWindow(rateLimit?.secondary_window);
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
		const credits = body.credits as Record<string, unknown> | undefined;
		const creditsBalance = Number(res.headers.get("x-codex-credits-balance") ?? credits?.balance);
		if (Number.isFinite(creditsBalance)) {
			quotas.push({ type: "credits", label: "Credits", dollarRemaining: creditsBalance, status: "unknown" });
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
