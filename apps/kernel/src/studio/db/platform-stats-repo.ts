// ---------------------------------------------------------------------------
// Oscorpex — Platform Stats Repository: Dashboard + Analytics Aggregates
// ---------------------------------------------------------------------------

import { query, queryOne } from "../pg.js";

// ---------------------------------------------------------------------------
// Platform Stats (Dashboard Overview)
// ---------------------------------------------------------------------------

export interface PlatformStats {
	projects: {
		total: number;
		active: number;
		completed: number;
		failed: number;
	};
	tasks: {
		total: number;
		done: number;
		running: number;
		failed: number;
		queued: number;
	};
	cost: {
		totalUsd: number;
		totalTokens: number;
		cacheReadTokens: number;
		cacheCreationTokens: number;
		cacheRate: number;
		activeAgents: number;
	};
	recentProjects: Array<{
		id: string;
		name: string;
		status: string;
		description: string | null;
		createdAt: string;
		updatedAt: string;
	}>;
	recentTasks: Array<{
		id: string;
		title: string;
		status: string;
		assignedAgent: string | null;
		complexity: string | null;
		completedAt: string | null;
		projectName: string;
	}>;
}

export async function getPlatformStats(): Promise<PlatformStats> {
	const [projectStats, taskStats, costStats, recentProjects, recentTasks] = await Promise.all([
		queryOne<any>(`
			SELECT
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE status = 'active' OR status = 'planning' OR status = 'executing') AS active,
				COUNT(*) FILTER (WHERE status = 'completed') AS completed,
				COUNT(*) FILTER (WHERE status = 'failed') AS failed
			FROM projects
		`),
		queryOne<any>(`
			SELECT
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE status = 'done') AS done,
				COUNT(*) FILTER (WHERE status = 'running') AS running,
				COUNT(*) FILTER (WHERE status = 'failed') AS failed,
				COUNT(*) FILTER (WHERE status = 'queued' OR status = 'assigned') AS queued
			FROM tasks
		`),
		queryOne<any>(`
			SELECT
				COALESCE(SUM(cost_usd), 0) AS total_cost,
				COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) AS total_tokens,
				COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
				COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation,
				COUNT(DISTINCT agent_id) AS active_agents
			FROM token_usage
		`),
		query<any>(`
			SELECT id, name, status, description, created_at, updated_at
			FROM projects ORDER BY updated_at DESC LIMIT 5
		`),
		query<any>(`
			SELECT t.id, t.title, t.status, t.assigned_agent, t.complexity, t.completed_at, p.name AS project_name
			FROM tasks t
			JOIN phases ph ON ph.id = t.phase_id
			JOIN project_plans pp ON pp.id = ph.plan_id
			JOIN projects p ON p.id = pp.project_id
			WHERE t.status = 'done'
			ORDER BY t.completed_at DESC NULLS LAST LIMIT 8
		`),
	]);

	const totalTokens = Number(costStats?.total_tokens ?? 0);
	const cacheRead = Number(costStats?.cache_read ?? 0);
	const cacheRate = totalTokens > 0 ? cacheRead / totalTokens : 0;

	return {
		projects: {
			total: Number(projectStats?.total ?? 0),
			active: Number(projectStats?.active ?? 0),
			completed: Number(projectStats?.completed ?? 0),
			failed: Number(projectStats?.failed ?? 0),
		},
		tasks: {
			total: Number(taskStats?.total ?? 0),
			done: Number(taskStats?.done ?? 0),
			running: Number(taskStats?.running ?? 0),
			failed: Number(taskStats?.failed ?? 0),
			queued: Number(taskStats?.queued ?? 0),
		},
		cost: {
			totalUsd: Math.round(Number(costStats?.total_cost ?? 0) * 100) / 100,
			totalTokens,
			cacheReadTokens: cacheRead,
			cacheCreationTokens: Number(costStats?.cache_creation ?? 0),
			cacheRate: Math.round(cacheRate * 1000) / 10,
			activeAgents: Number(costStats?.active_agents ?? 0),
		},
		recentProjects: recentProjects.map((r: any) => ({
			id: r.id,
			name: r.name,
			status: r.status,
			description: r.description,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		})),
		recentTasks: recentTasks.map((r: any) => ({
			id: r.id,
			title: r.title,
			status: r.status,
			assignedAgent: r.assigned_agent,
			complexity: r.complexity,
			completedAt: r.completed_at,
			projectName: r.project_name,
		})),
	};
}

// ---------------------------------------------------------------------------
// Platform Analytics (Context-Mode Style)
// ---------------------------------------------------------------------------

export interface PlatformAnalytics {
	totals: {
		totalProjects: number;
		totalTasks: number;
		tasksDone: number;
		tasksFailed: number;
		taskDoneRate: number;
		failureRate: number;
		uniqueAgents: number;
		avgTaskMin: number;
		totalCostUsd: number;
		cacheRate: number;
		totalEvents: number;
		totalErrors: number;
		errorRate: number;
		activeDays: number;
	};
	agentUsage: Array<{ agent: string; role: string; count: number }>;
	dailyActivity: Array<{ date: unknown; events: number; errors: number; completions: number }>;
	hourlyPattern: Array<{ hour: number; count: number }>;
	projectActivity: Array<{
		projectName: string;
		projectId: string;
		status: string;
		events: number;
		activeDays: number;
	}>;
	fileActivity: Array<{ file: string; count: number }>;
	complexityDistribution: Array<{ complexity: string; count: number }>;
	eventTypes: Array<{ type: string; count: number }>;
	errorRates: Array<{
		projectName: string;
		projectId: string;
		errors: number;
		total: number;
		errorRate: number;
	}>;
	costByModel: Array<{ model: string; calls: number; cost: number; tokens: number }>;
}

export async function getPlatformAnalytics(): Promise<PlatformAnalytics> {
	const [
		totalsRow,
		agentUsage,
		dailyActivity,
		hourlyPattern,
		projectActivity,
		fileActivity,
		complexityDist,
		eventTypes,
		errorRates,
		costByModel,
	] = await Promise.all([
		// Totals
		queryOne<any>(`
			SELECT
				(SELECT COUNT(*) FROM projects) AS total_projects,
				(SELECT COUNT(*) FROM tasks) AS total_tasks,
				(SELECT COUNT(*) FILTER (WHERE status = 'done') FROM tasks) AS tasks_done,
				(SELECT COUNT(*) FILTER (WHERE status = 'failed') FROM tasks) AS tasks_failed,
				(SELECT COUNT(DISTINCT assigned_agent) FROM tasks WHERE assigned_agent IS NOT NULL) AS unique_agents,
				(SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at::timestamp - started_at::timestamp)) / 60), 0)
				 FROM tasks WHERE status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL) AS avg_task_min,
				(SELECT COALESCE(SUM(cost_usd), 0) FROM token_usage) AS total_cost,
				(SELECT COALESCE(SUM(cache_read_tokens), 0) FROM token_usage) AS cache_read,
				(SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) FROM token_usage) AS total_tokens,
				(SELECT COUNT(*) FROM events) AS total_events,
				(SELECT COUNT(*) FILTER (WHERE type LIKE '%failed%' OR type LIKE '%error%') FROM events) AS total_errors,
				(SELECT COUNT(DISTINCT DATE(timestamp::timestamptz)) FROM events) AS active_days
		`),
		// Agent usage (like tool usage)
		query<any>(`
			SELECT COALESCE(pa.name, t.assigned_agent) AS agent_name,
				COALESCE(pa.role, 'unknown') AS role,
				COUNT(t.id) AS task_count
			FROM tasks t
			LEFT JOIN project_agents pa ON pa.name = t.assigned_agent OR pa.id::text = t.assigned_agent
			WHERE t.assigned_agent IS NOT NULL
			GROUP BY COALESCE(pa.name, t.assigned_agent), COALESCE(pa.role, 'unknown')
			ORDER BY task_count DESC LIMIT 12
		`),
		// Daily activity (like sessionsByDate)
		query<any>(`
			SELECT DATE(timestamp::timestamptz) AS date, COUNT(*) AS events,
				COUNT(*) FILTER (WHERE type LIKE '%failed%') AS errors,
				COUNT(*) FILTER (WHERE type = 'task:completed') AS completions
			FROM events
			GROUP BY DATE(timestamp::timestamptz)
			ORDER BY date DESC LIMIT 30
		`),
		// Hourly pattern (like hourlyPattern)
		query<any>(`
			SELECT EXTRACT(HOUR FROM timestamp::timestamptz) AS hour, COUNT(*) AS count
			FROM events GROUP BY hour ORDER BY hour
		`),
		// Project activity (like projectActivity)
		query<any>(`
			SELECT p.name AS project_name, p.id AS project_id, p.status,
				COUNT(e.id) AS events,
				COUNT(DISTINCT DATE(e.timestamp::timestamptz)) AS active_days
			FROM projects p
			LEFT JOIN events e ON e.project_id = p.id
			GROUP BY p.id, p.name, p.status
			ORDER BY events DESC LIMIT 10
		`),
		// Hot files (like fileActivity) — from task_diffs
		query<any>(`
			SELECT file_path AS file, COUNT(*) AS count
			FROM task_diffs
			GROUP BY file_path ORDER BY count DESC LIMIT 15
		`),
		// Complexity distribution (like explore vs execute)
		query<any>(`
			SELECT complexity, COUNT(*) AS count FROM tasks
			WHERE complexity IS NOT NULL
			GROUP BY complexity ORDER BY count DESC
		`),
		// Event types (like eventTypes)
		query<any>(`
			SELECT type, COUNT(*) AS count FROM events
			GROUP BY type ORDER BY count DESC LIMIT 15
		`),
		// Error rates by project (like errorRates)
		query<any>(`
			SELECT p.name AS project_name, p.id AS project_id,
				COUNT(*) FILTER (WHERE e.type LIKE '%failed%') AS errors,
				COUNT(*) AS total,
				CASE WHEN COUNT(*) > 0
					THEN ROUND(100.0 * COUNT(*) FILTER (WHERE e.type LIKE '%failed%') / COUNT(*), 1)
					ELSE 0 END AS error_rate
			FROM projects p
			LEFT JOIN events e ON e.project_id = p.id
			GROUP BY p.id, p.name
			HAVING COUNT(*) > 0
			ORDER BY error_rate DESC
		`),
		// Cost by model (like MCP tools breakdown)
		query<any>(`
			SELECT model, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
				COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
			FROM token_usage
			WHERE model IS NOT NULL
			GROUP BY model ORDER BY cost DESC
		`),
	]);

	const t = totalsRow ?? {};
	const totalTasks = Number(t.total_tasks ?? 0);
	const tasksDone = Number(t.tasks_done ?? 0);
	const tasksFailed = Number(t.tasks_failed ?? 0);
	const totalEvents = Number(t.total_events ?? 0);
	const totalErrors = Number(t.total_errors ?? 0);
	const totalTokens = Number(t.total_tokens ?? 0);
	const cacheRead = Number(t.cache_read ?? 0);

	return {
		totals: {
			totalProjects: Number(t.total_projects ?? 0),
			totalTasks,
			tasksDone,
			tasksFailed,
			taskDoneRate: totalTasks > 0 ? Math.round((tasksDone / totalTasks) * 100) : 0,
			failureRate: totalTasks > 0 ? Math.round((tasksFailed / totalTasks) * 1000) / 10 : 0,
			uniqueAgents: Number(t.unique_agents ?? 0),
			avgTaskMin: Math.round(Number(t.avg_task_min ?? 0) * 10) / 10,
			totalCostUsd: Math.round(Number(t.total_cost ?? 0) * 100) / 100,
			cacheRate: totalTokens > 0 ? Math.round((cacheRead / totalTokens) * 1000) / 10 : 0,
			totalEvents,
			totalErrors,
			errorRate: totalEvents > 0 ? Math.round((totalErrors / totalEvents) * 1000) / 10 : 0,
			activeDays: Number(t.active_days ?? 0),
		},
		agentUsage: agentUsage.map((r: any) => ({
			agent: r.agent_name,
			role: r.role,
			count: Number(r.task_count),
		})),
		dailyActivity: dailyActivity
			.map((r: any) => ({
				date: r.date,
				events: Number(r.events),
				errors: Number(r.errors),
				completions: Number(r.completions),
			}))
			.reverse(),
		hourlyPattern: Array.from({ length: 24 }, (_, i) => {
			const found = hourlyPattern.find((r: any) => Number(r.hour) === i);
			return { hour: i, count: found ? Number(found.count) : 0 };
		}),
		projectActivity: projectActivity.map((r: any) => ({
			projectName: r.project_name,
			projectId: r.project_id,
			status: r.status,
			events: Number(r.events),
			activeDays: Number(r.active_days),
		})),
		fileActivity: fileActivity.map((r: any) => ({
			file: r.file,
			count: Number(r.count),
		})),
		complexityDistribution: complexityDist.map((r: any) => ({
			complexity: r.complexity,
			count: Number(r.count),
		})),
		eventTypes: eventTypes.map((r: any) => ({
			type: r.type,
			count: Number(r.count),
		})),
		errorRates: errorRates.map((r: any) => ({
			projectName: r.project_name,
			projectId: r.project_id,
			errors: Number(r.errors),
			total: Number(r.total),
			errorRate: Number(r.error_rate),
		})),
		costByModel: costByModel.map((r: any) => ({
			model: r.model,
			calls: Number(r.calls),
			cost: Math.round(Number(r.cost) * 1000) / 1000,
			tokens: Number(r.tokens),
		})),
	};
}
