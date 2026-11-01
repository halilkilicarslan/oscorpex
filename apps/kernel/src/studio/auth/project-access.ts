// ---------------------------------------------------------------------------
// Project ownership checks: generic `/projects/:id` guard + assertProjectInTenant for ids outside the path.
// The positive ownership cache lives in tenancy/project-tenant-cache.ts.
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import { queryOne } from "../pg.js";
import { projectBelongsToTenant } from "../tenancy/project-tenant-cache.js";
import { enterRequestTenant, runSysLookupAtBoundary } from "../tenancy/tenant-scope.js";
import { LOCAL_TENANT_ID } from "./auth-middleware.js";

// biome-ignore lint/suspicious/noExplicitAny: routers declare differing Variables; helpers stay env-agnostic
type AnyContext = Context<any>;

/** Owner tenant of a project via the SECURITY DEFINER lookup (uncached, independent of RLS); null when missing. */
export async function lookupProjectTenant(projectId: string): Promise<string | null> {
	const row = await runSysLookupAtBoundary("ws:project-tenant", () =>
		queryOne<{ tenant_id: string | null }>("SELECT sys_project_tenant($1) AS tenant_id", [projectId]),
	);
	return row?.tenant_id ?? null;
}

export { invalidateProjectAccessCache } from "../tenancy/project-tenant-cache.js";

const COLLECTION_SEGMENTS = new Set(["import", "from-template"]);

/** Tenant of the authenticated request; the dev bypass (authType "none") always maps to the local tenant. */
export function resolveRequestTenant(c: AnyContext): string | null | undefined {
	if (c.get("authType") === "none") return LOCAL_TENANT_ID;
	return c.get("tenantId") as string | null | undefined;
}

export function projectNotFoundResponse(c: AnyContext): Response {
	return c.json({ error: "Project not found" }, 404);
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

/**
 * Repository path of a project, resolved server-side inside the caller's tenant. Callers must have passed
 * assertProjectInTenant first; request bodies never supply filesystem paths. Null when there is none.
 */
export async function resolveProjectRepoPath(c: AnyContext, projectId: string): Promise<string | null> {
	const tenantId = resolveRequestTenant(c);
	if (!tenantId) return null;
	const row = await enterRequestTenant(tenantId, () =>
		queryOne<{ repo_path: string | null }>("SELECT repo_path FROM projects WHERE id = $1", [projectId]),
	);
	return row?.repo_path || null;
}
