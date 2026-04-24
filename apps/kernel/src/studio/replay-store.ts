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
			`INSERT INTO replay_snapshots (id, run_id, checkpoint_id, snapshot_json, context_hash, metadata, policy_decisions_json, verification_reports_json, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (id) DO UPDATE SET
			   snapshot_json           = EXCLUDED.snapshot_json,
			   context_hash            = EXCLUDED.context_hash,
			   metadata                = EXCLUDED.metadata,
			   policy_decisions_json   = EXCLUDED.policy_decisions_json,
			   verification_reports_json = EXCLUDED.verification_reports_json,
			   created_at              = EXCLUDED.created_at`,
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
				JSON.stringify(snapshot.policyDecisions ?? []),
				JSON.stringify(snapshot.verificationReports ?? []),
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
			policy_decisions_json: string | null;
			verification_reports_json: string | null;
			created_at: string;
		}>(
			`SELECT id, run_id, checkpoint_id, snapshot_json, policy_decisions_json, verification_reports_json, created_at
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
			policyDecisions: row.policy_decisions_json ? JSON.parse(row.policy_decisions_json) : (parsed.policyDecisions ?? []),
			verificationReports: row.verification_reports_json ? JSON.parse(row.verification_reports_json) : (parsed.verificationReports ?? []),
		} as ReplaySnapshot;
	}

	async listSnapshots(runId: string, limit = 50): Promise<ReplaySnapshot[]> {
		const rows = await query<{
			id: string;
			run_id: string;
			checkpoint_id: string;
			snapshot_json: string;
			policy_decisions_json: string | null;
			verification_reports_json: string | null;
			created_at: string;
		}>(
			`SELECT id, run_id, checkpoint_id, snapshot_json, policy_decisions_json, verification_reports_json, created_at
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
				policyDecisions: row.policy_decisions_json ? JSON.parse(row.policy_decisions_json) : (parsed.policyDecisions ?? []),
				verificationReports: row.verification_reports_json ? JSON.parse(row.verification_reports_json) : (parsed.verificationReports ?? []),
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
	const { getPipelineRun, listProjectTasks, getProject, getProjectCostSummary, query } = await import("./db.js");
	const pipeline = await getPipelineRun(projectId);
	const tasks = await listProjectTasks(projectId);
	const project = await getProject(projectId);

	// --- Fetch canonical Run record ---
	let runRecord: import("@oscorpex/core").Run | undefined;
	try {
		const { listRuns } = await import("./db/run-repo.js");
		const runs = await listRuns({ projectId, limit: 1 });
		runRecord = runs[0];
	} catch {
		// runs table may not be populated in all environments
	}

	// Fallback: build a Run-compatible object from pipeline + project
	const runSummary: any = runRecord ?? {
		id: projectId,
		projectId,
		goal: project?.description ?? "",
		mode: "execute",
		status: (pipeline?.status as any) ?? "idle",
		currentStageId: pipeline?.currentStage ?? undefined,
		startedAt: pipeline?.startedAt ?? undefined,
		completedAt: pipeline?.completedAt ?? undefined,
		metadata: {
			taskCount: tasks.length,
			completedTaskCount: tasks.filter((t: any) => t.status === "done").length,
			failedTaskCount: tasks.filter((t: any) => t.status === "failed").length,
		},
	};
	try {
		if (!runRecord) {
			const cost = await getProjectCostSummary(projectId);
			runSummary.metadata ??= {};
			runSummary.metadata.totalCostUsd = cost.totalCostUsd ?? 0;
		}
	} catch {
		// cost not available — skip
	}

	// --- Collect artifacts from task outputs ---
	const artifacts: any[] = [];
	for (const task of tasks) {
		if (task.output) {
			if (task.output.filesCreated?.length) {
				artifacts.push({
					taskId: task.id,
					taskTitle: task.title,
					filesCreated: task.output.filesCreated,
					filesModified: task.output.filesModified ?? [],
					testResults: task.output.testResults ?? null,
				});
			}
		}
	}

	// --- Fetch verification reports from DB ---
	let verificationReports: any[] = [];
	try {
		const rows = await query<any>(
			`SELECT id, task_id, verification_type, status, details, created_at
			 FROM verification_results
			 WHERE task_id = ANY($1)
			 ORDER BY created_at DESC`,
			[tasks.map((t: any) => t.id)],
		);
		verificationReports = rows.map((r: any) => ({
			id: r.id,
			taskId: r.task_id,
			type: r.verification_type,
			status: r.status,
			details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
			createdAt: r.created_at,
		}));
	} catch {
		// table may not exist in all environments
	}

	// --- Fetch policy decisions from persisted task snapshots (historical truth) ---
	const policyDecisions: any[] = [];
	for (const task of tasks) {
		if (task.policySnapshot && task.policySnapshot !== "{}") {
			try {
				const snapshot = JSON.parse(task.policySnapshot);
				policyDecisions.push({
					taskId: task.id,
					taskTitle: task.title,
					allowed: snapshot.allowed,
					violations: snapshot.violations ?? [],
					evaluatedAt: snapshot.evaluatedAt,
				});
			} catch {
				// skip malformed snapshot
			}
		}
	}

	const canonicalRunId = runRecord?.id ?? projectId;

	const snapshot: ReplaySnapshot = {
		id: generateId(),
		runId: canonicalRunId,
		checkpoint: checkpointName,
		createdAt: new Date().toISOString(),
		run: runSummary,
		stages: pipeline ? JSON.parse(pipeline.stagesJson) : [],
		tasks: tasks as any,
		artifacts,
		policyDecisions,
		verificationReports,
	};

	await replayStore.saveSnapshot(snapshot);
	await replayStore.pruneSnapshots(projectId, 100);
	return snapshot;
}

/**
 * ReplayRestoreResult — what changed during a restore operation.
 */
export interface ReplayRestoreResult {
	tasksRestored: number;
	pipelineRestored: boolean;
	errors: string[];
}

/**
 * Restore run state from a previously saved snapshot.
 * Updates task statuses and pipeline stages to match the snapshot.
 * This is a read-only diagnostic restore by default; set `dryRun: false`
 * to actually mutate the DB.
 */
export async function restoreFromSnapshot(
	snapshot: ReplaySnapshot,
	options: { dryRun?: boolean } = {},
): Promise<ReplayRestoreResult> {
	const { dryRun = true } = options;
	const { updateTask, createPipelineRun } = await import("./db.js");
	const result: ReplayRestoreResult = { tasksRestored: 0, pipelineRestored: false, errors: [] };

	// Restore task statuses from snapshot
	for (const task of snapshot.tasks as any[]) {
		try {
			if (!dryRun) {
			await updateTask(task.id, {
				status: task.status,
				output: task.output ?? undefined,
				error: task.error ?? undefined,
			});
			}
			result.tasksRestored++;
		} catch (err) {
			result.errors.push(`task ${task.id}: ${String(err)}`);
		}
	}

	// Restore pipeline stages if present
	if (snapshot.stages && snapshot.stages.length > 0) {
		try {
			if (!dryRun) {
				await createPipelineRun({
					projectId: snapshot.runId,
					status: (snapshot.run as any)?.status ?? "running",
					stagesJson: JSON.stringify(snapshot.stages),
				});
			}
			result.pipelineRestored = true;
		} catch (err) {
			result.errors.push(`pipeline: ${String(err)}`);
		}
	}

	return result;
}