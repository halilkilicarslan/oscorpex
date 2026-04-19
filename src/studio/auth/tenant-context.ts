// ---------------------------------------------------------------------------
// Oscorpex — Tenant Context Helper
// Extracts tenant/user identity from Hono context (set by auth-middleware).
// Also provides SQL query helpers for tenant-scoped data access.
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import { queryOne } from "../pg.js";

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
	if (!tenantId) return { query: baseQuery, params: [] };

	const hasWhere = /\bWHERE\b/i.test(baseQuery);
	const clause = hasWhere ? ` AND tenant_id = $${paramIndex}` : ` WHERE tenant_id = $${paramIndex}`;

	return { query: baseQuery + clause, params: [tenantId] };
}

// ---------------------------------------------------------------------------
// Project Ownership Verification
// Returns true if tenantId is null (auth disabled), project tenant matches,
// or project has no tenant (legacy project created before M6).
// ---------------------------------------------------------------------------

export async function verifyProjectAccess(projectId: string, tenantId: string | null): Promise<boolean> {
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
