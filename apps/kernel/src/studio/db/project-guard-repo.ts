import { queryOne } from "../pg.js";

/** Owner tenant of a project via the SECURITY DEFINER lookup (independent of RLS); null when missing. */
export async function getProjectTenantId(projectId: string): Promise<string | null> {
	const row = await queryOne<{ t: string | null }>("SELECT sys_project_tenant($1) AS t", [projectId]);
	return row?.t ?? null;
}
