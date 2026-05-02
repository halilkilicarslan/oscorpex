// ---------------------------------------------------------------------------
// Unified Access Guard
// Single entry point for HTTP route authorization.
// Default behavior: deny unless explicitly public or listed in permission matrix.
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { createLogger } from "../logger.js";
import { authMiddleware } from "./auth-middleware.js";
import { getRoutePermission, isKnownRoute, isPublicRoute } from "./route-permissions.js";
import { requireTenantContext } from "./tenant-context.js";

const log = createLogger("access-guard");

/**
 * Unified access guard middleware.
 *
 * Behavior:
 *   1. Public routes → skip auth
 *   2. Unknown routes → 403 (default deny)
 *   3. Known routes → auth + tenant + optional RBAC
 *
 * When auth is not configured and NODE_ENV !== production,
 * authMiddleware sets authType="none" and allows the request.
 *
 * SSE streams are NOT exempt — they follow the same rules as
 * any other HTTP request. If a route needs public SSE access,
 * add its path to PUBLIC_ROUTES explicitly.
 */
export async function accessGuard(c: Context, next: Next): Promise<void | Response> {
	const originalPath = c.req.path;
	const path = originalPath.startsWith("/api/studio") ? originalPath.slice("/api/studio".length) || "/" : originalPath;
	const method = c.req.method;

	// 1. Public routes — no auth required
	if (isPublicRoute(path)) {
		return next();
	}

	// 2. Default deny — unknown routes are rejected
	if (!isKnownRoute(path, method)) {
		log.warn(`[access-guard] Denied unknown route: ${method} ${originalPath}`);
		return c.json({ error: "Forbidden — unknown route", route: originalPath, method }, 403);
	}

	// 3. Authenticate
	const authResult = await authMiddleware(c, async () => {});
	if (authResult) return authResult;

	// 4. Tenant isolation
	const tenantError = requireTenantContext(c);
	if (tenantError) return tenantError;

	// 5. Route-level permission check (from permission matrix)
	const routePermission = getRoutePermission(path, method);
	if (routePermission !== null && routePermission !== undefined) {
		// null = auth required but no specific permission; anything else = RBAC check
		const { requirePermission: rbacRequire } = await import("./rbac.js");
		const rbacResult = await rbacRequire(routePermission)(c, async () => {});
		if (rbacResult) {
			log.warn(
				`[access-guard] Permission denied: ${method} ${originalPath} requires ${routePermission} ` +
					`(user=${c.get("userId") ?? "unknown"}, tenant=${c.get("tenantId") ?? "none"})`,
			);
			return rbacResult;
		}
	}

	// 6. Audit log for sensitive operations
	if (method !== "GET" && method !== "HEAD") {
		log.info(
			`[access-guard] Allowed: ${method} ${originalPath} ` +
				`(user=${c.get("userId") ?? "unknown"}, tenant=${c.get("tenantId") ?? "none"}, ` +
				`permission=${routePermission ?? "auth-only"})`,
		);
	}

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
