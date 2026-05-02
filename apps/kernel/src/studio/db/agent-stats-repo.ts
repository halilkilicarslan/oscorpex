// ---------------------------------------------------------------------------
// Oscorpex — Agent Daily Stats Repo (v4.1)
// Aggregated per-agent per-day metrics for heat map + timeline.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne } from "../pg.js";
import { now } from "./helpers.js";
const log = createLogger("agent-stats-repo");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDailyStat {
	id: string;
	projectId: string;
	agentId: string;
	statDate: string;
	tasksCompleted: number;
	tasksFailed: number;
	tokensUsed: number;
	costUsd: number;
	avgTaskTimeMs: number;
	createdAt: string;
}

export interface AgentHeatMapCell {
	agentId: string;
	agentName: string;
	date: string;
	value: number;
}

export interface AgentPerformancePoint {
	date: string;
	tasksCompleted: number;
	tasksFailed: number;
	tokensUsed: number;
	costUsd: number;
	avgTaskTimeMs: number;
}

export interface AgentComparison {
	agentId: string;
	agentName: string;
	role: string;
	avatar: string;
	score: number;
	tasksCompleted: number;
	avgTaskTimeMs: number;
	firstPassRate: number;
	costPerTask: number;
}

// ---------------------------------------------------------------------------
// Upsert Daily Stats
// ---------------------------------------------------------------------------

export async function upsertAgentDailyStat(
	projectId: string,
	agentId: string,
	statDate: string,
	delta: {
		tasksCompleted?: number;
		tasksFailed?: number;
		tokensUsed?: number;
		costUsd?: number;
		avgTaskTimeMs?: number;
	},
): Promise<void> {
	const id = randomUUID();
	await execute(
		`INSERT INTO agent_daily_stats (id, project_id, agent_id, stat_date, tasks_completed, tasks_failed, tokens_used, cost_usd, avg_task_time_ms, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 ON CONFLICT (project_id, agent_id, stat_date)
		 DO UPDATE SET
		   tasks_completed = agent_daily_stats.tasks_completed + EXCLUDED.tasks_completed,
		   tasks_failed = agent_daily_stats.tasks_failed + EXCLUDED.tasks_failed,
		   tokens_used = agent_daily_stats.tokens_used + EXCLUDED.tokens_used,
		   cost_usd = agent_daily_stats.cost_usd + EXCLUDED.cost_usd,
		   avg_task_time_ms = CASE WHEN EXCLUDED.avg_task_time_ms > 0 THEN EXCLUDED.avg_task_time_ms ELSE agent_daily_stats.avg_task_time_ms END`,
		[
			id,
			projectId,
			agentId,
			statDate,
			delta.tasksCompleted ?? 0,
			delta.tasksFailed ?? 0,
			delta.tokensUsed ?? 0,
			delta.costUsd ?? 0,
			delta.avgTaskTimeMs ?? 0,
			now(),
		],
	);
}

// ---------------------------------------------------------------------------
// Heat Map: agent × date matrix
// ---------------------------------------------------------------------------

export async function getAgentHeatMap(projectId: string, days = 14): Promise<AgentHeatMapCell[]> {
	const since = new Date();
	since.setDate(since.getDate() - days);
	const sinceStr = since.toISOString().slice(0, 10);

	const rows = await query<any>(
		`SELECT ads.agent_id, pa.name AS agent_name, ads.stat_date, ads.tasks_completed
		 FROM agent_daily_stats ads
		 JOIN project_agents pa ON pa.id = ads.agent_id
		 WHERE ads.project_id = $1 AND ads.stat_date >= $2
		 ORDER BY ads.stat_date, pa.name`,
		[projectId, sinceStr],
	);

	return rows.map((r: any) => ({
		agentId: r.agent_id,
		agentName: r.agent_name,
		date: r.stat_date,
		value: Number(r.tasks_completed),
	}));
}

// ---------------------------------------------------------------------------
// Performance Timeline: single agent over time
// ---------------------------------------------------------------------------

export async function getAgentPerformanceTimeline(
	projectId: string,
	agentId: string,
	days = 14,
): Promise<AgentPerformancePoint[]> {
	const since = new Date();
	since.setDate(since.getDate() - days);
	const sinceStr = since.toISOString().slice(0, 10);

	const rows = await query<any>(
		`SELECT stat_date, tasks_completed, tasks_failed, tokens_used, cost_usd, avg_task_time_ms
		 FROM agent_daily_stats
		 WHERE project_id = $1 AND agent_id = $2 AND stat_date >= $3
		 ORDER BY stat_date`,
		[projectId, agentId, sinceStr],
	);

	return rows.map((r: any) => ({
		date: r.stat_date,
		tasksCompleted: Number(r.tasks_completed),
		tasksFailed: Number(r.tasks_failed),
		tokensUsed: Number(r.tokens_used),
		costUsd: Number(r.cost_usd),
		avgTaskTimeMs: Number(r.avg_task_time_ms),
	}));
}

// ---------------------------------------------------------------------------
// Agent Comparison: side-by-side metrics
// ---------------------------------------------------------------------------

export async function getAgentComparison(projectId: string): Promise<AgentComparison[]> {
	const rows = await query<any>(
		`SELECT
		   pa.id AS agent_id, pa.name AS agent_name, pa.role, pa.avatar,
		   COALESCE(SUM(ads.tasks_completed), 0) AS total_completed,
		   COALESCE(SUM(ads.tasks_failed), 0) AS total_failed,
		   COALESCE(AVG(NULLIF(ads.avg_task_time_ms, 0)), 0) AS avg_time,
		   COALESCE(SUM(ads.cost_usd), 0) AS total_cost,
		   COALESCE(SUM(ads.tokens_used), 0) AS total_tokens
		 FROM project_agents pa
		 LEFT JOIN agent_daily_stats ads ON ads.agent_id = pa.id AND ads.project_id = pa.project_id
		 WHERE pa.project_id = $1
		 GROUP BY pa.id, pa.name, pa.role, pa.avatar
		 ORDER BY total_completed DESC`,
		[projectId],
	);

	return rows.map((r: any) => {
		const completed = Number(r.total_completed);
		const failed = Number(r.total_failed);
		const total = completed + failed;
		const costPerTask = completed > 0 ? Number(r.total_cost) / completed : 0;
		const firstPassRate = total > 0 ? completed / total : 0;
		const score =
			total > 0 ? Math.round(firstPassRate * 70 + Math.min(1, 30000 / Math.max(Number(r.avg_time), 1)) * 30) : 0;

		return {
			agentId: r.agent_id,
			agentName: r.agent_name,
			role: r.role,
			avatar: r.avatar ?? "",
			score,
			tasksCompleted: completed,
			avgTaskTimeMs: Math.round(Number(r.avg_time)),
			firstPassRate: Math.round(firstPassRate * 100) / 100,
			costPerTask: Math.round(costPerTask * 1000) / 1000,
		};
	});
}
