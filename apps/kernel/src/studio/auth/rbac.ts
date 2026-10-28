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

/** Permission satisfied exclusively by the isPlatformAdmin flag. */
export const PLATFORM_ADMIN_PERMISSION = "platform:admin";

/**
 * Check whether a role holds a given permission.
 * Supports wildcard notation: "projects:*" grants any "projects:<action>".
 */
export function hasPermission(role: Role | string, permission: string): boolean {
	if (permission === PLATFORM_ADMIN_PERMISSION) return false;
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
 * M6.4 Scope enforcement for DB-backed API keys (scopes only narrow — role AND scope must both allow):
 *   If the key has declared scopes, the requested permission must be covered by one of them.
 *   Scope matching rules:
 *     - "*"              → grants any permission (superscope)
 *     - "resource:*"     → grants all actions on a resource (e.g. "projects:*")
 *     - "resource:action" → exact permission match (e.g. "projects:read")
 *   The role-based check always runs afterwards; empty scopes simply mean "no extra narrowing".
 */
// biome-ignore lint/suspicious/noExplicitAny: middleware must be env-agnostic to work across all routers
export function requirePermission(permission: string): MiddlewareHandler<any> {
	return async (c, next) => {
		const authType = c.get("authType") as string | undefined;

		// platform:admin is granted ONLY by users.is_platform_admin (resolved by authMiddleware, never from
		// the token, roles or API-key scopes).
		if (permission === PLATFORM_ADMIN_PERMISSION) {
			if (c.get("isPlatformAdmin") === true) return next();
			return c.json({ error: "Forbidden", required: permission }, 403);
		}

		// No auth configured (dev mode / backward compat) — allow
		if (!authType || authType === "none") return next();

		// Legacy env API key = system-level access, skip permission check
		if (authType === "api-key") return next();

		// M6.4: Scope check for DB-backed API keys
		// If the key has declared scopes they can only narrow what the role allows:
		//   - Scope denied   → 403 immediately
		//   - Scope granted  → the role check below must still pass
		//   - Scopes empty   → role-based check only (backward compat)
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
				// Scope granted: scopes only NARROW access, so the role check below must pass as well.
			}
		}

		const role = c.get("userRole") as string | undefined;
		if (!role || !hasPermission(role, permission)) {
			return c.json({ error: "Forbidden", required: permission, role: role ?? null }, 403);
		}

		return next();
	};
}

const SCOPE_FORMAT = /^[a-z][a-z0-9-]*:([a-z][a-z0-9-]*|\*)$/;

/**
 * May a key created by a user with `role` carry `scope`? Scopes can never exceed the creator's role:
 * the scope must be well-formed and held by the role ("*" and "resource:*" only when the role holds them);
 * "platform:admin" only for platform admins.
 */
export function canGrantApiKeyScope(
	role: Role | string | undefined,
	scope: unknown,
	isPlatformAdmin: boolean,
): boolean {
	if (typeof scope !== "string") return false;
	if (scope === PLATFORM_ADMIN_PERMISSION) return isPlatformAdmin;
	if (!role) return false;
	if (scope === "*") return role === "owner";
	if (!SCOPE_FORMAT.test(scope)) return false;
	if (scope.endsWith(":*")) return role === "owner" || (ROLE_PERMISSIONS[role as Role] ?? []).includes(scope);
	return hasPermission(role, scope);
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
