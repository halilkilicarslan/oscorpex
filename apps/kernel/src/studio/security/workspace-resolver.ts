// ---------------------------------------------------------------------------
// P1-3: Workspace Resolver — Per-tenant, per-project workspace isolation
// Ensures no cross-project or cross-tenant file access.
// ---------------------------------------------------------------------------

import { realpathSync } from "node:fs";
import { normalize, resolve, sep } from "node:path";
import { createLogger } from "../logger.js";

const log = createLogger("workspace-resolver");

/** Default workspace root — override with OSCORPEX_WORKSPACE_ROOT env */
const WORKSPACE_ROOT = process.env.OSCORPEX_WORKSPACE_ROOT || resolve(process.cwd(), ".voltagent", "repos");

/** UUID pattern for tenant/project IDs */
const UUID_OR_SLUG = /^[a-zA-Z0-9_-]{1,80}$/;

export interface WorkspaceScope {
	tenantId: string;
	projectId: string;
	runId?: string;
}

/**
 * Resolve a safe workspace path for a given scope.
 * Returns an absolute path scoped to tenant/project.
 */
export function resolveWorkspacePath(scope: WorkspaceScope, relativePath?: string): string {
	validateScopeIds(scope);

	const basePath = resolve(WORKSPACE_ROOT, scope.tenantId, scope.projectId);

	if (!relativePath) return basePath;

	// Reject obvious traversal attempts
	const normalizedRel = normalize(relativePath);
	if (normalizedRel.startsWith("..") || normalizedRel.includes(`..${sep}`)) {
		throw new WorkspaceViolationError(`Path traversal attempt: ${relativePath}`, scope);
	}

	// Reject absolute paths in relativePath
	if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
		throw new WorkspaceViolationError(`Absolute path in relative parameter: ${relativePath}`, scope);
	}

	const fullPath = resolve(basePath, normalizedRel);

	// Final check: resolved path must be inside base
	if (!fullPath.startsWith(basePath + sep) && fullPath !== basePath) {
		throw new WorkspaceViolationError(`Resolved path escapes workspace: ${fullPath}`, scope);
	}

	return fullPath;
}

/**
 * Assert that an absolute path is inside the workspace for the given scope.
 * Uses realpath to resolve symlinks before checking.
 */
export function assertInsideWorkspace(scope: WorkspaceScope, absolutePath: string): void {
	validateScopeIds(scope);

	const basePath = resolve(WORKSPACE_ROOT, scope.tenantId, scope.projectId);

	let canonical: string;
	try {
		canonical = realpathSync(absolutePath);
	} catch {
		// Path doesn't exist yet — use normalize instead
		canonical = normalize(resolve(absolutePath));
	}

	let canonicalBase: string;
	try {
		canonicalBase = realpathSync(basePath);
	} catch {
		canonicalBase = normalize(resolve(basePath));
	}

	if (canonical !== canonicalBase && !canonical.startsWith(canonicalBase + sep)) {
		throw new WorkspaceViolationError(`Path ${canonical} is outside workspace ${canonicalBase}`, scope);
	}
}

/**
 * Validate that repoPath is safe — not system paths, not other project paths.
 */
export function validateRepoPath(repoPath: string): void {
	// macOS aliases /etc, /var, /tmp to /private/*; the config trees are blocked recursively
	// (temp dirs such as /private/var/folders/... stay usable).
	const dangerous = [
		"/",
		"/etc",
		"/usr",
		"/var",
		"/tmp",
		"/bin",
		"/sbin",
		"/root",
		"/private",
		"/private/etc",
		"/private/var",
		"/private/tmp",
	];
	const dangerousTrees = ["/etc", "/private/etc"];
	const resolved = normalize(resolve(repoPath));

	if (dangerous.includes(resolved) || dangerousTrees.some((t) => resolved.startsWith(t + sep))) {
		throw new WorkspaceViolationError(`Dangerous repoPath: ${repoPath}`, {} as WorkspaceScope);
	}

	const home = process.env.HOME || "/root";
	if (resolved === home) {
		throw new WorkspaceViolationError(`repoPath is HOME directory: ${repoPath}`, {} as WorkspaceScope);
	}
}

/**
 * Resolve a user-supplied import path to its canonical form, requiring it to live under
 * `<WORKSPACE_ROOT>/<tenantId>/`. Symlinks are followed (realpath) and the containment check uses
 * resolve + normalize + sep. Returns null for ANY failure (missing path, outside the tenant root, bad tenant id),
 * so callers can return one uniform error that does not reveal whether a path exists.
 */
export function resolveTenantImportPath(tenantId: string, userPath: unknown): string | null {
	if (typeof userPath !== "string" || userPath.length === 0 || userPath.length > 4096 || userPath.includes("\0")) {
		return null;
	}
	if (!UUID_OR_SLUG.test(tenantId)) return null;
	try {
		const root = realpathSync(resolve(WORKSPACE_ROOT, tenantId));
		const canonical = realpathSync(normalize(resolve(userPath)));
		return canonical.startsWith(root + sep) ? canonical : null;
	} catch {
		return null;
	}
}

/** Get the workspace root directory */
export function getWorkspaceRoot(): string {
	return WORKSPACE_ROOT;
}

function validateScopeIds(scope: WorkspaceScope): void {
	if (!UUID_OR_SLUG.test(scope.tenantId)) {
		throw new WorkspaceViolationError(`Invalid tenantId: ${scope.tenantId}`, scope);
	}
	if (!UUID_OR_SLUG.test(scope.projectId)) {
		throw new WorkspaceViolationError(`Invalid projectId: ${scope.projectId}`, scope);
	}
	if (scope.runId && !UUID_OR_SLUG.test(scope.runId)) {
		throw new WorkspaceViolationError(`Invalid runId: ${scope.runId}`, scope);
	}
}

export class WorkspaceViolationError extends Error {
	public readonly scope: WorkspaceScope;
	constructor(message: string, scope: WorkspaceScope) {
		super(message);
		this.name = "WorkspaceViolationError";
		this.scope = scope;
		log.warn({ scope, message }, "[workspace] Violation detected");
	}
}
