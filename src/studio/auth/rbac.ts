// ---------------------------------------------------------------------------
// Oscorpex — RBAC (Role-Based Access Control)
// Permission definitions, hierarchy checks, and Hono middleware factory.
// ---------------------------------------------------------------------------

import type { Context, MiddlewareHandler, Next } from "hono";

// Role hierarchy (highest to lowest privilege)
const ROLE_HIERARCHY = ["owner", "admin", "developer", "viewer", "billing"] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];

// Permission definitions per role
const ROLE_PERMISSIONS: Record<Role, string[]> = {
	owner: [
		"projects:*",
		"agents:*",
		"pipeline:*",
		"settings:*",
		"billing:*",
		"plugins:*",
		"webhooks:*",
		"team:*",
		"tasks:*",
		"users:*",
	],
	admin: [
		"projects:read",
		"projects:create",
		"projects:update",
		"projects:delete",
		"agents:read",
		"agents:configure",
		"pipeline:start",
		"pipeline:pause",
		"pipeline:resume",
		"settings:read",
		"settings:write",
		"team:read",
		"team:write",
		"tasks:read",
		"tasks:update",
		"tasks:approve",
		"plugins:read",
		"plugins:write",
	],
	developer: [
		"projects:read",
		"agents:read",
		"pipeline:start",
		"team:read",
		"tasks:read",
		"tasks:update",
		"tasks:approve",
		"plugins:read",
	],
	viewer: ["projects:read", "agents:read", "tasks:read", "team:read", "billing:read", "plugins:read"],
	billing: ["billing:read", "projects:read"],
};

/**
 * Check whether a role holds a given permission.
 * Supports wildcard notation: "projects:*" grants any "projects:<action>".
 */
export function hasPermission(role: Role | string, permission: string): boolean {
	const perms = ROLE_PERMISSIONS[role as Role];
	if (!perms) return false;

	const [resource] = permission.split(":");
	return perms.some((p) => {
		if (p === permission) return true;
		const [pResource, pAction] = p.split(":");
		return pResource === resource && pAction === "*";
	});
}

/**
 * Hono middleware factory — enforce a permission on a route.
 *
 * Bypass rules (backward compat):
 *   - authType === "none"     → no auth configured, allow everything
 *   - authType === "api-key"  → legacy env key, treated as system admin
 *   - authType === "api-key-db" → DB-backed key inherits role from DB (falls through to role check)
 */
// biome-ignore lint/suspicious/noExplicitAny: middleware must be env-agnostic to work across all routers
export function requirePermission(permission: string): MiddlewareHandler<any> {
	return async (c, next) => {
		const authType = c.get("authType") as string | undefined;

		// No auth configured (dev mode / backward compat) — allow
		if (!authType || authType === "none") return next();

		// Legacy env API key = system-level access, skip permission check
		if (authType === "api-key") return next();

		const role = c.get("userRole") as string | undefined;
		if (!role || !hasPermission(role, permission)) {
			return c.json({ error: "Forbidden", required: permission, role: role ?? null }, 403);
		}

		return next();
	};
}

/**
 * Hierarchical role comparison.
 * Returns true if `role` has at least the same privilege as `minimumRole`.
 * Lower index in ROLE_HIERARCHY = higher privilege.
 */
export function isRoleAtLeast(role: Role | string, minimumRole: Role): boolean {
	const roleIdx = ROLE_HIERARCHY.indexOf(role as Role);
	const minIdx = ROLE_HIERARCHY.indexOf(minimumRole);
	if (roleIdx === -1 || minIdx === -1) return false;
	return roleIdx <= minIdx;
}
