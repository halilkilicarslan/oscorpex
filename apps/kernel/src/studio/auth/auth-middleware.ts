// ---------------------------------------------------------------------------
// Oscorpex — Auth Middleware
// Supports three auth modes (in priority order):
//   1. Legacy OSCORPEX_API_KEY env var (backward compat, no tenant/user context)
//   2. JWT Bearer token (user sessions)
//   3. DB-backed API key with "osx_" prefix (tenant API keys)
//
// If OSCORPEX_API_KEY is not set, auth is fully optional (backward compat).
// ---------------------------------------------------------------------------

import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { createLogger } from "../logger.js";
import { queryOne } from "../pg.js";
import { enterRequestTenant, runSysLookupAtBoundary } from "../tenancy/tenant-scope.js";
import { verifyJwt } from "./jwt.js";
const log = createLogger("auth-middleware");

/** The single-tenant "local" tenant used by dev bypass and the legacy env API key. */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Context variables populated by this middleware
export interface AuthVariables {
	authType: "api-key" | "jwt" | "api-key-db" | "none";
	userId: string;
	email: string;
	tenantId: string;
	userRole: string;
	/** M6.4: Scopes declared on a DB-backed API key (osx_* prefix). Empty = role-only check. */
	apiKeyScopes: string[];
	/** users.is_platform_admin (or dev bypass / legacy operator key). Never derived from the token. */
	isPlatformAdmin: boolean;
}

/** Actor recorded for the legacy OSCORPEX_API_KEY. */
export const LEGACY_OPERATOR_ID = "legacy-operator";

/**
 * One round trip (SECURITY DEFINER, system scope): does the user still exist, what is their role in the token's
 * tenant, and are they a platform admin. Role and admin flag always come from the DB, never from the token.
 */
async function lookupIdentity(
	userId: string,
	tenantId: string,
): Promise<{ role: string | null; isPlatformAdmin: boolean } | null> {
	const row = await runSysLookupAtBoundary("auth:identity-lookup", () =>
		queryOne<{ role: string | null; is_platform_admin: boolean }>(
			"SELECT role, is_platform_admin FROM sys_identity_lookup($1, $2)",
			[userId, tenantId],
		),
	);
	if (!row) return null;
	return { role: row.role, isPlatformAdmin: row.is_platform_admin === true };
}

/** Constant-time comparison of the presented Authorization header against the legacy key. */
export function legacyKeyMatches(authHeader: string | undefined, envApiKey: string): boolean {
	if (!authHeader) return false;
	// Hash both sides so lengths are equal and timingSafeEqual never throws or leaks the key length.
	const a = createHash("sha256").update(authHeader).digest();
	const b = createHash("sha256").update(`Bearer ${envApiKey}`).digest();
	return timingSafeEqual(a, b);
}

/** In production with auth enabled the legacy key must be re-enabled explicitly. */
export function legacyKeyAllowed(): boolean {
	if (process.env.NODE_ENV === "production" && process.env.OSCORPEX_AUTH_ENABLED === "true") {
		return process.env.OSCORPEX_ALLOW_LEGACY_API_KEY === "true";
	}
	return true;
}

// biome-ignore lint/suspicious/noExplicitAny: Hono Context is generic — use any to avoid requiring explicit Env param everywhere
export async function authMiddleware(
	c: Context<{ Variables: AuthVariables }>,
	next: Next,
): Promise<undefined | Response>;
export async function authMiddleware(c: Context, next: Next): Promise<undefined | Response>;
// biome-ignore lint/suspicious/noExplicitAny: implementation signature
export async function authMiddleware(c: Context<any>, next: Next): Promise<undefined | Response> {
	// Already authenticated earlier in this request (e.g. route-level guard after accessGuard): nothing to redo.
	if (c.get("authType") && c.get("tenantId")) {
		await next();
		return undefined;
	}

	const authHeader = c.req.header("Authorization") ?? c.req.header("authorization");
	const envApiKey = process.env.OSCORPEX_API_KEY;

	// ------------------------------------------------------------------
	// 1. Legacy env API key — backward compatible, no tenant context
	// ------------------------------------------------------------------
	if (envApiKey && legacyKeyMatches(authHeader, envApiKey)) {
		if (!legacyKeyAllowed()) {
			log.warn("[auth] legacy OSCORPEX_API_KEY rejected: OSCORPEX_ALLOW_LEGACY_API_KEY is not enabled in production");
			return c.json({ error: "Unauthorized" }, 401);
		}
		c.set("authType", "api-key");
		c.set("userId", LEGACY_OPERATOR_ID);
		c.set("tenantId", LOCAL_TENANT_ID);
		c.set("isPlatformAdmin", true);
		await next();
		return undefined;
	}

	// ------------------------------------------------------------------
	// 2. JWT Bearer token
	// ------------------------------------------------------------------
	if (authHeader?.startsWith("Bearer ") && !authHeader.startsWith("Bearer osx_")) {
		const token = authHeader.slice(7);
		const payload = verifyJwt(token);
		// With auth enabled the local tenant is reserved for dev/legacy-key; a JWT must never carry it.
		if (payload && process.env.OSCORPEX_AUTH_ENABLED === "true" && payload.tenantId === LOCAL_TENANT_ID) {
			log.warn("[auth] JWT with reserved local tenant rejected");
			return c.json({ error: "Unauthorized" }, 401);
		}
		if (payload) {
			const identity = await lookupIdentity(payload.sub, payload.tenantId);
			// A token without a tenant is left to requireTenantContext (403); with a tenant, a role row is mandatory.
			if (!identity || (!identity.role && payload.tenantId)) {
				log.warn("[auth] JWT rejected: user missing or has no role in the token's tenant");
				return c.json({ error: "Unauthorized" }, 401);
			}
			c.set("authType", "jwt");
			c.set("userId", payload.sub);
			c.set("email", payload.email);
			c.set("tenantId", payload.tenantId);
			c.set("userRole", identity.role ?? undefined);
			c.set("isPlatformAdmin", identity.isPlatformAdmin);
			await next();
			return undefined;
		}
	}

	// ------------------------------------------------------------------
	// 3. DB-backed API key (osx_ prefix)
	// ------------------------------------------------------------------
	if (authHeader?.startsWith("Bearer osx_")) {
		const keyValue = authHeader.slice(7);
		const keyHash = createHash("sha256").update(keyValue).digest("hex");
		// sys_api_key_lookup is SECURITY DEFINER: the only way to resolve a key before the tenant is known.
		const row = await runSysLookupAtBoundary("auth:api-key-lookup", () =>
			queryOne<{
				id: string;
				user_id: string;
				tenant_id: string | null;
				role: string | null;
				scopes: string[] | null;
				is_platform_admin: boolean | null;
			}>(
				// One query: key lookup + identity check (inner join: a key whose user no longer exists matches nothing)
				`SELECT k.id, k.user_id, k.tenant_id, k.scopes, i.role, i.is_platform_admin
				 FROM sys_api_key_lookup($1) k
				 JOIN LATERAL sys_identity_lookup(k.user_id, k.tenant_id) i ON true`,
				[keyHash],
			),
		);
		if (row && (!row.tenant_id || !row.role)) {
			log.warn("[auth] API key without tenant or role rejected");
			return c.json({ error: "Unauthorized" }, 401);
		}
		// With auth enabled the local tenant is reserved for dev/legacy-key; a DB key must never carry it
		// (same rule as for JWTs above).
		if (row && process.env.OSCORPEX_AUTH_ENABLED === "true" && row.tenant_id === LOCAL_TENANT_ID) {
			log.warn("[auth] API key bound to the reserved local tenant rejected");
			return c.json({ error: "Unauthorized" }, 401);
		}
		if (row) {
			c.set("authType", "api-key-db");
			c.set("userId", row.user_id);
			c.set("tenantId", row.tenant_id);
			c.set("userRole", row.role);
			// M6.4: Store API key scopes for scope-aware permission enforcement in rbac.ts
			const scopes = row.scopes ?? [];
			// A scoped key reaches platform:admin only through an explicit "platform:admin" scope (never "*").
			c.set(
				"isPlatformAdmin",
				row.is_platform_admin === true && (scopes.length === 0 || scopes.includes("platform:admin")),
			);
			if (scopes.length > 0) {
				c.set("apiKeyScopes", scopes);
			}
			// Non-blocking last_used_at update
			enterRequestTenant(row.tenant_id as string, () =>
				queryOne("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [row.id]),
			).catch((err) => log.warn({ err }, "[auth-middleware] api key last_used_at update failed"));
			await next();
			return undefined;
		}
	}

	// ------------------------------------------------------------------
	// 4. No valid auth — P0-5: require explicit opt-in for auth bypass
	// ------------------------------------------------------------------
	if (!envApiKey) {
		if (process.env.NODE_ENV === "production") {
			log.error("[auth] OSCORPEX_API_KEY not configured in production — rejecting request");
			return c.json({ error: "Unauthorized — authentication not configured" }, 500);
		}
		// P0-5: Dev auth bypass requires explicit opt-in flag
		if (process.env.OSCORPEX_DEV_NO_AUTH === "true") {
			log.warn("[auth] Auth disabled via OSCORPEX_DEV_NO_AUTH=true — using dev tenant context");
			c.set("authType", "none");
			c.set("userId", "00000000-0000-0000-0000-000000000002");
			c.set("tenantId", "00000000-0000-0000-0000-000000000001");
			c.set("userRole", "owner");
			c.set("isPlatformAdmin", true);
			c.set("email", "dev@oscorpex.local");
			await next();
			return undefined;
		}
		// P0-5: No auth configured and no explicit bypass — reject
		log.error("[auth] No auth configured. Set OSCORPEX_API_KEY or OSCORPEX_DEV_NO_AUTH=true for development");
		return c.json({ error: "Unauthorized — set OSCORPEX_API_KEY or OSCORPEX_DEV_NO_AUTH=true" }, 401);
	}

	return c.json({ error: "Unauthorized" }, 401);
}
