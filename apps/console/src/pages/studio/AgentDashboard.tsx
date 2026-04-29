// ---------------------------------------------------------------------------
// Oscorpex — Agent Dashboard (refactored)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';
import {
	Loader2,
	RefreshCw,
	CheckCircle2,
	Clock,
	Zap,
	GitBranch,
	TrendingUp,
	Activity,
	DollarSign,
} from 'lucide-react';
import {
	fetchProjectAnalytics,
	fetchAgentAnalytics,
	fetchActivityTimeline,
	fetchProjectCosts,
	fetchCostBreakdown,
	fetchDocsFreshness,
	fetchSonarStatus,
	fetchLatestSonarScan,
	fetchPoolStatus,
	type ProjectAnalytics,
	type AgentAnalytics,
	type ActivityTimeline,
	type ProjectCostSummary,
	type CostBreakdownEntry,
	type DocFreshnessItem,
	type SonarLatestScan,
	type PoolStatus,
} from '../../lib/studio-api';
import { AgentHeatMap } from './AgentHeatMap';
import {
	StatCard,
	BarChart,
	TimelineChart,
	AgentRow,
	CostBreakdownPanel,
	DocsFreshnessPanel,
	SonarQubePanel,
	ContainerPoolPanel,
	MetricCards,
	CostTrendPanel,
	AgentTimelinePanel,
} from './agent-dashboard/index.js';
import type { BarChartItem } from './agent-dashboard/index.js';

interface Props {
	projectId: string;
}

export default function AgentDashboard({ projectId }: Props) {
	const [overview, setOverview] = useState<ProjectAnalytics | null>(null);
	const [agents, setAgents] = useState<AgentAnalytics[]>([]);
	const [timeline, setTimeline] = useState<ActivityTimeline[]>([]);
	const [costs, setCosts] = useState<ProjectCostSummary | null>(null);
	const [costBreakdown, setCostBreakdown] = useState<CostBreakdownEntry[]>([]);
	const [docsFreshness, setDocsFreshness] = useState<DocFreshnessItem[]>([]);
	const [sonarEnabled, setSonarEnabled] = useState(false);
	const [sonarScan, setSonarScan] = useState<SonarLatestScan | null>(null);
	const [poolStatus, setPoolStatus] = useState<PoolStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedAgentId, setSelectedAgentId] = useState<string>('');

	const load = useCallback(async (silent = false) => {
		if (!silent) setLoading(true);
		else setRefreshing(true);
		setError(null);
		try {
			const [ov, ag, tl, cs, cb, df, ss, sl, ps] = await Promise.all([
				fetchProjectAnalytics(projectId),
				fetchAgentAnalytics(projectId),
				fetchActivityTimeline(projectId, 7),
				fetchProjectCosts(projectId),
				fetchCostBreakdown(projectId),
				fetchDocsFreshness(projectId).catch(() => [] as DocFreshnessItem[]),
				fetchSonarStatus(projectId).catch(() => ({ enabled: false })),
				fetchLatestSonarScan(projectId).catch(() => null as SonarLatestScan | null),
				fetchPoolStatus().catch(() => null as PoolStatus | null),
			]);
			setOverview(ov);
			setAgents(ag);
			setSelectedAgentId((cur) => cur || ag[0]?.agentId || '');
			setTimeline(tl);
			setCosts(cs);
			setCostBreakdown(cb);
			setDocsFreshness(df);
			setSonarEnabled(ss.enabled);
			setSonarScan(sl);
			setPoolStatus(ps);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Veri yuklenemedi');
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [projectId]);

	const { isWsActive } = useWsEventRefresh(
		projectId,
		['task:completed', 'task:failed', 'pipeline:completed'],
		() => load(true),
		{ debounceMs: 2000 },
	);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (isWsActive) return;
		const interval = setInterval(() => load(true), 30_000);
		return () => clearInterval(interval);
	}, [isWsActive, load]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 size={20} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-3">
				<p className="text-[13px] text-[#ef4444]">{error}</p>
				<button
					onClick={() => load()}
					className="text-[12px] text-[#525252] hover:text-[#a3a3a3] underline transition-colors"
				>
					Retry
				</button>
			</div>
		);
	}

	const barItems: BarChartItem[] = (overview?.tasksPerAgent ?? []).map((a) => {
		const ag = agents.find((ag) => ag.agentId === a.agentId);
		return {
			label: a.agentName,
			value: a.total,
			color: ag?.color ?? '#22c55e',
			avatar: ag?.avatar,
			role: ag?.role,
		};
	});
	const maxBarVal = Math.max(1, ...barItems.map((b) => b.value));

	const completionRate =
		(overview?.totalTasks ?? 0) > 0
			? Math.round(((overview?.completedTasks ?? 0) / (overview?.totalTasks ?? 1)) * 100)
			: 0;

	const activeAgents = agents.filter((a) => a.isRunning).length;

	return (
		<div className="flex flex-col gap-5 p-5">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-[15px] font-semibold text-[#fafafa]">Project Dashboard</h2>
					<p className="text-[11px] text-[#525252] mt-0.5">Agent performance and project metrics</p>
				</div>
				<button
					onClick={() => load(true)}
					disabled={refreshing}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414] border border-[#262626] transition-colors disabled:opacity-50"
				>
					<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
					Refresh
				</button>
			</div>

			{/* Stat cards */}
			<div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
				<StatCard
					label="Total Tasks"
					value={overview?.totalTasks ?? 0}
					sub={`${overview?.inProgressTasks ?? 0} in progress`}
					icon={<Activity size={16} />}
					accent="#22c55e"
				/>
				<StatCard
					label="Completion Rate"
					value={`${completionRate}%`}
					sub={`${overview?.completedTasks ?? 0} / ${overview?.totalTasks ?? 0}`}
					icon={<TrendingUp size={16} />}
					accent="#3b82f6"
				/>
				<StatCard
					label="Active Agents"
					value={activeAgents}
					sub={`${agents.length} total`}
					icon={<Zap size={16} />}
					accent="#f59e0b"
				/>
				<StatCard
					label="Pipeline Runs"
					value={overview?.pipelineRunCount ?? 0}
					sub={overview?.pipelineRunCount ? `${overview.pipelineSuccessRate}% success` : undefined}
					icon={<GitBranch size={16} />}
					accent="#a855f7"
				/>
				<StatCard
					label="Total Cost"
					value={costs?.totalCostUsd != null ? `$${costs.totalCostUsd.toFixed(4)}` : '$0'}
					sub={costs?.totalTokens ? `${(costs.totalTokens / 1000).toFixed(1)}K token` : undefined}
					icon={<DollarSign size={16} />}
					accent="#10b981"
				/>
			</div>

			{/* Middle row: Bar chart + Timeline */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-4">
						<CheckCircle2 size={14} className="text-[#22c55e]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Tasks Per Agent</h3>
					</div>
					<BarChart items={barItems} maxValue={maxBarVal} />
				</div>

				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-4">
						<Clock size={14} className="text-[#3b82f6]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Last 7 Days Activity</h3>
					</div>
					<TimelineChart data={timeline} />
					<div className="flex items-center gap-4 mt-3">
						<div className="flex items-center gap-1.5">
							<div className="w-2 h-2 rounded-full bg-[#22c55e]" />
							<span className="text-[10px] text-[#525252]">Completed tasks</span>
						</div>
						<div className="flex items-center gap-1.5">
							<div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
							<span className="text-[10px] text-[#525252]">Agent runs</span>
						</div>
					</div>
				</div>
			</div>

			{/* Metrics row */}
			<MetricCards overview={overview} agents={agents} />

			{/* Cost Breakdown */}
			<CostBreakdownPanel entries={costBreakdown} costs={costs} />

			{/* Docs freshness */}
			<DocsFreshnessPanel items={docsFreshness} />

			{/* SonarQube */}
			{sonarEnabled && <SonarQubePanel projectId={projectId} scan={sonarScan} />}

			{/* Container Pool */}
			<ContainerPoolPanel status={poolStatus} />

			{/* Agent Performance */}
			<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
				<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
					<Activity size={14} className="text-[#22c55e]" />
					<h3 className="text-[12px] font-semibold text-[#fafafa]">Agent Performance</h3>
					<span className="ml-auto text-[10px] text-[#525252]">{agents.length} agents</span>
				</div>

				{agents.length === 0 ? (
					<div className="flex items-center justify-center py-10 text-[12px] text-[#525252]">
						No agents assigned to this project yet
					</div>
				) : (
					<div>
						<div className="flex items-center gap-3 px-4 py-2 bg-[#0d0d0d]">
							<span className="text-[10px] text-[#525252] uppercase tracking-wider w-44 shrink-0">Agent</span>
							<div className="flex gap-4">
								<span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Assigned</span>
								<span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Done</span>
								<span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Failed</span>
							</div>
							<span className="flex-1 text-[10px] text-[#525252] uppercase tracking-wider">Success</span>
							<span className="w-16 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Runs</span>
							<span className="w-16 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Time</span>
							<span className="w-20 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Messages</span>
							<span className="w-16 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Status</span>
						</div>
						{agents.map((agent) => (
							<AgentRow key={agent.agentId} agent={agent} />
						))}
					</div>
				)}

				{/* Agent Heat Map */}
				<div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded-xl p-4">
					<h3 className="text-[13px] font-semibold text-[#fafafa] mb-3">Agent Performans Analizi</h3>
					<AgentHeatMap projectId={projectId} />
				</div>
			</div>

			{/* Cost Trend */}
			<CostTrendPanel projectId={projectId} />

			{/* Agent Timeline */}
			<AgentTimelinePanel
				projectId={projectId}
				agents={agents}
				selectedAgentId={selectedAgentId}
				onSelectAgent={setSelectedAgentId}
			/>
		</div>
	);
}
