// ---------------------------------------------------------------------------
// Unified Access Guard
// Single entry point for HTTP route authorization.
// Default behavior: deny unless explicitly public or listed in permission matrix.
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { createLogger } from "../logger.js";
import { enterRequestTenant, runAsSystemAtBoundary, runWithoutScopeAtBoundary } from "../tenancy/tenant-scope.js";
import { LOCAL_TENANT_ID, authMiddleware } from "./auth-middleware.js";
import { getRoutePermission, isKnownRoute, isPublicRoute } from "./route-permissions.js";
import { requireTenantContext } from "./tenant-context.js";

const log = createLogger("access-guard");

/** Tenant of the authenticated request; the dev bypass (authType "none") always maps to the local tenant. */
function resolveRequestTenant(c: Context): string | null | undefined {
	if (c.get("authType") === "none") return LOCAL_TENANT_ID;
	return c.get("tenantId") as string | null | undefined;
}

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
		// Public routes never touch tenant data: run outside any scope (also drops an inherited implicit test scope).
		return runWithoutScopeAtBoundary(async () => next());
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

	// 7. Run the downstream handler inside the request's tenant scope (RLS: app.current_tenant_id)
	const tenantId = resolveRequestTenant(c);
	if (!tenantId) {
		log.warn(`[access-guard] No tenant after authentication: ${method} ${originalPath}`);
		return c.json({ error: "Forbidden — tenant context required" }, 403);
	}
	// Platform-wide aggregate endpoints read cross-tenant data through sys_* functions: system scope.
	// Only for /platform/* — other platform:admin routes (providers, plugins, …) keep the caller's tenant scope.
	if (routePermission === "platform:admin" && path.startsWith("/platform/")) {
		return runAsSystemAtBoundary("platform-admin", next);
	}
	return enterRequestTenant(tenantId, next);
}

/**
 * Guard for the observability router (mounted outside the studio router).
 * Until observability tables are tenant-scoped (F5-6) the whole router is platform-admin only.
 * Authenticates, requires users.is_platform_admin and runs the handler in the caller's tenant scope.
 * CORS preflight is answered by the cors middleware registered before this guard.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: Hono middleware contract (Next resolves to void)
export async function observabilityGuard(c: Context, next: Next): Promise<void | Response> {
	const authResult = await authMiddleware(c, async () => {});
	if (authResult) return authResult;

	const tenantError = requireTenantContext(c);
	if (tenantError) return tenantError;

	const { requirePermission: rbacRequire } = await import("./rbac.js");
	const rbacResult = await rbacRequire("platform:admin")(c, async () => {});
	if (rbacResult) return rbacResult;

	const tenantId = resolveRequestTenant(c);
	if (!tenantId) return c.json({ error: "Forbidden — tenant context required" }, 403);
	return enterRequestTenant(tenantId, next);
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
