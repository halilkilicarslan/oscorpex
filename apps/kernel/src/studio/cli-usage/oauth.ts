// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Claude OAuth Credentials
// Handles credential loading, caching, and token refresh.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logger.js";
import { decrypt, encrypt } from "./credential-vault.js";

const log = createLogger("cli-usage:oauth");

export interface ClaudeOAuthCredentials {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number; // ms since epoch
	subscriptionType?: string;
}

export const CLAUDE_OAUTH_CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_SCOPES = "user:profile user:inference user:sessions:claude_code";
const OAUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 min before expiry

// Credentials are stored as AES-256-GCM encrypted JSON — never as plaintext in memory.
// The per-process key lives only in `credential-vault.ts` and is regenerated on restart.
let cachedCredentials: { encrypted: string; loadedAt: number } | null = null;
const CREDENTIAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function loadJSONFile(path: string): Record<string, unknown> | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Stores credentials encrypted in the module-level cache and emits an audit log entry. */
function cacheCredentials(creds: ClaudeOAuthCredentials): void {
	cachedCredentials = { encrypted: encrypt(JSON.stringify(creds)), loadedAt: Date.now() };
	log.info("[oauth] Credentials cached (encrypted)");
}

/** Reads and decrypts credentials from the module-level cache. Returns null on decryption failure. */
function readCachedCredentials(): ClaudeOAuthCredentials | null {
	if (!cachedCredentials) return null;
	try {
		return JSON.parse(decrypt(cachedCredentials.encrypted)) as ClaudeOAuthCredentials;
	} catch (err) {
		log.warn({ err }, "[oauth] Failed to decrypt cached credentials — evicting cache");
		cachedCredentials = null;
		return null;
	}
}

export function loadClaudeOAuthCredentials(): ClaudeOAuthCredentials | null {
	// Cache check
	if (cachedCredentials && Date.now() - cachedCredentials.loadedAt < CREDENTIAL_CACHE_TTL_MS) {
		return readCachedCredentials();
	}

	// 1. File: ~/.claude/.credentials.json
	const credsPath = join(homedir(), ".claude", ".credentials.json");
	const fileData = loadJSONFile(credsPath);
	if (fileData) {
		const oauth = fileData.claudeAiOauth as Record<string, unknown> | undefined;
		if (oauth?.accessToken) {
			const creds: ClaudeOAuthCredentials = {
				accessToken: oauth.accessToken as string,
				refreshToken: oauth.refreshToken as string | undefined,
				expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
				subscriptionType: oauth.subscriptionType as string | undefined,
			};
			cacheCredentials(creds);
			return creds;
		}
	}

	// 2. Keychain (macOS only)
	if (process.platform === "darwin") {
		try {
			const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null', {
				timeout: 5_000,
				encoding: "utf-8",
			}).trim();
			if (raw) {
				const json = JSON.parse(raw) as Record<string, unknown>;
				const oauth = json.claudeAiOauth as Record<string, unknown> | undefined;
				if (oauth?.accessToken) {
					const creds: ClaudeOAuthCredentials = {
						accessToken: oauth.accessToken as string,
						refreshToken: oauth.refreshToken as string | undefined,
						expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
						subscriptionType: oauth.subscriptionType as string | undefined,
					};
					cacheCredentials(creds);
					return creds;
				}
			}
		} catch {
			// Keychain not available or empty
		}
	}

	// 3. Environment fallback (inference-only token, no refresh)
	const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
	if (envToken) {
		const creds: ClaudeOAuthCredentials = { accessToken: envToken };
		cacheCredentials(creds);
		return creds;
	}

	return null;
}

export function claudeOAuthNeedsRefresh(creds: ClaudeOAuthCredentials): boolean {
	if (!creds.expiresAt) return true; // no expiry info → try refresh
	return Date.now() + OAUTH_REFRESH_BUFFER_MS >= creds.expiresAt;
}

export async function refreshClaudeOAuthToken(creds: ClaudeOAuthCredentials): Promise<ClaudeOAuthCredentials | null> {
	if (!creds.refreshToken) return null;
	try {
		const res = await fetch("https://platform.claude.com/v1/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: creds.refreshToken,
				client_id: CLAUDE_OAUTH_CLIENT_ID,
				scope: CLAUDE_OAUTH_SCOPES,
			}),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) {
			cachedCredentials = null; // evict stale entry on auth failure
			return null;
		}
		const body = (await res.json()) as Record<string, unknown>;
		if (!body.access_token) return null;

		const updated: ClaudeOAuthCredentials = {
			accessToken: body.access_token as string,
			refreshToken: (body.refresh_token as string | undefined) ?? creds.refreshToken,
			expiresAt: typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : creds.expiresAt,
			subscriptionType: creds.subscriptionType,
		};

		// Persist updated credentials back to file
		const credsPath = join(homedir(), ".claude", ".credentials.json");
		const fileData = loadJSONFile(credsPath);
		if (fileData) {
			(fileData as Record<string, unknown>).claudeAiOauth = {
				...(fileData.claudeAiOauth as Record<string, unknown>),
				accessToken: updated.accessToken,
				refreshToken: updated.refreshToken,
				expiresAt: updated.expiresAt,
			};
			try {
				writeFileSync(credsPath, JSON.stringify(fileData, null, 2), "utf-8");
			} catch {
				// non-critical — credential file write failed
			}
		}

		cacheCredentials(updated);
		return updated;
	} catch {
		cachedCredentials = null; // evict on unexpected error
		return null;
	}
}
