// ---------------------------------------------------------------------------
// Oscorpex — Analytics Repository: Token Usage + Cost + Analytics
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import { getProjectSettingsMap } from "./settings-repo.js";
import type { CostBreakdownEntry, ProjectCostSummary, TokenUsage } from "../types.js";

// ---------------------------------------------------------------------------
// Token Usage & Cost Tracking
// ---------------------------------------------------------------------------

export async function recordTokenUsage(data: {
	projectId: string;
	taskId: string;
	agentId: string;
	model: string;
	provider: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
}): Promise<TokenUsage> {
	const id = randomUUID();
	const createdAt = new Date().toISOString();
	const cacheCreationTokens = data.cacheCreationTokens ?? 0;
	const cacheReadTokens = data.cacheReadTokens ?? 0;
	await execute(
		`
    INSERT INTO token_usage (id, project_id, task_id, agent_id, model, provider, input_tokens, output_tokens, total_tokens, cost_usd, cache_creation_tokens, cache_read_tokens, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `,
		[
			id,
			data.projectId,
			data.taskId,
			data.agentId,
			data.model,
			data.provider,
			data.inputTokens,
			data.outputTokens,
			data.totalTokens,
			data.costUsd,
			cacheCreationTokens,
			cacheReadTokens,
			createdAt,
		],
	);

	return {
		id,
		projectId: data.projectId,
		taskId: data.taskId,
		agentId: data.agentId,
		model: data.model,
		provider: data.provider,
		inputTokens: data.inputTokens,
		outputTokens: data.outputTokens,
		totalTokens: data.totalTokens,
		costUsd: data.costUsd,
		cacheCreationTokens,
		cacheReadTokens,
		createdAt,
	};
}

export async function getProjectCostSummary(projectId: string): Promise<ProjectCostSummary> {
	const row = await queryOne<any>(
		`
    SELECT
      COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS task_count,
      COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read_tokens
    FROM token_usage
    WHERE project_id = $1
  `,
		[projectId],
	);

	return {
		totalCostUsd: Number.parseFloat(row.total_cost_usd),
		totalInputTokens: Number.parseInt(row.total_input_tokens, 10),
		totalOutputTokens: Number.parseInt(row.total_output_tokens, 10),
		totalTokens: Number.parseInt(row.total_tokens, 10),
		taskCount: Number.parseInt(row.task_count, 10),
		totalCacheCreationTokens: Number.parseInt(row.total_cache_creation_tokens, 10),
		totalCacheReadTokens: Number.parseInt(row.total_cache_read_tokens, 10),
	};
}

export async function getAgentCostSummary(projectId: string, agentId: string): Promise<ProjectCostSummary> {
	const row = await queryOne<any>(
		`
    SELECT
      COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS task_count,
      COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read_tokens
    FROM token_usage
    WHERE project_id = $1 AND agent_id = $2
  `,
		[projectId, agentId],
	);

	return {
		totalCostUsd: Number.parseFloat(row.total_cost_usd),
		totalInputTokens: Number.parseInt(row.total_input_tokens, 10),
		totalOutputTokens: Number.parseInt(row.total_output_tokens, 10),
		totalTokens: Number.parseInt(row.total_tokens, 10),
		taskCount: Number.parseInt(row.task_count, 10),
		totalCacheCreationTokens: Number.parseInt(row.total_cache_creation_tokens, 10),
		totalCacheReadTokens: Number.parseInt(row.total_cache_read_tokens, 10),
	};
}

export async function getProjectCostBreakdown(projectId: string): Promise<CostBreakdownEntry[]> {
	const rows = await query<any>(
		`
    SELECT
      tu.agent_id,
      pa.name AS agent_name,
      pa.avatar AS agent_avatar,
      pa.role AS agent_role,
      tu.model,
      COUNT(*) AS task_count,
      SUM(tu.input_tokens) AS input_tokens,
      SUM(tu.output_tokens) AS output_tokens,
      SUM(tu.total_tokens) AS total_tokens,
      SUM(tu.cost_usd) AS cost_usd
    FROM token_usage tu
    LEFT JOIN project_agents pa ON pa.id = tu.agent_id
    WHERE tu.project_id = $1
    GROUP BY tu.agent_id, tu.model, pa.name, pa.avatar, pa.role
    ORDER BY cost_usd DESC
  `,
		[projectId],
	);

	return rows.map((r: any) => ({
		agentId: r.agent_id,
		agentName: r.agent_name ?? undefined,
		agentAvatar: r.agent_avatar ?? "",
		agentRole: r.agent_role ?? "",
		model: r.model,
		taskCount: Number.parseInt(r.task_count, 10),
		inputTokens: Number.parseInt(r.input_tokens, 10),
		outputTokens: Number.parseInt(r.output_tokens, 10),
		totalTokens: Number.parseInt(r.total_tokens, 10),
		costUsd: Number.parseFloat(r.cost_usd),
	}));
}

export async function listTokenUsage(projectId: string): Promise<TokenUsage[]> {
	const rows = await query<any>("SELECT * FROM token_usage WHERE project_id = $1 ORDER BY created_at DESC", [
		projectId,
	]);
	return rows.map((r: any) => ({
		id: r.id,
		projectId: r.project_id,
		taskId: r.task_id,
		agentId: r.agent_id,
		model: r.model,
		provider: r.provider,
		inputTokens: Number.parseInt(r.input_tokens, 10),
		outputTokens: Number.parseInt(r.output_tokens, 10),
		totalTokens: Number.parseInt(r.total_tokens, 10),
		costUsd: Number.parseFloat(r.cost_usd),
		cacheCreationTokens: Number.parseInt(r.cache_creation_tokens ?? 0, 10),
		cacheReadTokens: Number.parseInt(r.cache_read_tokens ?? 0, 10),
		createdAt: r.created_at,
	}));
}

// ---------------------------------------------------------------------------
// Analytics Queries
// ---------------------------------------------------------------------------

export async function getProjectAnalytics(projectId: string) {
	const taskStats = await queryOne<any>(
		`
    SELECT
      COUNT(*)                                           AS total,
      SUM(CASE WHEN t.status = 'done'    THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status IN ('running','assigned','review') THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN t.status = 'failed'  THEN 1 ELSE 0 END) AS blocked
    FROM tasks t
    JOIN phases ph ON ph.id = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = $1
  `,
		[projectId],
	);

	// Failure count from events table — survives retries/requeues
	const failEventRow = await queryOne<any>(
		`SELECT COUNT(*) AS cnt FROM events WHERE project_id = $1 AND type = 'task:failed'`,
		[projectId],
	);
	const totalFailures = Number.parseInt(failEventRow?.cnt ?? "0", 10);

	// Review rejection count from events table
	const rejectEventRow = await queryOne<any>(
		`SELECT COUNT(*) AS cnt FROM events WHERE project_id = $1 AND type = 'task:review_rejected'`,
		[projectId],
	);
	const totalReviewRejections = Number.parseInt(rejectEventRow?.cnt ?? "0", 10);

	// Match tasks to project agents by: project_agent ID, source_agent_id, or role
	const agentTaskRows = await query<any>(
		`
    SELECT
      pa.id AS agent_id, pa.name AS agent_name,
      COUNT(t.id) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed
    FROM tasks t
    JOIN phases ph  ON ph.id  = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    JOIN project_agents pa ON pa.project_id = pp.project_id
      AND (pa.id = t.assigned_agent OR pa.source_agent_id = t.assigned_agent OR pa.role = t.assigned_agent)
    WHERE pp.project_id = $1
    GROUP BY pa.id, pa.name
  `,
		[projectId],
	);

	const avgRow = await queryOne<any>(
		`
    SELECT AVG(
      EXTRACT(EPOCH FROM (t.completed_at::timestamptz - t.started_at::timestamptz)) * 1000
    ) AS avg_ms
    FROM tasks t
    JOIN phases ph ON ph.id = t.phase_id
    JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = $1
      AND t.started_at IS NOT NULL AND t.completed_at IS NOT NULL AND t.status = 'done'
  `,
		[projectId],
	);

	const pipelineRow = await queryOne<any>(
		`
    SELECT COUNT(*) AS run_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successes
    FROM pipeline_runs WHERE project_id = $1
  `,
		[projectId],
	);

	// Deduplicate by agent name (multiple project_agents may match same tasks)
	const agentMap = new Map<string, any>();
	for (const r of agentTaskRows || []) {
		if (!agentMap.has(r.agent_name)) agentMap.set(r.agent_name, r);
	}
	const tasksPerAgent = [...agentMap.values()].map((r: any) => ({
		agentId: r.agent_id,
		agentName: r.agent_name,
		total: r.total ?? 0,
		completed: r.completed ?? 0,
		completionRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
	}));

	const runCount = Number.parseInt(pipelineRow?.run_count ?? "0", 10);
	const successes = Number.parseInt(pipelineRow?.successes ?? "0", 10);

	return {
		totalTasks: Number.parseInt(taskStats?.total ?? "0", 10),
		completedTasks: Number.parseInt(taskStats?.completed ?? "0", 10),
		inProgressTasks: Number.parseInt(taskStats?.in_progress ?? "0", 10),
		blockedTasks: Number.parseInt(taskStats?.blocked ?? "0", 10),
		totalFailures,
		totalReviewRejections,
		tasksPerAgent,
		avgCompletionTimeMs: avgRow?.avg_ms ? Number.parseFloat(avgRow.avg_ms) : null,
		pipelineRunCount: runCount,
		pipelineSuccessRate: runCount > 0 ? Math.round((successes / runCount) * 100) : 0,
	};
}

export async function getAgentAnalytics(projectId: string) {
	const allAgents = await query<any>(
		"SELECT id, name, role, avatar, color, source_agent_id FROM project_agents WHERE project_id = $1",
		[projectId],
	);
	// Deduplicate agents by source_agent_id (keep first occurrence)
	const seen = new Set<string>();
	const agents = allAgents.filter((a: any) => {
		const key = a.source_agent_id || a.id;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	// Load scoring config from project settings (category: 'scoring')
	const settingsMap = await getProjectSettingsMap(projectId);
	const sc = settingsMap.scoring ?? {};
	const W_SUCCESS = Number.parseFloat(sc.w_success || "30");
	const W_FIRST_PASS = Number.parseFloat(sc.w_firstPass || "25");
	const W_REVIEW = Number.parseFloat(sc.w_review || "20");
	const W_TIME = Number.parseFloat(sc.w_time || "15");
	const W_COST = Number.parseFloat(sc.w_cost || "10");
	const BASELINE_MS = Number.parseFloat(sc.baselineTimeMin || "30") * 60 * 1000;
	const BASELINE_COST = Number.parseFloat(sc.baselineCostUsd || "0.50");

	return Promise.all(
		agents.map(async (a: any) => {
			// Match tasks by: project_agent ID, source (agent_config) ID, or role name
			const matchIds = [a.id, a.source_agent_id, a.role].filter(Boolean);
			const placeholders = matchIds.map((_: any, i: number) => `$${i + 2}`).join(",");

			const taskStats = await queryOne<any>(
				`
      SELECT COUNT(*) AS assigned,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM tasks t JOIN phases ph ON ph.id = t.phase_id
      JOIN project_plans pp ON pp.id = ph.plan_id
      WHERE pp.project_id = $1 AND t.assigned_agent IN (${placeholders})
    `,
				[projectId, ...matchIds],
			);

			const runStats = await queryOne<any>(
				`
      SELECT COUNT(*) AS run_count,
        SUM(CASE WHEN started_at IS NOT NULL AND stopped_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (stopped_at::timestamptz - started_at::timestamptz)) * 1000 ELSE 0 END) AS total_runtime_ms
      FROM agent_runs WHERE project_id = $1 AND agent_id = $2
    `,
				[projectId, a.id],
			);

			// Failure events — survives retries/requeues
			const failEvtRow = await queryOne<any>(
				`SELECT COUNT(*) AS cnt FROM events WHERE project_id = $1 AND type = 'task:failed' AND agent_id IN (${placeholders})`,
				[projectId, ...matchIds],
			);
			// Review rejection events
			const rejectEvtRow = await queryOne<any>(
				`SELECT COUNT(*) AS cnt FROM events WHERE project_id = $1 AND type = 'task:review_rejected' AND agent_id IN (${placeholders})`,
				[projectId, ...matchIds],
			);

			// First-pass tasks: completed without any prior task:failed event
			const firstPassRow = await queryOne<any>(
				`
      SELECT COUNT(*) AS cnt FROM tasks t
      JOIN phases ph ON ph.id = t.phase_id
      JOIN project_plans pp ON pp.id = ph.plan_id
      WHERE pp.project_id = $1 AND t.assigned_agent IN (${placeholders})
        AND t.status = 'done'
        AND t.id NOT IN (
          SELECT DISTINCT task_id FROM events
          WHERE project_id = $1 AND type = 'task:failed' AND task_id IS NOT NULL
        )
    `,
				[projectId, ...matchIds],
			);

			// Token usage
			const tokenRow = await queryOne<any>(
				`SELECT COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(total_tokens),0) AS total_tokens, COALESCE(SUM(cost_usd),0) AS cost_usd FROM token_usage WHERE project_id = $1 AND agent_id = $2`,
				[projectId, a.id],
			);

			const msgSentRow = await queryOne<any>(
				"SELECT COUNT(*) AS cnt FROM agent_messages WHERE project_id = $1 AND from_agent_id = $2",
				[projectId, a.id],
			);
			const msgReceivedRow = await queryOne<any>(
				"SELECT COUNT(*) AS cnt FROM agent_messages WHERE project_id = $1 AND to_agent_id = $2",
				[projectId, a.id],
			);
			const lastRun = await queryOne<any>(
				"SELECT status FROM agent_runs WHERE project_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT 1",
				[projectId, a.id],
			);

			const msgSent = Number.parseInt(msgSentRow?.cnt ?? "0", 10);
			const msgReceived = Number.parseInt(msgReceivedRow?.cnt ?? "0", 10);
			const tasksAssigned = Number.parseInt(taskStats?.assigned ?? "0", 10);
			const tasksCompleted = Number.parseInt(taskStats?.completed ?? "0", 10);
			const totalFailures = Number.parseInt(failEvtRow?.cnt ?? "0", 10);
			const totalReviewRejections = Number.parseInt(rejectEvtRow?.cnt ?? "0", 10);
			const firstPassTasks = Number.parseInt(firstPassRow?.cnt ?? "0", 10);
			const costUsd = Number.parseFloat(tokenRow?.cost_usd ?? "0");

			// --- Agent Score (0-100) ---
			const successRate = tasksAssigned > 0 ? tasksCompleted / tasksAssigned : 0;
			const firstPassRate = tasksCompleted > 0 ? firstPassTasks / tasksCompleted : 0;
			const reviewApprovalRate = tasksAssigned > 0
				? Math.max(0, 1 - totalReviewRejections / tasksAssigned)
				: 0;
			const avgTimeMs = tasksCompleted > 0
				? (Number.parseFloat(runStats?.total_runtime_ms ?? "0") / tasksCompleted)
				: 0;
			const timeScore = avgTimeMs > 0 ? Math.min(1, BASELINE_MS / avgTimeMs) : 0;
			const costPerTask = tasksCompleted > 0 ? costUsd / tasksCompleted : 0;
			const costScore = costPerTask > 0 ? Math.min(1, BASELINE_COST / costPerTask) : 0;

			const score = tasksAssigned > 0
				? Math.round(
					successRate * W_SUCCESS +
					firstPassRate * W_FIRST_PASS +
					reviewApprovalRate * W_REVIEW +
					timeScore * W_TIME +
					costScore * W_COST
				)
				: 0;

			return {
				agentId: a.id,
				agentName: a.name,
				role: a.role,
				avatar: a.avatar ?? "",
				color: a.color,
				tasksAssigned,
				tasksCompleted,
				tasksFailed: Number.parseInt(taskStats?.failed ?? "0", 10),
				totalFailures,
				totalReviewRejections,
				firstPassTasks,
				score,
				runCount: Number.parseInt(runStats?.run_count ?? "0", 10),
				totalRuntimeMs: Math.round(Number.parseFloat(runStats?.total_runtime_ms ?? "0")),
				inputTokens: Number.parseInt(tokenRow?.input_tokens ?? "0", 10),
				outputTokens: Number.parseInt(tokenRow?.output_tokens ?? "0", 10),
				totalTokens: Number.parseInt(tokenRow?.total_tokens ?? "0", 10),
				costUsd,
				messagesSent: msgSent,
				messagesReceived: msgReceived,
				isRunning: lastRun?.status === "running" || lastRun?.status === "starting",
			};
		}),
	);
}

export async function getActivityTimeline(projectId: string, days = 7) {
	const dates: string[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		dates.push(d.toISOString().slice(0, 10));
	}

	const [taskRows, runsStartedRows, runsCompletedRows] = await Promise.all([
		query<any>(
			`
    SELECT SUBSTRING(t.completed_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM tasks t JOIN phases ph ON ph.id = t.phase_id JOIN project_plans pp ON pp.id = ph.plan_id
    WHERE pp.project_id = $1 AND t.status = 'done' AND t.completed_at >= $2
    GROUP BY day
  `,
			[projectId, dates[0]],
		),
		query<any>(
			`
    SELECT SUBSTRING(started_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM agent_runs WHERE project_id = $1 AND started_at >= $2 GROUP BY day
  `,
			[projectId, dates[0]],
		),
		query<any>(
			`
    SELECT SUBSTRING(stopped_at, 1, 10) AS day, COUNT(*) AS cnt
    FROM agent_runs WHERE project_id = $1 AND status IN ('stopped','error') AND stopped_at >= $2 GROUP BY day
  `,
			[projectId, dates[0]],
		),
	]);

	const taskMap = Object.fromEntries((taskRows || []).map((r: any) => [r.day, Number.parseInt(r.cnt, 10)]));
	const rsMap = Object.fromEntries((runsStartedRows || []).map((r: any) => [r.day, Number.parseInt(r.cnt, 10)]));
	const rcMap = Object.fromEntries((runsCompletedRows || []).map((r: any) => [r.day, Number.parseInt(r.cnt, 10)]));

	return dates.map((date) => ({
		date,
		tasksCompleted: taskMap[date] ?? 0,
		runsStarted: rsMap[date] ?? 0,
		runsCompleted: rcMap[date] ?? 0,
	}));
}
