// ---------------------------------------------------------------------------
// Project ownership checks: generic `/projects/:id` guard + assertProjectInTenant for ids outside the path.
// Only positive lookups are cached (a project's tenant never changes); deleting a project evicts it.
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import { getProjectTenantId } from "../db.js";
import { runSysLookupAtBoundary } from "../tenancy/tenant-scope.js";
import { LOCAL_TENANT_ID } from "./auth-middleware.js";

// biome-ignore lint/suspicious/noExplicitAny: routers declare differing Variables; helpers stay env-agnostic
type AnyContext = Context<any>;

const CACHE_MAX = 5000;
const CACHE_TTL_MS = 5 * 60_000;
const COLLECTION_SEGMENTS = new Set(["import", "from-template"]);

const cache = new Map<string, number>();

const cacheKey = (tenantId: string, projectId: string) => `${tenantId}\u0000${projectId}`;

export function invalidateProjectAccessCache(projectId: string): void {
	for (const key of cache.keys()) {
		if (key.endsWith(`\u0000${projectId}`)) cache.delete(key);
	}
}

/** Tenant of the authenticated request; the dev bypass (authType "none") always maps to the local tenant. */
export function resolveRequestTenant(c: AnyContext): string | null | undefined {
	if (c.get("authType") === "none") return LOCAL_TENANT_ID;
	return c.get("tenantId") as string | null | undefined;
}

export function projectNotFoundResponse(c: AnyContext): Response {
	return c.json({ error: "Project not found" }, 404);
}

async function projectBelongsToTenant(projectId: string, tenantId: string): Promise<boolean> {
	const key = cacheKey(tenantId, projectId);
	const expires = cache.get(key);
	if (expires !== undefined) {
		cache.delete(key);
		if (expires > Date.now()) {
			cache.set(key, expires);
			return true;
		}
	}
	const owner = await getProjectTenantId(projectId);
	if (owner === null || owner !== tenantId) return false;
	cache.set(key, Date.now() + CACHE_TTL_MS);
	if (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return true;
}

/**
 * Project id addressed by a `/projects/:id[/...]` path, or undefined when the path is not project-scoped.
 * Segments are percent-decoded and empty segments dropped so encoded / doubled-slash variants resolve like
 * the plain form; a `..` or separator inside a segment yields an id that never matches a project.
 */
export function guardedProjectId(path: string): string | undefined | null {
	const segments = path.split("/").filter((s) => s.length > 0);
	if (segments[0] !== "projects" || segments.length < 2) return undefined;
	let id: string;
	try {
		id = decodeURIComponent(segments[1]);
	} catch {
		return null;
	}
	if (COLLECTION_SEGMENTS.has(id) && segments.length === 2) return undefined;
	if (segments.some((s) => s === ".." || s === "." || /^(%2e)+$/i.test(s))) return null;
	return id;
}

/** Generic guard: null when the request may proceed, otherwise the uniform 404 response. */
export async function checkProjectPathAccess(c: AnyContext, path: string, tenantId: string): Promise<Response | null> {
	const id = guardedProjectId(path);
	if (id === undefined) return null;
	if (id === null || id.length === 0 || id.includes("/") || id.includes("\\")) return projectNotFoundResponse(c);
	const ok = await runSysLookupAtBoundary("project-guard:tenant-lookup", () => projectBelongsToTenant(id, tenantId));
	return ok ? null : projectNotFoundResponse(c);
}

/** For project ids read outside the path (query, header, body, other path params): the uniform 404 or undefined. */
export async function assertProjectInTenant(
	c: AnyContext,
	projectId: string | null | undefined,
): Promise<Response | undefined> {
	const tenantId = resolveRequestTenant(c);
	if (!projectId || !tenantId) return projectNotFoundResponse(c);
	const ok = await runSysLookupAtBoundary("project-guard:tenant-lookup", () =>
		projectBelongsToTenant(projectId, tenantId),
	);
	return ok ? undefined : projectNotFoundResponse(c);
}
