// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Repository: Pipeline Runs + Agent Runs
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { AgentRun, PipelineRun } from "../types.js";
import { now, rowToAgentRun, rowToPipelineRun } from "./helpers.js";

// ---------------------------------------------------------------------------
// Pipeline Runs CRUD
// ---------------------------------------------------------------------------

/** Projeye yeni bir pipeline run kaydı oluşturur (ya da mevcut olanı günceller — UPSERT) */
export async function createPipelineRun(
	data: Pick<PipelineRun, "projectId" | "status" | "stagesJson">,
): Promise<PipelineRun> {
	const id = randomUUID();
	const ts = now();

	// Projeye ait tek bir pipeline_run kaydı olur; varsa güncelle
	await execute(
		`
    INSERT INTO pipeline_runs (id, project_id, current_stage, status, stages_json, started_at, completed_at, created_at)
    VALUES ($1, $2, 0, $3, $4, NULL, NULL, $5)
    ON CONFLICT(project_id) DO UPDATE SET
      current_stage = 0,
      status = EXCLUDED.status,
      stages_json = EXCLUDED.stages_json,
      started_at = NULL,
      completed_at = NULL
  `,
		[id, data.projectId, data.status, data.stagesJson, ts],
	);

	return (await getPipelineRun(data.projectId))!;
}

/** Projenin mevcut pipeline run kaydını getirir */
export async function getPipelineRun(projectId: string): Promise<PipelineRun | undefined> {
	const row = await queryOne<any>("SELECT * FROM pipeline_runs WHERE project_id = $1", [projectId]);
	return row ? rowToPipelineRun(row) : undefined;
}

/** Pipeline run kaydını günceller */
export async function updatePipelineRun(
	projectId: string,
	data: Partial<Pick<PipelineRun, "currentStage" | "status" | "stagesJson" | "startedAt" | "completedAt">>,
): Promise<PipelineRun | undefined> {
	const fields: string[] = [];
	const values: any[] = [];
	let idx = 1;

	if (data.currentStage !== undefined) {
		fields.push(`current_stage = $${idx++}`);
		values.push(data.currentStage);
	}
	if (data.status !== undefined) {
		fields.push(`status = $${idx++}`);
		values.push(data.status);
	}
	if (data.stagesJson !== undefined) {
		fields.push(`stages_json = $${idx++}`);
		values.push(data.stagesJson);
	}
	if (data.startedAt !== undefined) {
		fields.push(`started_at = $${idx++}`);
		values.push(data.startedAt);
	}
	if (data.completedAt !== undefined) {
		fields.push(`completed_at = $${idx++}`);
		values.push(data.completedAt);
	}

	if (fields.length === 0) return getPipelineRun(projectId);

	values.push(projectId);
	await execute(`UPDATE pipeline_runs SET ${fields.join(", ")} WHERE project_id = $${idx}`, values);
	return getPipelineRun(projectId);
}

// ---------------------------------------------------------------------------
// Agent Runs CRUD
// ---------------------------------------------------------------------------

/** Yeni bir agent çalışma kaydı oluşturur */
export async function createAgentRun(
	data: Pick<AgentRun, "id" | "projectId" | "agentId" | "cliTool" | "status"> &
		Partial<Pick<AgentRun, "taskPrompt" | "pid" | "startedAt">>,
): Promise<AgentRun> {
	const ts = now();
	await execute(
		`
    INSERT INTO agent_runs
      (id, project_id, agent_id, cli_tool, status, task_prompt, pid, started_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `,
		[
			data.id,
			data.projectId,
			data.agentId,
			data.cliTool,
			data.status,
			data.taskPrompt ?? null,
			data.pid ?? null,
			data.startedAt ?? null,
			ts,
		],
	);
	return (await getAgentRun(data.id))!;
}

/** Tek bir agent çalışma kaydını getirir */
export async function getAgentRun(id: string): Promise<AgentRun | undefined> {
	const row = await queryOne<any>("SELECT * FROM agent_runs WHERE id = $1", [id]);
	return row ? rowToAgentRun(row) : undefined;
}

/** Agent çalışma kaydını günceller */
export async function updateAgentRun(
	id: string,
	data: Partial<Pick<AgentRun, "status" | "outputSummary" | "exitCode" | "stoppedAt">>,
): Promise<AgentRun | undefined> {
	const fields: string[] = [];
	const values: any[] = [];
	let idx = 1;

	if (data.status !== undefined) {
		fields.push(`status = $${idx++}`);
		values.push(data.status);
	}
	if (data.outputSummary !== undefined) {
		fields.push(`output_summary = $${idx++}`);
		values.push(data.outputSummary);
	}
	if (data.exitCode !== undefined) {
		fields.push(`exit_code = $${idx++}`);
		values.push(data.exitCode);
	}
	if (data.stoppedAt !== undefined) {
		fields.push(`stopped_at = $${idx++}`);
		values.push(data.stoppedAt);
	}

	if (fields.length === 0) return getAgentRun(id);

	values.push(id);
	await execute(`UPDATE agent_runs SET ${fields.join(", ")} WHERE id = $${idx}`, values);
	return getAgentRun(id);
}

/** Belirli bir agent'ın tüm çalışma geçmişini listeler (en yeniden eskiye) */
export async function listAgentRuns(projectId: string, agentId: string, limit = 50): Promise<AgentRun[]> {
	const rows = await query<any>(
		`
    SELECT * FROM agent_runs
    WHERE project_id = $1 AND agent_id = $2
    ORDER BY created_at DESC
    LIMIT $3
  `,
		[projectId, agentId, limit],
	);
	return rows.map(rowToAgentRun);
}
