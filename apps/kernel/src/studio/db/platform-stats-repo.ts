// ---------------------------------------------------------------------------
// Oscorpex — Platform Stats Repository: Dashboard + Analytics Aggregates
// Cross-tenant, aggregate-only: reads sys_platform_stats() (SECURITY DEFINER) in system scope.
// Per-project / per-task / per-file details are NOT exposed (they would leak across tenants).
// ---------------------------------------------------------------------------

import { queryOne } from "../pg.js";
import { canonicalizeAgentRole } from "../roles.js";
import { runAsSystem } from "../tenancy/tenant-scope.js";

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

/** Raw shape of sys_platform_stats() (aggregates across all tenants, no identifying values). */
interface SysPlatformStats {
	total_projects?: number;
	projects_active?: number;
	projects_completed?: number;
	projects_failed?: number;
	total_tasks?: number;
	tasks_done?: number;
	tasks_failed?: number;
	tasks_running?: number;
	tasks_queued?: number;
	unique_agents?: number;
	avg_task_min?: number;
	total_cost_usd?: number;
	total_tokens?: number;
	cache_read_tokens?: number;
	cache_creation_tokens?: number;
	active_agents?: number;
	total_events?: number;
	total_errors?: number;
	active_days?: number;
	agent_usage?: Array<{ role: string; count: number }>;
	daily_activity?: Array<{ date: string; events: number; errors: number; completions: number }>;
	hourly_pattern?: Array<{ hour: number; count: number }>;
	event_types?: Array<{ type: string; count: number }>;
	complexity_distribution?: Array<{ complexity: string; count: number }>;
	cost_by_model?: Array<{ model: string; calls: number; cost: number; tokens: number }>;
}

async function readSysStats(withSeries: boolean): Promise<SysPlatformStats> {
	// Scalars (sys_platform_stats) and series (sys_platform_series) are separate SECURITY DEFINER functions;
	// the series are the expensive part and only the analytics endpoint needs them.
	const row = await runAsSystem("platform-stats", () =>
		queryOne<{ s: SysPlatformStats; series?: SysPlatformStats }>(
			withSeries
				? "SELECT sys_platform_stats() AS s, sys_platform_series() AS series"
				: "SELECT sys_platform_stats() AS s",
		),
	);
	return { ...(row?.s ?? {}), ...(row?.series ?? {}) };
}

/** Merge role aliases (backend_dev, backend-developer, …) under their canonical name, top 12 by count. */
function mergeAgentUsage(rows: Array<{ role: string; count: number }>): Array<{ role: string; count: number }> {
	const merged = new Map<string, number>();
	for (const r of rows) {
		const role = canonicalizeAgentRole(r.role);
		merged.set(role, (merged.get(role) ?? 0) + Number(r.count ?? 0));
	}
	return [...merged.entries()]
		.map(([role, count]) => ({ role, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 12);
}

const n = (v: unknown): number => Number(v ?? 0);

export async function getPlatformStats(): Promise<PlatformStats> {
	const s = await readSysStats(false);
	const totalTokens = n(s.total_tokens);
	const cacheRead = n(s.cache_read_tokens);
	return {
		projects: {
			total: n(s.total_projects),
			active: n(s.projects_active),
			completed: n(s.projects_completed),
			failed: n(s.projects_failed),
		},
		tasks: {
			total: n(s.total_tasks),
			done: n(s.tasks_done),
			running: n(s.tasks_running),
			failed: n(s.tasks_failed),
			queued: n(s.tasks_queued),
		},
		cost: {
			totalUsd: Math.round(n(s.total_cost_usd) * 100) / 100,
			totalTokens,
			cacheReadTokens: cacheRead,
			cacheCreationTokens: n(s.cache_creation_tokens),
			cacheRate: totalTokens > 0 ? Math.round((cacheRead / totalTokens) * 1000) / 10 : 0,
			activeAgents: n(s.active_agents),
		},
		// Identifying lists are intentionally not exposed (cross-tenant data)
		recentProjects: [],
		recentTasks: [],
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
	const s = await readSysStats(true);
	const totalTasks = n(s.total_tasks);
	const tasksDone = n(s.tasks_done);
	const tasksFailed = n(s.tasks_failed);
	const totalEvents = n(s.total_events);
	const totalErrors = n(s.total_errors);
	const totalTokens = n(s.total_tokens);
	const hourly = s.hourly_pattern ?? [];
	return {
		totals: {
			totalProjects: n(s.total_projects),
			totalTasks,
			tasksDone,
			tasksFailed,
			taskDoneRate: totalTasks > 0 ? Math.round((tasksDone / totalTasks) * 100) : 0,
			failureRate: totalTasks > 0 ? Math.round((tasksFailed / totalTasks) * 1000) / 10 : 0,
			uniqueAgents: n(s.unique_agents),
			avgTaskMin: Math.round(n(s.avg_task_min) * 10) / 10,
			totalCostUsd: Math.round(n(s.total_cost_usd) * 100) / 100,
			cacheRate: totalTokens > 0 ? Math.round((n(s.cache_read_tokens) / totalTokens) * 1000) / 10 : 0,
			totalEvents,
			totalErrors,
			errorRate: totalEvents > 0 ? Math.round((totalErrors / totalEvents) * 1000) / 10 : 0,
			activeDays: n(s.active_days),
		},
		// Per-role breakdown (agent names are not exposed)
		agentUsage: mergeAgentUsage(s.agent_usage ?? []).map((r) => ({ agent: r.role, role: r.role, count: n(r.count) })),
		dailyActivity: (s.daily_activity ?? []).map((r) => ({
			date: r.date,
			events: n(r.events),
			errors: n(r.errors),
			completions: n(r.completions),
		})),
		hourlyPattern: Array.from({ length: 24 }, (_, i) => ({
			hour: i,
			count: n(hourly.find((r) => n(r.hour) === i)?.count),
		})),
		projectActivity: [],
		fileActivity: [],
		complexityDistribution: (s.complexity_distribution ?? []).map((r) => ({
			complexity: r.complexity,
			count: n(r.count),
		})),
		eventTypes: (s.event_types ?? []).map((r) => ({ type: r.type, count: n(r.count) })),
		errorRates: [],
		costByModel: (s.cost_by_model ?? []).map((r) => ({
			model: r.model,
			calls: n(r.calls),
			cost: Math.round(n(r.cost) * 1000) / 1000,
			tokens: n(r.tokens),
		})),
	};
}
