// ---------------------------------------------------------------------------
// Oscorpex — Platform Dashboard (genel özet)
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
	Loader2,
	FolderKanban,
	CheckCircle2,
	AlertTriangle,
	Zap,
	DollarSign,
	TrendingUp,
	ChevronRight,
	Activity,
	Database,
} from "lucide-react";
import { fetchPlatformStats, type PlatformStats } from "../../lib/studio-api";

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
	label,
	value,
	sub,
	icon,
	color,
}: {
	label: string;
	value: string | number;
	sub?: string;
	icon: React.ReactNode;
	color: string;
}) {
	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex items-start gap-3">
			<div
				className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
				style={{ backgroundColor: `${color}15` }}
			>
				{icon}
			</div>
			<div className="min-w-0">
				<p className="text-[10px] text-[#737373] uppercase tracking-wider">{label}</p>
				<p className="text-[20px] font-semibold text-[#fafafa] leading-tight">{value}</p>
				{sub && <p className="text-[10px] text-[#525252] mt-0.5 truncate">{sub}</p>}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Mini Progress Bar
// ---------------------------------------------------------------------------

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
	const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
	return (
		<div className="w-full h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
			<div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PlatformDashboard() {
	const [stats, setStats] = useState<PlatformStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const navigate = useNavigate();

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setStats(await fetchPlatformStats());
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load data");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-32">
				<Loader2 size={24} className="animate-spin text-[#525252]" />
			</div>
		);
	}

	if (error || !stats) {
		return (
			<div className="flex flex-col items-center justify-center py-32 gap-3">
				<AlertTriangle size={20} className="text-[#ef4444]" />
				<p className="text-[12px] text-[#737373]">{error ?? "Unknown error"}</p>
				<button type="button" onClick={load} className="text-[11px] text-[#22c55e] hover:underline">
					Retry
				</button>
			</div>
		);
	}

	const { projects, tasks, cost } = stats;
	const taskDoneRate = tasks.total > 0 ? Math.round((tasks.done / tasks.total) * 100) : 0;

	const formatTokens = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
		return String(n);
	};

	return (
		<div className="space-y-5 p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-[16px] font-semibold text-[#fafafa]">Platform Dashboard</h1>
					<p className="text-[11px] text-[#525252] mt-0.5">Overview of all projects</p>
				</div>
				<button
					type="button"
					onClick={() => navigate("/studio")}
					className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 hover:bg-[#22c55e]/20 transition-colors"
				>
					<FolderKanban size={12} />
					Projects
					<ChevronRight size={12} />
				</button>
			</div>

			{/* Stat Cards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
				<StatCard
					label="Projects"
					value={projects.total}
					sub={`${projects.active} active · ${projects.completed} completed`}
					icon={<FolderKanban size={16} style={{ color: "#3b82f6" }} />}
					color="#3b82f6"
				/>
				<StatCard
					label="Tasks"
					value={tasks.total}
					sub={`${tasks.done} done · ${tasks.running} running`}
					icon={<CheckCircle2 size={16} style={{ color: "#22c55e" }} />}
					color="#22c55e"
				/>
				<StatCard
					label="Total Cost"
					value={`$${cost.totalUsd.toFixed(2)}`}
					sub={`${formatTokens(cost.totalTokens)} token · ${cost.activeAgents} agent`}
					icon={<DollarSign size={16} style={{ color: "#f59e0b" }} />}
					color="#f59e0b"
				/>
				<StatCard
					label="Cache Hit"
					value={`${cost.cacheRate}%`}
					sub={`${formatTokens(cost.cacheReadTokens)} cache read`}
					icon={<Zap size={16} style={{ color: "#a78bfa" }} />}
					color="#a78bfa"
				/>
			</div>

			{/* Task Completion + Distribution */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
				{/* Task Completion */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4 space-y-3">
					<div className="flex items-center gap-2">
						<TrendingUp size={14} className="text-[#22c55e]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Task Completion</h3>
						<span className="ml-auto text-[18px] font-semibold text-[#22c55e]">{taskDoneRate}%</span>
					</div>
					<MiniBar value={tasks.done} max={tasks.total} color="#22c55e" />
					<div className="grid grid-cols-4 gap-2 text-center">
						{[
							{ label: "Done", val: tasks.done, color: "#22c55e" },
							{ label: "Running", val: tasks.running, color: "#f59e0b" },
							{ label: "Queued", val: tasks.queued, color: "#3b82f6" },
							{ label: "Failed", val: tasks.failed, color: "#ef4444" },
						].map((s) => (
							<div key={s.label}>
								<p className="text-[16px] font-semibold" style={{ color: s.color }}>
									{s.val}
								</p>
								<p className="text-[9px] text-[#525252]">{s.label}</p>
							</div>
						))}
					</div>
				</div>

				{/* Token Distribution */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4 space-y-3">
					<div className="flex items-center gap-2">
						<Database size={14} className="text-[#a78bfa]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Token Usage</h3>
					</div>
					<div className="space-y-2">
						{[
							{
								label: "Cache Read",
								val: cost.cacheReadTokens,
								total: cost.totalTokens,
								color: "#22c55e",
							},
							{
								label: "Cache Creation",
								val: cost.cacheCreationTokens,
								total: cost.totalTokens,
								color: "#f59e0b",
							},
							{
								label: "Direct",
								val: Math.max(0, cost.totalTokens - cost.cacheReadTokens - cost.cacheCreationTokens),
								total: cost.totalTokens,
								color: "#ef4444",
							},
						].map((row) => (
							<div key={row.label} className="space-y-1">
								<div className="flex justify-between text-[10px]">
									<span className="text-[#a3a3a3]">{row.label}</span>
									<span className="text-[#737373]">{formatTokens(row.val)}</span>
								</div>
								<MiniBar value={row.val} max={row.total} color={row.color} />
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Projects + Tasks by status (aggregate counts across the platform) */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<FolderKanban size={14} className="text-[#3b82f6]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Projects by Status</h3>
					</div>
					<div className="grid grid-cols-4 gap-3 text-center">
						{[
							{ label: "Total", val: projects.total },
							{ label: "Active", val: projects.active },
							{ label: "Completed", val: projects.completed },
							{ label: "Failed", val: projects.failed },
						].map((x) => (
							<div key={x.label}>
								<p className="text-[16px] font-semibold text-[#fafafa] tabular-nums">{x.val}</p>
								<p className="text-[9px] text-[#525252]">{x.label}</p>
							</div>
						))}
					</div>
				</div>
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<Activity size={14} className="text-[#22c55e]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Tasks by Status</h3>
					</div>
					<div className="grid grid-cols-5 gap-3 text-center">
						{[
							{ label: "Total", val: tasks.total },
							{ label: "Done", val: tasks.done },
							{ label: "Running", val: tasks.running },
							{ label: "Queued", val: tasks.queued },
							{ label: "Failed", val: tasks.failed },
						].map((x) => (
							<div key={x.label}>
								<p className="text-[16px] font-semibold text-[#fafafa] tabular-nums">{x.val}</p>
								<p className="text-[9px] text-[#525252]">{x.label}</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
