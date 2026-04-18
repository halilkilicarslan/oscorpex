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
// Status Badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
	active: "text-[#3b82f6] bg-[#3b82f6]/10 border-[#3b82f6]/20",
	planning: "text-[#a78bfa] bg-[#a78bfa]/10 border-[#a78bfa]/20",
	executing: "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20",
	completed: "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20",
	failed: "text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20",
	done: "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20",
	running: "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20",
};

function StatusBadge({ status }: { status: string }) {
	return (
		<span
			className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium border ${STATUS_COLORS[status] ?? "text-[#737373] bg-[#1a1a1a] border-[#262626]"}`}
		>
			{status}
		</span>
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

	const { projects, tasks, cost, recentProjects, recentTasks } = stats;
	const taskDoneRate = tasks.total > 0 ? Math.round((tasks.done / tasks.total) * 100) : 0;

	const formatTokens = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
		return String(n);
	};

	const timeAgo = (iso: string) => {
		if (!iso) return "-";
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		return `${Math.floor(hrs / 24)}d ago`;
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

			{/* Recent Projects + Tasks */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
				{/* Recent Projects */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
					<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
						<FolderKanban size={14} className="text-[#3b82f6]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Recent Projects</h3>
					</div>
					{recentProjects.length === 0 ? (
						<p className="text-[11px] text-[#525252] text-center py-6">No projects yet</p>
					) : (
						<div className="divide-y divide-[#1a1a1a]">
							{recentProjects.map((p) => (
								<button
									type="button"
									key={p.id}
									onClick={() => navigate(`/studio/${p.id}`)}
									className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#0a0a0a] transition-colors text-left"
								>
									<div className="flex-1 min-w-0">
										<p className="text-[11px] text-[#e4e4e7] truncate">{p.name}</p>
										<p className="text-[9px] text-[#525252] truncate">{p.description || "-"}</p>
									</div>
									<StatusBadge status={p.status} />
									<span className="text-[9px] text-[#525252] shrink-0">{timeAgo(p.updatedAt)}</span>
									<ChevronRight size={12} className="text-[#525252]" />
								</button>
							))}
						</div>
					)}
				</div>

				{/* Recent Tasks */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
					<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
						<Activity size={14} className="text-[#22c55e]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Recently Completed Tasks</h3>
					</div>
					{recentTasks.length === 0 ? (
						<p className="text-[11px] text-[#525252] text-center py-6">No completed tasks yet</p>
					) : (
						<div className="divide-y divide-[#1a1a1a]">
							{recentTasks.map((t) => (
								<div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
									<div className="flex-1 min-w-0">
										<p className="text-[11px] text-[#e4e4e7] truncate">{t.title}</p>
										<p className="text-[9px] text-[#525252]">
											{t.projectName} · {t.assignedAgent}
										</p>
									</div>
									<span
										className={`text-[9px] px-1.5 py-0.5 rounded border ${
											t.complexity === "XL"
												? "text-[#ef4444] border-[#ef4444]/20 bg-[#ef4444]/10"
												: t.complexity === "L"
													? "text-[#f59e0b] border-[#f59e0b]/20 bg-[#f59e0b]/10"
													: "text-[#525252] border-[#262626] bg-[#1a1a1a]"
										}`}
									>
										{t.complexity}
									</span>
									<span className="text-[9px] text-[#525252] shrink-0">
										{timeAgo(t.completedAt)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
