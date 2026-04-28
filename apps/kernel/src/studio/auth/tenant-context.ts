// ---------------------------------------------------------------------------
// Tenant Context Helper
// Extracts tenant/user identity from Hono context (set by auth-middleware).
// Also provides SQL query helpers for tenant-scoped data access.
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import { queryOne } from "../pg.js";
import type { EventType } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("tenant-context");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantContext {
	tenantId: string | null;
	userId: string | null;
	userRole: string | null;
	authType: string; // "api-key" | "jwt" | "api-key-db" | "none"
}

// ---------------------------------------------------------------------------
// Tenant Isolation Switch
// ---------------------------------------------------------------------------

export function isTenantIsolationEnabled(): boolean {
	return process.env.OSCORPEX_AUTH_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// Context Extraction
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: Hono Context is generic
export function getTenantContext(c: Context<any>): TenantContext {
	return {
		tenantId: c.get("tenantId") ?? null,
		userId: c.get("userId") ?? null,
		userRole: c.get("userRole") ?? null,
		authType: c.get("authType") ?? "none",
	};
}

/**
 * Require a valid tenant context when tenant isolation is enabled.
 * Returns a 403 response when auth is enabled but tenant is missing.
 * This prevents cross-tenant access when running in multi-tenant mode.
 */
export function requireTenantContext(c: Context<any>): Response | null {
	if (!isTenantIsolationEnabled()) return null;
	const tenantId = c.get("tenantId") ?? null;
	if (!tenantId) {
		log.warn("[tenant-context] Tenant isolation enabled but no tenantId in context — rejecting request");
		return c.json({ error: "Forbidden — tenant context required" }, 403);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Tenant-scoped Query Helper
// Appends "WHERE tenant_id = $N" or "AND tenant_id = $N" to base query.
// Returns empty params when tenantId is null (backward compat — no filter).
// ---------------------------------------------------------------------------

export function withTenantFilter(
	baseQuery: string,
	tenantId: string | null,
	paramIndex: number,
): { query: string; params: unknown[] } {
	// Strict mode: when tenant isolation is enabled, missing tenant is an error
	if (isTenantIsolationEnabled() && !tenantId) {
		throw new Error("Tenant isolation enabled but tenantId is null — query aborted");
	}
	if (!tenantId) return { query: baseQuery, params: [] };

	const hasWhere = /\bWHERE\b/i.test(baseQuery);
	const clause = hasWhere ? ` AND tenant_id = $${paramIndex}` : ` WHERE tenant_id = $${paramIndex}`;

	return { query: baseQuery + clause, params: [tenantId] };
}

// ---------------------------------------------------------------------------
// Tenant Activity Audit Log
// ---------------------------------------------------------------------------

/**
 * Log a tenant-scoped activity to the events table.
 * Uses the events table as the audit sink — type: "tenant:activity".
 * Non-blocking: errors are silently swallowed so callers are never interrupted.
 *
 * @param tenantId  The tenant performing the action (used as projectId in event)
 * @param userId    The user performing the action
 * @param action    Human-readable action label (e.g. "register", "role_change")
 * @param details   Optional structured metadata for the event
 */
export async function logTenantActivity(
	tenantId: string,
	userId: string,
	action: string,
	details?: Record<string, unknown>,
): Promise<void> {
	// Dynamic import avoids circular dependency: auth/* → db.js → event-repo → ...
	const { insertEvent } = await import("../db.js");
	await insertEvent({
		projectId: tenantId,
		type: "tenant:activity" as EventType,
		agentId: userId,
		payload: { action, userId, ...details },
	}).catch(() => {
		// Non-blocking — audit log failures must never break the primary operation
	});
}

// ---------------------------------------------------------------------------
// Project Ownership Verification
// Returns true if tenantId is null (auth disabled), project tenant matches,
// or project has no tenant (legacy project created before M6).
// ---------------------------------------------------------------------------

export async function verifyProjectAccess(projectId: string, tenantId: string | null): Promise<boolean> {
	// Strict mode: when tenant isolation is enabled, missing tenant = denied
	if (isTenantIsolationEnabled() && !tenantId) {
		log.warn("[tenant-context] verifyProjectAccess denied: tenant isolation enabled but no tenantId provided");
		return false;
	}

	// Auth disabled — allow everything (backward compat)
	if (!tenantId) return true;

	const project = await queryOne<{ tenant_id: string | null }>("SELECT tenant_id FROM projects WHERE id = $1", [
		projectId,
	]);

	// Project not found
	if (!project) return false;

	// Legacy project (no tenant assigned) — allow access
	if (project.tenant_id === null || project.tenant_id === undefined) return true;

	// Tenant must match
	return project.tenant_id === tenantId;
}
