// ---------------------------------------------------------------------------
// Positive project -> tenant ownership cache shared by the HTTP project guard, the event bus and the notification
// bridge. Only positive lookups are cached (a project's tenant never changes); deleting a project evicts it.
// ---------------------------------------------------------------------------

import { getProjectTenantId } from "../db.js";

const CACHE_MAX = 5000;
const CACHE_TTL_MS = 5 * 60_000;

const owners = new Map<string, { tenantId: string; expires: number }>();

export function invalidateProjectAccessCache(projectId: string): void {
	owners.delete(projectId);
}

/** Owner of a project; `load` runs only on a cache miss and a null owner is never cached. */
export async function projectTenantOf(projectId: string, load: () => Promise<string | null>): Promise<string | null> {
	const hit = owners.get(projectId);
	if (hit) {
		owners.delete(projectId);
		if (hit.expires > Date.now()) {
			owners.set(projectId, hit);
			return hit.tenantId;
		}
	}
	const tenantId = await load();
	if (tenantId === null) return null;
	owners.set(projectId, { tenantId, expires: Date.now() + CACHE_TTL_MS });
	if (owners.size > CACHE_MAX) {
		const oldest = owners.keys().next().value;
		if (oldest !== undefined) owners.delete(oldest);
	}
	return tenantId;
}

export async function projectBelongsToTenant(projectId: string, tenantId: string): Promise<boolean> {
	return (await projectTenantOf(projectId, () => getProjectTenantId(projectId))) === tenantId;
}
