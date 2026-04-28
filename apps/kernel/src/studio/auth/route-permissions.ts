// ---------------------------------------------------------------------------
// Route Permission Matrix
// Maps route prefixes to their required permissions.
// Every protected route MUST be listed here; unknown routes default to deny.
// ---------------------------------------------------------------------------

export interface RoutePermissionEntry {
	pattern: string | RegExp;
	permission: string | null; // null = auth required but no specific permission
	methods?: string[]; // optional method restriction
}

/** Public routes — no auth required */
export const PUBLIC_ROUTES: Array<string | RegExp> = [
	"/health",
	"/auth/register",
	"/auth/login",
	"/api/studio/auth/register",
	"/api/studio/auth/login",
];

/** Protected route permission matrix.
 *  If a route matches a pattern here, it is explicitly known.
 *  If it does NOT match any pattern (public or protected), it defaults to DENY.
 */
export const ROUTE_PERMISSIONS: RoutePermissionEntry[] = [
	// Auth & User management
	{ pattern: "/auth/me", permission: null },
	{ pattern: "/auth/users", permission: "users:read" },
	{ pattern: "/auth/users/", permission: "users:write" },
	{ pattern: "/auth/api-keys", permission: "settings:read" },

	// Projects
	{ pattern: "/projects", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/projects", permission: "projects:create", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+$/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+$/, permission: "projects:update", methods: ["PATCH", "PUT"] },
	{ pattern: /^\/projects\/[^/]+$/, permission: "projects:delete", methods: ["DELETE"] },

	// Project sub-resources (default to projects:read for GET, projects:update for mutating)
	{ pattern: /^\/projects\/[^/]+\/plan/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/plan/, permission: "projects:update", methods: ["POST", "PATCH", "PUT"] },
	{ pattern: /^\/projects\/[^/]+\/pipeline/, permission: "pipeline:start", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/pipeline\/pause/, permission: "pipeline:pause", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/pipeline\/resume/, permission: "pipeline:resume", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/tasks/, permission: "tasks:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/tasks/, permission: "tasks:update", methods: ["POST", "PATCH", "PUT"] },
	{ pattern: /^\/projects\/[^/]+\/agents/, permission: "agents:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/agents/, permission: "agents:configure", methods: ["POST", "PATCH", "PUT", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/team/, permission: "team:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/team/, permission: "team:write", methods: ["POST", "PATCH", "PUT", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/lifecycle/, permission: "projects:update", methods: ["POST", "PUT", "PATCH"] },
	{ pattern: /^\/projects\/[^/]+\/settings/, permission: "settings:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/settings/, permission: "settings:write", methods: ["POST", "PUT", "PATCH"] },
	{ pattern: /^\/projects\/[^/]+\/sprints/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/sprints/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/work-items/, permission: "tasks:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/work-items/, permission: "tasks:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/report/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/hotfix/, permission: "projects:update", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/ceremonies/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/ceremonies/, permission: "projects:update", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/api\/collection/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/api\/collection/, permission: "projects:update", methods: ["POST", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/app\/proxy/, permission: "projects:read", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/rag/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/rag/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/prompts/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/prompts/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/triggers/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/triggers/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/files/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/files/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/git/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/git/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/replay/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/replay/, permission: "projects:update", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/sandbox/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/sandbox/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/graph/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/graph/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/dependencies/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/dependencies/, permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/cost/, permission: "billing:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/webhooks/, permission: "webhooks:read", methods: ["GET"] },
	{ pattern: /^\/projects\/[^/]+\/webhooks/, permission: "webhooks:write", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: /^\/projects\/[^/]+\/generate-readme/, permission: "projects:update", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/from-template/, permission: "projects:create", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/import/, permission: "projects:create", methods: ["POST"] },
	{ pattern: /^\/projects\/[^/]+\/policy-profile/, permission: "projects:update", methods: ["PUT"] },

	// Tasks (global)
	{ pattern: "/tasks", permission: "tasks:read", methods: ["GET"] },
	{ pattern: /^\/tasks\/[^/]+$/, permission: "tasks:read", methods: ["GET"] },
	{ pattern: /^\/tasks\/[^/]+$/, permission: "tasks:update", methods: ["PATCH", "PUT"] },
	{ pattern: /^\/tasks\/[^/]+$/, permission: "tasks:delete", methods: ["DELETE"] },

	// Agents (global)
	{ pattern: "/agents", permission: "agents:read", methods: ["GET"] },
	{ pattern: "/agents", permission: "agents:configure", methods: ["POST"] },
	{ pattern: /^\/agents\/[^/]+$/, permission: "agents:read", methods: ["GET"] },
	{ pattern: /^\/agents\/[^/]+$/, permission: "agents:configure", methods: ["PATCH", "PUT"] },
	{ pattern: /^\/agents\/[^/]+$/, permission: "agents:delete", methods: ["DELETE"] },
	{ pattern: "/agents/presets", permission: "agents:read", methods: ["GET"] },

	// Team templates
	{ pattern: "/team-templates", permission: "team:read", methods: ["GET"] },
	{ pattern: "/custom-teams", permission: "team:read", methods: ["GET"] },
	{ pattern: "/custom-teams", permission: "team:write", methods: ["POST"] },
	{ pattern: /^\/custom-teams\/[^/]+$/, permission: "team:write", methods: ["PATCH", "PUT", "DELETE"] },

	// Providers
	{ pattern: "/providers", permission: "providers:read", methods: ["GET"] },
	{ pattern: "/providers", permission: "providers:operate", methods: ["POST"] },
	{ pattern: /^\/providers\/[^/]+$/, permission: "providers:read", methods: ["GET"] },
	{ pattern: /^\/providers\/[^/]+$/, permission: "providers:operate", methods: ["PATCH", "PUT", "DELETE"] },
	{ pattern: "/providers/test", permission: "providers:operate", methods: ["POST"] },
	{ pattern: "/providers/fallback-chain", permission: "providers:read", methods: ["GET"] },
	{ pattern: "/providers/fallback-chain", permission: "providers:operate", methods: ["PUT"] },
	{ pattern: "/providers/default", permission: "providers:operate", methods: ["POST"] },

	// Templates
	{ pattern: "/templates", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/templates", permission: "projects:create", methods: ["POST"] },
	{ pattern: /^\/templates\/[^/]+$/, permission: "projects:read", methods: ["GET"] },
	{ pattern: /^\/templates\/[^/]+$/, permission: "projects:update", methods: ["PATCH", "PUT"] },
	{ pattern: /^\/templates\/[^/]+$/, permission: "projects:delete", methods: ["DELETE"] },
	{ pattern: "/project-templates", permission: "projects:read", methods: ["GET"] },

	// Plugins
	{ pattern: "/plugins", permission: "plugins:read", methods: ["GET"] },
	{ pattern: "/plugins", permission: "plugins:write", methods: ["POST"] },
	{ pattern: /^\/plugins\/[^/]+$/, permission: "plugins:read", methods: ["GET"] },
	{ pattern: /^\/plugins\/[^/]+$/, permission: "plugins:write", methods: ["PATCH", "PUT", "DELETE"] },

	// Integrations
	{ pattern: "/integrations", permission: "settings:read", methods: ["GET"] },
	{ pattern: "/integrations", permission: "settings:write", methods: ["POST", "PUT", "PATCH", "DELETE"] },

	// CI
	{ pattern: "/ci", permission: "settings:read", methods: ["GET"] },
	{ pattern: "/ci", permission: "settings:write", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/jobs", permission: "settings:read", methods: ["GET"] },
	{ pattern: "/jobs", permission: "settings:write", methods: ["POST", "PUT", "PATCH", "DELETE"] },

	// Analytics & Telemetry
	{ pattern: "/analytics", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/cost", permission: "billing:read", methods: ["GET"] },
	{ pattern: "/notifications", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/notifications", permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/replay", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/replay", permission: "projects:update", methods: ["POST"] },
	{ pattern: "/telemetry", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/telemetry", permission: "projects:update", methods: ["POST", "PUT", "PATCH"] },

	// Runtime
	{ pattern: "/runtime", permission: "pipeline:start", methods: ["GET", "POST"] },
	{ pattern: "/runtime/", permission: "pipeline:start", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] },

	// Sandbox
	{ pattern: "/sandbox", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/sandbox", permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },

	// Graph mutations
	{ pattern: "/graph", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/graph", permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },

	// Memory (archived)
	{ pattern: "/memory", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/memory", permission: "projects:update", methods: ["POST", "PUT", "PATCH", "DELETE"] },

	// CLI usage
	{ pattern: "/cli-usage", permission: "projects:read", methods: ["GET"] },

	// Platform-wide endpoints
	{ pattern: "/platform/stats", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/platform/analytics", permission: "projects:read", methods: ["GET"] },
	{ pattern: "/avatars", permission: "projects:read", methods: ["GET"] },

	// Control Plane
	{ pattern: "/registry", permission: "control-plane:read", methods: ["GET"] },
	{ pattern: "/registry", permission: "control-plane:operate", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/presence", permission: "control-plane:read", methods: ["GET"] },
	{ pattern: "/presence", permission: "control-plane:operate", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/approvals", permission: "control-plane:read", methods: ["GET"] },
	{ pattern: "/approvals", permission: "control-plane:operate", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/audit", permission: "audit:read", methods: ["GET"] },
	{ pattern: "/audit", permission: "control-plane:operate", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/usage-cost", permission: "billing:read", methods: ["GET"] },
	{ pattern: "/incidents", permission: "control-plane:read", methods: ["GET"] },
	{ pattern: "/incidents", permission: "control-plane:operate", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/projections", permission: "control-plane:read", methods: ["GET"] },
	{ pattern: "/projections", permission: "control-plane:operate", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/operator-actions", permission: "control-plane:operate", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/policy", permission: "control-plane:read", methods: ["GET"] },
	{ pattern: "/policy", permission: "control-plane:operate", methods: ["POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/provider-ops", permission: "control-plane:operate", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
	{ pattern: "/queue-health", permission: "control-plane:read", methods: ["GET"] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isPublicRoute(path: string): boolean {
	return PUBLIC_ROUTES.some((r) => (typeof r === "string" ? path === r : r.test(path)));
}

/**
 * Check if a route is explicitly known in the permission matrix.
 * Unknown routes default to deny.
 */
export function isKnownRoute(path: string, method: string): boolean {
	if (isPublicRoute(path)) return true;
	return ROUTE_PERMISSIONS.some((entry) => matchesRoute(entry, path, method));
}

/**
 * Get the required permission for a route + method.
 * Returns undefined if the route is unknown (should deny).
 */
export function getRoutePermission(path: string, method: string): string | null | undefined {
	if (isPublicRoute(path)) return undefined; // public — no permission needed

	for (const entry of ROUTE_PERMISSIONS) {
		if (matchesRoute(entry, path, method)) {
			return entry.permission; // null = auth required but no specific permission
		}
	}
	return undefined; // unknown route → deny
}

function matchesRoute(entry: RoutePermissionEntry, path: string, method: string): boolean {
	if (entry.methods && !entry.methods.includes(method)) return false;
	if (typeof entry.pattern === "string") {
		return path === entry.pattern || path.startsWith(entry.pattern + "/");
	}
	return entry.pattern.test(path);
}
