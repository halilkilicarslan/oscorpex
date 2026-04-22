// ---------------------------------------------------------------------------
// Oscorpex — Episode Repository: Agent episodic memory CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { AgentEpisode, AgentStrategyPattern, EpisodeOutcome } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("episode-repo");

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToEpisode(row: any): AgentEpisode {
	return {
		id: row.id,
		projectId: row.project_id,
		agentId: row.agent_id,
		taskId: row.task_id ?? undefined,
		taskType: row.task_type,
		strategy: row.strategy,
		actionSummary: row.action_summary,
		outcome: row.outcome as EpisodeOutcome,
		failureReason: row.failure_reason ?? undefined,
		qualityScore: row.quality_score != null ? Number(row.quality_score) : undefined,
		costUsd: row.cost_usd != null ? Number(row.cost_usd) : undefined,
		durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
		createdAt: row.created_at?.toISOString?.() ?? row.created_at,
	};
}

function rowToPattern(row: any): AgentStrategyPattern {
	return {
		id: row.id,
		projectId: row.project_id,
		agentRole: row.agent_role,
		taskType: row.task_type,
		strategy: row.strategy,
		successRate: Number(row.success_rate),
		avgCostUsd: row.avg_cost_usd != null ? Number(row.avg_cost_usd) : undefined,
		avgQuality: row.avg_quality != null ? Number(row.avg_quality) : undefined,
		sampleCount: Number(row.sample_count),
		updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
	};
}

// ---------------------------------------------------------------------------
// Episodes CRUD
// ---------------------------------------------------------------------------

export async function recordEpisode(data: Omit<AgentEpisode, "id" | "createdAt">): Promise<AgentEpisode> {
	const id = randomUUID();
	await execute(
		`INSERT INTO agent_episodes (id, project_id, agent_id, task_id, task_type, strategy, action_summary, outcome, failure_reason, quality_score, cost_usd, duration_ms)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[
			id,
			data.projectId,
			data.agentId,
			data.taskId ?? null,
			data.taskType,
			data.strategy,
			data.actionSummary,
			data.outcome,
			data.failureReason ?? null,
			data.qualityScore ?? null,
			data.costUsd ?? null,
			data.durationMs ?? null,
		],
	);
	return { ...data, id, createdAt: new Date().toISOString() };
}

/** Get recent episodes for a specific agent and task type (for behavioral prompting) */
export async function getRecentEpisodes(
	projectId: string,
	agentId: string,
	taskType: string,
	limit = 10,
): Promise<AgentEpisode[]> {
	const rows = await query<any>(
		`SELECT * FROM agent_episodes
		 WHERE project_id = $1 AND agent_id = $2 AND task_type = $3
		 ORDER BY created_at DESC LIMIT $4`,
		[projectId, agentId, taskType, limit],
	);
	return rows.map(rowToEpisode);
}

/** Get failure episodes to build avoidance context */
export async function getFailureEpisodes(
	projectId: string,
	agentId: string,
	limit = 5,
): Promise<AgentEpisode[]> {
	const rows = await query<any>(
		`SELECT * FROM agent_episodes
		 WHERE project_id = $1 AND agent_id = $2 AND outcome = 'failure'
		 ORDER BY created_at DESC LIMIT $3`,
		[projectId, agentId, limit],
	);
	return rows.map(rowToEpisode);
}

// ---------------------------------------------------------------------------
// Strategy Patterns
// ---------------------------------------------------------------------------

/** Upsert strategy pattern from episode data (called after episode is recorded) */
export async function updateStrategyPattern(
	projectId: string,
	agentRole: string,
	taskType: string,
	strategy: string,
): Promise<AgentStrategyPattern> {
	const stats = await queryOne<any>(
		`SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE outcome = 'success') AS successes,
			AVG(cost_usd) FILTER (WHERE cost_usd IS NOT NULL) AS avg_cost,
			AVG(quality_score) FILTER (WHERE quality_score IS NOT NULL) AS avg_quality
		 FROM agent_episodes
		 WHERE project_id = $1 AND task_type = $2 AND strategy = $3`,
		[projectId, taskType, strategy],
	);

	const total = Number(stats?.total ?? 0);
	const successes = Number(stats?.successes ?? 0);
	const successRate = total > 0 ? successes / total : 0;
	const id = randomUUID();

	const row = await queryOne<any>(
		`INSERT INTO agent_strategy_patterns (id, project_id, agent_role, task_type, strategy, success_rate, avg_cost_usd, avg_quality, sample_count, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
		 ON CONFLICT (project_id, agent_role, task_type, strategy) DO UPDATE SET
			success_rate = EXCLUDED.success_rate,
			avg_cost_usd = EXCLUDED.avg_cost_usd,
			avg_quality = EXCLUDED.avg_quality,
			sample_count = EXCLUDED.sample_count,
			updated_at = now()
		 RETURNING *`,
		[
			id,
			projectId,
			agentRole,
			taskType,
			strategy,
			successRate,
			stats?.avg_cost ?? null,
			stats?.avg_quality ?? null,
			total,
		],
	);
	return rowToPattern(row);
}

/** Get best strategies for a task type, ranked by success rate */
export async function getBestStrategies(
	projectId: string,
	agentRole: string,
	taskType: string,
	limit = 5,
): Promise<AgentStrategyPattern[]> {
	const rows = await query<any>(
		`SELECT * FROM agent_strategy_patterns
		 WHERE project_id = $1 AND agent_role = $2 AND task_type = $3 AND sample_count >= 2
		 ORDER BY success_rate DESC, avg_quality DESC NULLS LAST
		 LIMIT $4`,
		[projectId, agentRole, taskType, limit],
	);
	return rows.map(rowToPattern);
}
