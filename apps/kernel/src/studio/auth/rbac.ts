// ---------------------------------------------------------------------------
// Oscorpex — RBAC (Role-Based Access Control)
// Permission definitions, hierarchy checks, and Hono middleware factory.
// ---------------------------------------------------------------------------

import type { Context, MiddlewareHandler, Next } from "hono";
import { createLogger } from "../logger.js";
const log = createLogger("rbac");

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
		"quality-gates:read",
		"quality-gates:evaluate",
		"approvals:read",
		"approvals:request",
		"approvals:decide",
		"release:read",
		"release:create",
		"release:decide",
		"release:override",
		"release:rollback",
		"artifacts:read",
		"artifacts:write",
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
		"quality-gates:read",
		"quality-gates:evaluate",
		"approvals:read",
		"approvals:request",
		"release:read",
		"release:create",
		"release:decide",
		"artifacts:read",
		"artifacts:write",
	],
	viewer: [
		"projects:read",
		"agents:read",
		"tasks:read",
		"team:read",
		"billing:read",
		"plugins:read",
		"quality-gates:read",
		"approvals:read",
		"release:read",
		"artifacts:read",
	],
	billing: ["billing:read", "projects:read"],
};

/**
 * Check whether a role holds a given permission.
 * Supports wildcard notation: "projects:*" grants any "projects:<action>".
 */
export function hasPermission(role: Role | string, permission: string): boolean {
	// Owner is the highest-privilege tenant role and can access all scoped actions.
	if (role === "owner") return true;

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
 *   - authType === "api-key-db" → DB-backed key: scope check first, then role check
 *
 * M6.4 Scope enforcement for DB-backed API keys:
 *   If the key has declared scopes, the requested permission must be covered by one of them.
 *   Scope matching rules:
 *     - "*"              → grants any permission (superscope)
 *     - "resource:*"     → grants all actions on a resource (e.g. "projects:*")
 *     - "resource:action" → exact permission match (e.g. "projects:read")
 *   If scopes are empty the check falls through to normal role-based enforcement.
 */
// biome-ignore lint/suspicious/noExplicitAny: middleware must be env-agnostic to work across all routers
export function requirePermission(permission: string): MiddlewareHandler<any> {
	return async (c, next) => {
		const authType = c.get("authType") as string | undefined;

		// No auth configured (dev mode / backward compat) — allow
		if (!authType || authType === "none") return next();

		// Legacy env API key = system-level access, skip permission check
		if (authType === "api-key") return next();

		// M6.4: Scope check for DB-backed API keys
		// If the key has declared scopes, the scope check is authoritative:
		//   - Scope granted  → return next() immediately (bypass role check)
		//   - Scope denied   → return 403 immediately
		//   - Scopes empty   → fall through to role-based check (backward compat)
		if (authType === "api-key-db") {
			const scopes = c.get("apiKeyScopes") as string[] | undefined;
			if (scopes && scopes.length > 0) {
				const [permResource] = permission.split(":");
				const scopeGranted = scopes.some((s) => {
					if (s === "*") return true; // superscope — grants everything
					if (s === permission) return true; // exact match
					const [sResource, sAction] = s.split(":");
					return sResource === permResource && sAction === "*"; // resource wildcard
				});
				if (!scopeGranted) {
					return c.json(
						{
							error: "API key scope insufficient",
							required: permission,
							scopes,
						},
						403,
					);
				}
				// Scope explicitly granted — skip role check (scope is the authority)
				return next();
			}
		}

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
