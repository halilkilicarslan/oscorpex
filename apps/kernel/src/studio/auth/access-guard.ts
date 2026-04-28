// ---------------------------------------------------------------------------
// Unified Access Guard
// Single entry point for HTTP route authorization.
// Default behavior: deny unless explicitly public.
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { authMiddleware } from "./auth-middleware.js";
import { requireTenantContext } from "./tenant-context.js";
import { createLogger } from "../logger.js";

const log = createLogger("access-guard");

/** Routes that do not require authentication */
const PUBLIC_ROUTES: Array<string | RegExp> = [
	"/health",
	"/auth/register",
	"/auth/login",
	"/api/studio/auth/register",
	"/api/studio/auth/login",
];

function isPublicRoute(path: string): boolean {
	return PUBLIC_ROUTES.some((r) => (typeof r === "string" ? path === r : r.test(path)));
}

/**
 * Unified access guard middleware.
 *
 * Behavior:
 *   1. Public routes → skip auth
 *   2. SSE streams → skip auth (handled at connection level)
 *   3. Otherwise → delegate to authMiddleware
 *
 * When auth is not configured and NODE_ENV !== production,
 * authMiddleware sets authType="none" and allows the request.
 */
export async function accessGuard(c: Context, next: Next): Promise<void | Response> {
	const path = c.req.path;

	// Public routes
	if (isPublicRoute(path)) {
		return next();
	}

	// SSE streams bypass here; WS/SSE auth handled in upgrade handshake
	if (c.req.header("accept")?.includes("text/event-stream")) {
		return next();
	}

	// Delegate to auth middleware (handles legacy key, JWT, DB API key)
	const authResult = await authMiddleware(c, async () => {});
	if (authResult) return authResult;

	// Tenant isolation: when auth is enabled, every protected request MUST have a tenant
	const tenantError = requireTenantContext(c);
	if (tenantError) return tenantError;

	return next();
}

/** Factory: create a guard scoped to a specific permission */
export function requirePermission(permission: string) {
	return async (c: Context, next: Next): Promise<void | Response> => {
		// First ensure the user is authenticated
		const authResult = await authMiddleware(c, async () => {});
		if (authResult) return authResult; // 401/403 from authMiddleware

		// Then check permission via RBAC
		const { requirePermission: rbacRequire } = await import("./rbac.js");
		return rbacRequire(permission)(c, next);
	};
}
