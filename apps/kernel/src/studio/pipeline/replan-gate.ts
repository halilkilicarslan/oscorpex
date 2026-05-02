// ---------------------------------------------------------------------------
// Replan Gate
// Guard function that blocks pipeline stage advancement while a replan event
// is pending approval. Wraps the DB query from PipelineStateManager.
// ---------------------------------------------------------------------------

import { queryOne } from "../db.js";

/**
 * Returns true if the pipeline may advance to the next stage.
 * Returns false (and the blocking replan event id) when a pending replan
 * event exists for the project — stage advancement must wait until the
 * replan is approved or rejected.
 */
export async function canAdvance(projectId: string): Promise<{ allowed: boolean; replanEventId?: string }> {
	const row = await queryOne<{ id: string }>(
		`SELECT id FROM replan_events WHERE project_id = $1 AND status = 'pending' LIMIT 1`,
		[projectId],
	);
	if (row) {
		return { allowed: false, replanEventId: row.id };
	}
	return { allowed: true };
}
