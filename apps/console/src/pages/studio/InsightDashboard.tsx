// ---------------------------------------------------------------------------
// Oscorpex — Insight Dashboard (context-mode style analytics)
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import {
	Loader2,
	AlertTriangle,
	Zap,
	Shield,
	TrendingUp,
	Activity,
	FolderOpen,
	FileCode,
	Clock,
	Users,
	Brain,
	Lightbulb,
	CheckCircle,
	Cpu,
	BarChart3,
} from "lucide-react";
import { fetchPlatformAnalytics, type PlatformAnalytics } from "../../lib/studio-api";

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

// ---------------------------------------------------------------------------
// Insight Engine
// ---------------------------------------------------------------------------

interface Insight {
	icon: React.ReactNode;
	severity: "positive" | "warning" | "critical" | "neutral";
	metric: string;
	evidence: string;
	action: string;
	roi: string;
}

const SEV_STYLES = {
	positive: { border: "border-[#22c55e]/30", bg: "bg-[#22c55e]/5", badge: "bg-[#22c55e]/15 text-[#22c55e]", label: "Great" },
	warning: { border: "border-[#f59e0b]/30", bg: "bg-[#f59e0b]/5", badge: "bg-[#f59e0b]/15 text-[#f59e0b]", label: "Warning" },
	critical: { border: "border-[#ef4444]/30", bg: "bg-[#ef4444]/5", badge: "bg-[#ef4444]/15 text-[#ef4444]", label: "Fix Now" },
	neutral: { border: "border-[#3b82f6]/30", bg: "bg-[#3b82f6]/5", badge: "bg-[#3b82f6]/15 text-[#3b82f6]", label: "Info" },
};

function generateInsights(d: PlatformAnalytics): Insight[] {
	const ins: Insight[] = [];
	const t = d.totals;

	// Failure rate
	if (t.totalTasks >= 5) {
		if (t.failureRate > 15) {
			ins.push({
				icon: <AlertTriangle size={16} className="text-[#ef4444]" />, severity: "critical",
				metric: `${t.failureRate}% failure rate`,
				evidence: `${t.tasksFailed} out of ${t.totalTasks} tasks failed.`,
				action: "Reduce task complexity or tune review loops to lower failure rates.",
				roi: `Saves re-run costs for ${t.tasksFailed} failed tasks.`,
			});
		} else if (t.failureRate < 5) {
			ins.push({
				icon: <CheckCircle size={16} className="text-[#22c55e]" />, severity: "positive",
				metric: `Only ${t.failureRate}% failure rate`,
				evidence: `${t.tasksDone} tasks completed successfully. Almost every task passed on the first run.`,
				action: "Keep up the great work.",
				roi: "Low failure rate = fewer re-runs = lower costs.",
			});
		}
	}

	// Cache rate
	if (t.cacheRate > 0) {
		if (t.cacheRate > 80) {
			ins.push({
				icon: <Zap size={16} className="text-[#22c55e]" />, severity: "positive",
				metric: `${t.cacheRate}% cache hit — excellent token savings`,
				evidence: `Most tokens are served from cache. Cost optimization is ideal.`,
				action: "Keep this pattern. The context packet system is working correctly.",
				roi: "Cache enables 90%+ cost savings.",
			});
		} else if (t.cacheRate < 40) {
			ins.push({
				icon: <Brain size={16} className="text-[#f59e0b]" />, severity: "warning",
				metric: `Only ${t.cacheRate}% cache hit`,
				evidence: `Most tokens go directly to the API. Cache usage is low.`,
				action: "Group tasks on similar files to increase cache hit rate.",
				roi: "Every 10% cache increase reduces costs by ~8%.",
			});
		}
	}

	// Error rate
	if (t.totalEvents >= 20) {
		if (t.errorRate > 10) {
			ins.push({
				icon: <Shield size={16} className="text-[#ef4444]" />, severity: "critical",
				metric: `${t.errorRate}% event error rate`,
				evidence: `${t.totalErrors} errors in ${t.totalEvents} events. Too many failed events.`,
				action: "Investigate recurring error patterns and resolve root causes.",
				roi: `Fixing these errors saves an estimated ${Math.round(t.totalErrors * 0.5)} minutes.`,
			});
		} else if (t.errorRate < 3) {
			ins.push({
				icon: <Shield size={16} className="text-[#22c55e]" />, severity: "positive",
				metric: `Only ${t.errorRate}% error rate — very clean`,
				evidence: `${t.totalErrors} errors in ${t.totalEvents} events. Almost everything works on the first try.`,
				action: "Maintain this quality level.",
				roi: "Clean runs = less debug time = faster results.",
			});
		}
	}

	// Agent diversity
	if (t.uniqueAgents >= 6 && t.totalProjects >= 1) {
		ins.push({
			icon: <Users size={16} className="text-[#3b82f6]" />, severity: "positive",
			metric: `${t.uniqueAgents} different agents active`,
			evidence: `The Scrum team is running at full capacity. Each agent handles tasks in its area of expertise.`,
			action: "Track agent scores and optimize low-performing agents.",
			roi: "Specialized agents can improve overall success rate by 15-20%.",
		});
	}

	// Avg task duration
	if (t.avgTaskMin > 0) {
		if (t.avgTaskMin > 10) {
			ins.push({
				icon: <Clock size={16} className="text-[#f59e0b]" />, severity: "warning",
				metric: `Average task duration ${t.avgTaskMin}min`,
				evidence: `Tasks take ${t.avgTaskMin} minutes on average. This may be a bit high.`,
				action: "Try decomposing XL tasks into micro-tasks for parallel execution.",
				roi: "Task decomposition can reduce total time by 30-40%.",
			});
		} else if (t.avgTaskMin < 4 && t.totalTasks >= 5) {
			ins.push({
				icon: <Zap size={16} className="text-[#22c55e]" />, severity: "positive",
				metric: `Average ${t.avgTaskMin}min — very fast task completion`,
				evidence: `Tasks complete quickly. Model routing and complexity sizing are working well.`,
				action: "Maintain this speed level.",
				roi: "Fast task completion = less CLI usage time = lower costs.",
			});
		}
	}

	return ins;
}

// ---------------------------------------------------------------------------
// Reusable UI Components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, icon, color }: {
	label: string; value: string | number; sub: string; icon: React.ReactNode; color: string;
}) {
	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
			<div className="flex items-center justify-between mb-2">
				<span className="text-[10px] font-medium text-[#737373] uppercase tracking-wider">{label}</span>
				<span style={{ color }}>{icon}</span>
			</div>
			<div className="text-[22px] font-bold text-[#fafafa] tabular-nums">{value}</div>
			<p className="text-[10px] text-[#525252] mt-0.5">{sub}</p>
		</div>
	);
}

function InsightCard({ icon, severity, metric, evidence, action, roi }: Insight) {
	const s = SEV_STYLES[severity];
	return (
		<div className={`rounded-xl border ${s.border} ${s.bg} p-4`}>
			<div className="flex items-center gap-2 mb-2">
				<span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${s.badge}`}>
					{s.label}
				</span>
			</div>
			<div className="flex items-center gap-2 mb-1.5">
				{icon}
				<h4 className="text-[12px] font-bold text-[#fafafa]">{metric}</h4>
			</div>
			<p className="text-[10px] text-[#a3a3a3] mb-3">{evidence}</p>
			<div className="grid grid-cols-2 gap-2">
				<div className="rounded-lg bg-[#0a0a0a]/40 p-2.5">
					<p className="text-[8px] font-bold uppercase tracking-wider text-[#737373] mb-0.5">Action</p>
					<p className="text-[10px] text-[#e4e4e7]">{action}</p>
				</div>
				<div className="rounded-lg bg-[#0a0a0a]/40 p-2.5">
					<p className="text-[8px] font-bold uppercase tracking-wider text-[#737373] mb-0.5">Impact</p>
					<p className="text-[10px] text-[#e4e4e7]">{roi}</p>
				</div>
			</div>
		</div>
	);
}

function RatioBar({ items }: { items: { label: string; value: number; color: string }[] }) {
	const total = items.reduce((a, b) => a + b.value, 0);
	if (total === 0) return null;
	return (
		<div>
			<div className="flex h-2.5 rounded-full overflow-hidden bg-[#1a1a1a]">
				{items.map((item, i) => (
					<div key={i} className="transition-all" style={{
						width: `${Math.max(Math.round(100 * item.value / total), 2)}%`,
						background: item.color,
					}} />
				))}
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
				{items.map((item, i) => (
					<span key={i} className="text-[10px] text-[#737373] flex items-center gap-1">
						<span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
						{item.label}: {item.value} ({Math.round(100 * item.value / total)}%)
					</span>
				))}
			</div>
		</div>
	);
}

function Mini({ label, value, color }: { label: string; value: string | number; color?: string }) {
	return (
		<div className="text-center">
			<div className={`text-[18px] font-bold tabular-nums ${color || "text-[#fafafa]"}`}>{value}</div>
			<p className="text-[9px] text-[#737373] uppercase tracking-wider">{label}</p>
		</div>
	);
}

function BarRow({ label, value, max, color, index }: {
	label: string; value: number; max: number; color: string; index: number;
}) {
	const pct = max > 0 ? Math.round(100 * value / max) : 0;
	return (
		<div>
			<div className="flex justify-between text-[10px] mb-0.5">
				<span className="font-medium text-[#e4e4e7] truncate max-w-[180px]">{label}</span>
				<span className="text-[#737373] tabular-nums">{value} <span className="text-[#525252]">({pct}%)</span></span>
			</div>
			<div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
				<div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color || COLORS[index % COLORS.length] }} />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function InsightDashboard() {
	const [data, setData] = useState<PlatformAnalytics | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setData(await fetchPlatformAnalytics());
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load data");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { load(); }, [load]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-32">
				<Loader2 size={24} className="animate-spin text-[#525252]" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="flex flex-col items-center justify-center py-32 gap-3">
				<AlertTriangle size={20} className="text-[#ef4444]" />
				<p className="text-[12px] text-[#737373]">{error ?? "Unknown error"}</p>
				<button type="button" onClick={load} className="text-[11px] text-[#22c55e] hover:underline">Retry</button>
			</div>
		);
	}

	const t = data.totals;
	const insights = generateInsights(data);
	const topAgent = data.agentUsage[0];
	const peakHour = data.hourlyPattern.reduce((max, h) => h.count > (max?.count || 0) ? h : max, data.hourlyPattern[0]);
	const topProject = data.projectActivity[0];
	const topFile = data.fileActivity[0];
	const totalAgentTasks = data.agentUsage.reduce((a, b) => a + b.count, 0);

	return (
		<div className="space-y-5 p-6">
			{/* Header */}
			<div>
				<h1 className="text-[16px] font-semibold text-[#fafafa]">Insight Dashboard</h1>
				<p className="text-[11px] text-[#525252] mt-0.5">
					Personal analytics · {t.totalProjects} projects · {t.totalEvents} events · {t.activeDays} active days
				</p>
			</div>

			{/* KPI Strip */}
			<div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
				<StatCard label="Projects" value={t.totalProjects} sub={`${t.activeDays} active days`}
					icon={<FolderOpen size={14} />} color="#3b82f6" />
				<StatCard label="Task Success" value={`${t.taskDoneRate}%`} sub={`${t.tasksDone} done / ${t.totalTasks}`}
					icon={<TrendingUp size={14} />} color="#22c55e" />
				<StatCard label="Cache Hit" value={`${t.cacheRate}%`} sub={`$${t.totalCostUsd} total cost`}
					icon={<Zap size={14} />} color="#a78bfa" />
				<StatCard label="Error Rate" value={`${t.errorRate}%`} sub={`${t.totalErrors} errors`}
					icon={<Shield size={14} />} color={t.errorRate > 10 ? "#ef4444" : "#22c55e"} />
				<StatCard label="Avg Task" value={`${t.avgTaskMin}m`} sub={`${t.uniqueAgents} agents`}
					icon={<Clock size={14} />} color="#06b6d4" />
			</div>

			{/* Insights */}
			{insights.length > 0 && (
				<div>
					<div className="flex items-center gap-2 mb-3">
						<Lightbulb size={14} className="text-[#f59e0b]" />
						<h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#737373]">Insights & Actions</h3>
						<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#262626] text-[#a3a3a3]">{insights.length}</span>
					</div>
					<div className="grid gap-3 md:grid-cols-2">
						{insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
					</div>
				</div>
			)}

			<div className="border-t border-[#1a1a1a]" />

			{/* Agent Usage + Model Cost */}
			<div className="grid gap-3 lg:grid-cols-2">
				{/* Agent Usage */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<Users size={14} className="text-[#3b82f6]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Agent Usage</h3>
					</div>
					<div className="grid grid-cols-3 gap-4 mb-4">
						<Mini label="Total Tasks" value={totalAgentTasks} />
						<Mini label="Most Active" value={topAgent?.agent || "-"} color="text-[#3b82f6]" />
						<Mini label="Agent Count" value={data.agentUsage.length} color="text-[#a78bfa]" />
					</div>
					<div className="space-y-2">
						{data.agentUsage.slice(0, 8).map((a, i) => (
							<BarRow key={i} label={`${a.agent} (${a.role})`} value={a.count} max={totalAgentTasks} color={COLORS[i % COLORS.length]} index={i} />
						))}
					</div>
				</div>

				{/* Model Cost */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<Cpu size={14} className="text-[#a78bfa]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Model Usage</h3>
					</div>
					{data.costByModel.length > 0 ? (
						<>
							<div className="grid grid-cols-3 gap-4 mb-4">
								<Mini label="Models" value={data.costByModel.length} />
								<Mini label="Top Model" value={data.costByModel[0]?.model?.split("-").slice(-2).join("-") || "-"} color="text-[#a78bfa]" />
								<Mini label="Total Cost" value={`$${t.totalCostUsd}`} color="text-[#f59e0b]" />
							</div>
							<RatioBar items={data.costByModel.map((m, i) => ({
								label: m.model, value: m.calls, color: COLORS[i % COLORS.length],
							}))} />
							<div className="mt-3 space-y-1.5">
								{data.costByModel.map((m, i) => (
									<div key={i} className="flex items-center justify-between">
										<span className="text-[10px] font-mono text-[#e4e4e7] truncate max-w-[160px]">{m.model}</span>
										<div className="flex items-center gap-2">
											<span className="text-[9px] text-[#737373] tabular-nums">{m.calls} calls</span>
											<span className="text-[9px] px-1.5 py-0.5 rounded border border-[#262626] bg-[#0a0a0a] text-[#a3a3a3] tabular-nums">${m.cost}</span>
										</div>
									</div>
								))}
							</div>
						</>
					) : <p className="text-[11px] text-[#525252] text-center py-8">No model data yet</p>}
				</div>
			</div>

			{/* Daily Activity + When You Code */}
			<div className="grid gap-3 lg:grid-cols-2">
				{/* Daily Activity */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<Activity size={14} className="text-[#3b82f6]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Daily Activity</h3>
					</div>
					<div className="grid grid-cols-3 gap-4 mb-4">
						<Mini label="Total" value={t.totalEvents} />
						<Mini label="Active Days" value={t.activeDays} color="text-[#3b82f6]" />
						<Mini label="Events/Day" value={t.activeDays > 0 ? Math.round(t.totalEvents / t.activeDays) : 0} color="text-[#22c55e]" />
					</div>
					{data.dailyActivity.length > 0 && (
						<div className="space-y-1.5 pt-2 border-t border-[#1a1a1a]">
							{data.dailyActivity.slice(-7).map((d, i) => {
								const maxEv = Math.max(...data.dailyActivity.map((x) => x.events));
								return (
									<div key={i} className="flex items-center gap-2">
										<span className="text-[9px] text-[#737373] tabular-nums min-w-[48px]">{d.date?.slice(5)}</span>
										<div className="flex-1 flex gap-0.5">
											{Array.from({ length: Math.min(Math.ceil(d.completions * 20 / Math.max(maxEv, 1)), 20) }, (_, j) => (
												<div key={j} className="w-4 h-4 rounded-sm bg-[#22c55e]/80" />
											))}
											{d.errors > 0 && Array.from({ length: Math.min(d.errors, 5) }, (_, j) => (
												<div key={`e${j}`} className="w-4 h-4 rounded-sm bg-[#ef4444]/60" />
											))}
										</div>
										<span className="text-[9px] text-[#737373] tabular-nums">
											{d.events}e{d.errors > 0 ? ` ${d.errors}err` : ""}
										</span>
									</div>
								);
							})}
							<div className="flex gap-4 mt-2">
								<span className="text-[9px] text-[#737373] flex items-center gap-1">
									<span className="w-2 h-2 rounded-sm bg-[#22c55e]/80" /> Completed
								</span>
								<span className="text-[9px] text-[#737373] flex items-center gap-1">
									<span className="w-2 h-2 rounded-sm bg-[#ef4444]/60" /> Errors
								</span>
							</div>
						</div>
					)}
				</div>

				{/* When You Code */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<Clock size={14} className="text-[#06b6d4]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Activity Hours</h3>
					</div>
					<div className="grid grid-cols-3 gap-4 mb-4">
						<Mini label="Peak Hour" value={peakHour ? `${String(peakHour.hour).padStart(2, "0")}:00` : "-"} color="text-[#06b6d4]" />
						<Mini label="Peak Events" value={peakHour?.count || 0} />
						<Mini label="Active Hours" value={data.hourlyPattern.filter((h) => h.count > 0).length} />
					</div>
					<div className="pt-2 border-t border-[#1a1a1a]">
						<div className="grid grid-cols-12 gap-1">
							{data.hourlyPattern.map((h) => {
								const maxCount = peakHour?.count || 1;
								const opacity = h.count > 0 ? 0.2 + 0.8 * (h.count / maxCount) : 0.05;
								return (
									<div key={h.hour} className="flex flex-col items-center gap-0.5">
										<div
											className="w-full aspect-square rounded-sm transition-all"
											style={{ background: h.count > 0 ? `rgba(6, 182, 212, ${opacity})` : "#1a1a1a" }}
											title={`${String(h.hour).padStart(2, "0")}:00 — ${h.count} event`}
										/>
										{h.hour % 4 === 0 && <span className="text-[7px] text-[#525252]">{h.hour}</span>}
									</div>
								);
							})}
						</div>
						<div className="flex justify-between mt-2">
							<span className="text-[8px] text-[#525252]">00:00</span>
							<span className="text-[8px] text-[#525252]">12:00</span>
							<span className="text-[8px] text-[#525252]">23:00</span>
						</div>
					</div>
				</div>
			</div>

			{/* Project Focus + Hot Files */}
			<div className="grid gap-3 lg:grid-cols-2">
				{/* Project Focus */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<FolderOpen size={14} className="text-[#22c55e]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Project Focus</h3>
					</div>
					<div className="grid grid-cols-3 gap-4 mb-4">
						<Mini label="Projects" value={t.totalProjects} />
						<Mini label="Most Active" value={topProject?.projectName || "-"} color="text-[#22c55e]" />
						<Mini label="Events" value={topProject?.events || 0} />
					</div>
					<div className="space-y-2.5 pt-2 border-t border-[#1a1a1a]">
						{data.projectActivity.slice(0, 6).map((p, i) => {
							const maxEv = data.projectActivity[0]?.events || 1;
							const pct = Math.round((p.events / maxEv) * 100);
							return (
								<div key={i}>
									<div className="flex justify-between text-[10px] mb-1">
										<span className="font-medium text-[#e4e4e7] truncate max-w-[160px]">{p.projectName}</span>
										<span className="text-[#737373] tabular-nums">{p.activeDays}g · {p.events}e</span>
									</div>
									<div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
										<div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Hot Files */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<FileCode size={14} className="text-[#f59e0b]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Hot Files</h3>
					</div>
					<div className="grid grid-cols-3 gap-4 mb-4">
						<Mini label="Files" value={data.fileActivity.length} />
						<Mini label="Top File" value={topFile?.file?.split("/").pop() || "-"} color="text-[#f59e0b]" />
						<Mini label="Hits" value={topFile?.count || 0} />
					</div>
					<div className="space-y-1 pt-2 border-t border-[#1a1a1a]">
						{data.fileActivity.slice(0, 10).map((f, i) => {
							const parts = f.file?.split("/") || [];
							const name = parts.pop() || f.file;
							const dir = parts.slice(-2).join("/");
							return (
								<div key={i} className="flex items-center gap-2 py-0.5">
									<span className="text-[9px] px-1.5 py-0.5 rounded border border-[#262626] bg-[#0a0a0a] text-[#a3a3a3] tabular-nums min-w-[24px] text-center">{f.count}</span>
									<span className="text-[10px] font-mono text-[#e4e4e7] truncate">
										{dir && <span className="text-[#525252]">{dir}/</span>}{name}
									</span>
								</div>
							);
						})}
						{data.fileActivity.length === 0 && (
							<p className="text-[10px] text-[#525252] text-center py-6">No file data yet</p>
						)}
					</div>
				</div>
			</div>

			{/* Complexity Distribution + Event Types */}
			<div className="grid gap-3 lg:grid-cols-2">
				{/* Complexity */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<BarChart3 size={14} className="text-[#3b82f6]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Complexity Distribution</h3>
					</div>
					{data.complexityDistribution.length > 0 ? (
						<RatioBar items={data.complexityDistribution.map((c) => ({
							label: c.complexity,
							value: c.count,
							color: c.complexity === "S" ? "#22c55e" : c.complexity === "M" ? "#3b82f6" : c.complexity === "L" ? "#f59e0b" : "#ef4444",
						}))} />
					) : <p className="text-[10px] text-[#525252] text-center py-6">No data</p>}
				</div>

				{/* Event Types */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<div className="flex items-center gap-2 mb-3">
						<Activity size={14} className="text-[#a78bfa]" />
						<h3 className="text-[12px] font-semibold text-[#fafafa]">Event Types</h3>
					</div>
					<div className="space-y-1.5">
						{data.eventTypes.slice(0, 8).map((e, i) => (
							<div key={i} className="flex items-center justify-between">
								<span className="text-[10px] font-mono text-[#e4e4e7] truncate max-w-[180px]">{e.type}</span>
								<span className="text-[9px] px-1.5 py-0.5 rounded border border-[#262626] bg-[#0a0a0a] text-[#a3a3a3] tabular-nums">{e.count}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
