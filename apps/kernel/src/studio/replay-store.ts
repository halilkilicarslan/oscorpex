// @oscorpex/kernel — ReplayStore implementation
// Persists checkpoint-level replay snapshots to PostgreSQL.
// Implements the ReplayStore contract from @oscorpex/core.

import type { ReplaySnapshot, ReplayStore } from "@oscorpex/core";
import { createHash } from "node:crypto";
import { execute, queryOne, query } from "./pg.js";

class DbReplayStore implements ReplayStore {
	private hashSnapshot(snapshot: ReplaySnapshot): string {
		const payload = JSON.stringify({
			run: snapshot.run,
			stages: snapshot.stages,
			tasks: snapshot.tasks,
			artifacts: snapshot.artifacts,
			policyDecisions: snapshot.policyDecisions,
			verificationReports: snapshot.verificationReports,
		});
		return createHash("sha256").update(payload).digest("hex");
	}

	async saveSnapshot(snapshot: ReplaySnapshot): Promise<void> {
		const metadata = (snapshot as any).metadata ?? {};
		const contextHash = this.hashSnapshot(snapshot);
		await execute(
			`INSERT INTO replay_snapshots (id, run_id, checkpoint_id, snapshot_json, context_hash, metadata, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (id) DO UPDATE SET
			   snapshot_json = EXCLUDED.snapshot_json,
			   context_hash  = EXCLUDED.context_hash,
			   metadata      = EXCLUDED.metadata,
			   created_at    = EXCLUDED.created_at`,
			[
				snapshot.id,
				snapshot.runId,
				snapshot.checkpoint,
				JSON.stringify({
					run: snapshot.run,
					stages: snapshot.stages,
					tasks: snapshot.tasks,
					artifacts: snapshot.artifacts,
					policyDecisions: snapshot.policyDecisions,
					verificationReports: snapshot.verificationReports,
				}),
				contextHash,
				JSON.stringify(metadata),
				snapshot.createdAt,
			],
		);
	}

	async getSnapshot(runId: string, checkpointId?: string): Promise<ReplaySnapshot | null> {
		const row = await queryOne<{
			id: string;
			run_id: string;
			checkpoint_id: string;
			snapshot_json: string;
			created_at: string;
		}>(
			`SELECT id, run_id, checkpoint_id, snapshot_json, created_at
			 FROM replay_snapshots
			 WHERE run_id = $1 ${checkpointId ? "AND checkpoint_id = $2" : ""}
			 ORDER BY created_at DESC
			 LIMIT 1`,
			checkpointId ? [runId, checkpointId] : [runId],
		);

		if (!row) return null;

		const parsed = JSON.parse(row.snapshot_json);
		return {
			id: row.id,
			runId: row.run_id,
			checkpoint: row.checkpoint_id,
			createdAt: row.created_at,
			run: parsed.run ?? {},
			stages: parsed.stages ?? [],
			tasks: parsed.tasks ?? [],
			artifacts: parsed.artifacts ?? [],
			policyDecisions: parsed.policyDecisions ?? [],
			verificationReports: parsed.verificationReports ?? [],
		} as ReplaySnapshot;
	}

	async listSnapshots(runId: string, limit = 50): Promise<ReplaySnapshot[]> {
		const rows = await query<{
			id: string;
			run_id: string;
			checkpoint_id: string;
			snapshot_json: string;
			created_at: string;
		}>(
			`SELECT id, run_id, checkpoint_id, snapshot_json, created_at
			 FROM replay_snapshots
			 WHERE run_id = $1
			 ORDER BY created_at DESC
			 LIMIT $2`,
			[runId, limit],
		);

		return rows.map((row) => {
			const parsed = JSON.parse(row.snapshot_json);
			return {
				id: row.id,
				runId: row.run_id,
				checkpoint: row.checkpoint_id,
				createdAt: row.created_at,
				run: parsed.run ?? {},
				stages: parsed.stages ?? [],
				tasks: parsed.tasks ?? [],
				artifacts: parsed.artifacts ?? [],
				policyDecisions: parsed.policyDecisions ?? [],
				verificationReports: parsed.verificationReports ?? [],
			} as ReplaySnapshot;
		});
	}

	async pruneSnapshots(runId: string, maxDepth: number): Promise<number> {
		const result = await execute(
			`DELETE FROM replay_snapshots
			 WHERE id IN (
			   SELECT id FROM replay_snapshots
			   WHERE run_id = $1
			   ORDER BY created_at DESC
			   OFFSET $2
			 )`,
			[runId, maxDepth],
		);
		return result.rowCount ?? 0;
	}
}

export const replayStore = new DbReplayStore();

/**
 * Convenience: create a checkpoint snapshot for a project.
 * Captures current pipeline state, tasks, and events.
 */
export async function createCheckpointSnapshot(
	projectId: string,
	checkpointName: string,
	generateId: () => string,
): Promise<ReplaySnapshot> {
	const { getPipelineRun } = await import("./db.js");
	const { listProjectTasks } = await import("./db.js");
	const pipeline = await getPipelineRun(projectId);
	const tasks = await listProjectTasks(projectId);

	const snapshot: ReplaySnapshot = {
		id: generateId(),
		runId: projectId,
		checkpoint: checkpointName,
		createdAt: new Date().toISOString(),
		run: {} as any,
		stages: [],
		tasks: tasks as any,
		artifacts: [],
		policyDecisions: [],
		verificationReports: [],
	};

	if (pipeline) {
		snapshot.stages = JSON.parse(pipeline.stagesJson) as any;
	}

	await replayStore.saveSnapshot(snapshot);
	await replayStore.pruneSnapshots(projectId, 100);
	return snapshot;
}