// ---------------------------------------------------------------------------
// Oscorpex — Auth Middleware
// Supports three auth modes (in priority order):
//   1. Legacy OSCORPEX_API_KEY env var (backward compat, no tenant/user context)
//   2. JWT Bearer token (user sessions)
//   3. DB-backed API key with "osx_" prefix (tenant API keys)
//
// If OSCORPEX_API_KEY is not set, auth is fully optional (backward compat).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { Context, Next } from "hono";
import { queryOne } from "../pg.js";
import { verifyJwt } from "./jwt.js";

// Context variables populated by this middleware
export interface AuthVariables {
	authType: "api-key" | "jwt" | "api-key-db" | "none";
	userId: string;
	email: string;
	tenantId: string;
	userRole: string;
}

// biome-ignore lint/suspicious/noExplicitAny: Hono Context is generic — use any to avoid requiring explicit Env param everywhere
export async function authMiddleware(c: Context<{ Variables: AuthVariables }>, next: Next): Promise<void | Response>;
export async function authMiddleware(c: Context, next: Next): Promise<void | Response>;
// biome-ignore lint/suspicious/noExplicitAny: implementation signature
export async function authMiddleware(c: Context<any>, next: Next): Promise<void | Response> {
	const authHeader = c.req.header("Authorization") ?? c.req.header("authorization");
	const envApiKey = process.env.OSCORPEX_API_KEY;

	// ------------------------------------------------------------------
	// 1. Legacy env API key — backward compatible, no tenant context
	// ------------------------------------------------------------------
	if (envApiKey && authHeader === `Bearer ${envApiKey}`) {
		c.set("authType", "api-key");
		return next();
	}

	// ------------------------------------------------------------------
	// 2. JWT Bearer token
	// ------------------------------------------------------------------
	if (authHeader?.startsWith("Bearer ") && !authHeader.startsWith("Bearer osx_")) {
		const token = authHeader.slice(7);
		const payload = verifyJwt(token);
		if (payload) {
			c.set("authType", "jwt");
			c.set("userId", payload.sub);
			c.set("email", payload.email);
			c.set("tenantId", payload.tenantId);
			c.set("userRole", payload.role);
			return next();
		}
	}

	// ------------------------------------------------------------------
	// 3. DB-backed API key (osx_ prefix)
	// ------------------------------------------------------------------
	if (authHeader?.startsWith("Bearer osx_")) {
		const keyValue = authHeader.slice(7);
		const keyHash = createHash("sha256").update(keyValue).digest("hex");
		const row = await queryOne<{
			id: string;
			user_id: string;
			tenant_id: string;
			role: string;
		}>(
			`SELECT ak.id, ak.user_id, ak.tenant_id, ur.role
			 FROM api_keys ak
			 JOIN user_roles ur ON ak.user_id = ur.user_id AND ak.tenant_id = ur.tenant_id
			 WHERE ak.key_hash = $1 AND (ak.expires_at IS NULL OR ak.expires_at > now())`,
			[keyHash],
		);
		if (row) {
			c.set("authType", "api-key-db");
			c.set("userId", row.user_id);
			c.set("tenantId", row.tenant_id);
			c.set("userRole", row.role);
			// Non-blocking last_used_at update
			queryOne("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [row.id]).catch(() => {});
			return next();
		}
	}

	// ------------------------------------------------------------------
	// 4. No valid auth — if no env key configured, allow (backward compat)
	// ------------------------------------------------------------------
	if (!envApiKey) {
		c.set("authType", "none");
		return next();
	}

	return c.json({ error: "Unauthorized" }, 401);
}
