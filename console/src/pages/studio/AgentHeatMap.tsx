// ---------------------------------------------------------------------------
// AgentHeatMap — Agent activity heat map + comparison table (v4.1)
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo } from "react";
import { Loader2, Target, BarChart3 } from "lucide-react";
import {
	fetchAgentHeatMap,
	fetchAgentComparison,
	roleLabel,
	type AgentHeatMapCell,
	type AgentComparisonEntry,
} from "../../lib/studio-api";
import AgentAvatarImg from "../../components/AgentAvatar";

// ---------------------------------------------------------------------------
// Heat Map Grid
// ---------------------------------------------------------------------------

function intensityColor(value: number, max: number): string {
	if (value === 0) return "bg-[#1a1a1a]";
	const ratio = value / Math.max(max, 1);
	if (ratio < 0.25) return "bg-[#22c55e]/20";
	if (ratio < 0.5) return "bg-[#22c55e]/40";
	if (ratio < 0.75) return "bg-[#22c55e]/60";
	return "bg-[#22c55e]/80";
}

function HeatMapGrid({ data }: { data: AgentHeatMapCell[] }) {
	const { agents, dates, matrix, maxVal } = useMemo(() => {
		const agentSet = new Map<string, string>();
		const dateSet = new Set<string>();
		for (const d of data) {
			agentSet.set(d.agentId, d.agentName);
			dateSet.add(d.date);
		}
		const agents = Array.from(agentSet.entries()).map(([id, name]) => ({ id, name }));
		const dates = Array.from(dateSet).sort();
		const matrix = new Map<string, number>();
		let maxVal = 0;
		for (const d of data) {
			const key = `${d.agentId}:${d.date}`;
			matrix.set(key, d.value);
			if (d.value > maxVal) maxVal = d.value;
		}
		return { agents, dates, matrix, maxVal };
	}, [data]);

	if (agents.length === 0 || dates.length === 0) {
		return <div className="text-[12px] text-[#525252] text-center py-6">Heat map verisi bulunamadi.</div>;
	}

	const shortDate = (d: string) => {
		const dt = new Date(d);
		return `${dt.getDate()}/${dt.getMonth() + 1}`;
	};

	return (
		<div className="overflow-x-auto">
			<table className="text-[11px]">
				<thead>
					<tr>
						<th className="text-left text-[#737373] font-normal pr-3 py-1">Agent</th>
						{dates.map((d) => (
							<th key={d} className="text-center text-[#525252] font-normal px-1 py-1 min-w-[28px]">
								{shortDate(d)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{agents.map((agent) => (
						<tr key={agent.id}>
							<td className="text-[#a3a3a3] pr-3 py-0.5 truncate max-w-[120px]">{agent.name}</td>
							{dates.map((d) => {
								const val = matrix.get(`${agent.id}:${d}`) ?? 0;
								return (
									<td key={d} className="px-0.5 py-0.5">
										<div
											className={`w-6 h-6 rounded-sm ${intensityColor(val, maxVal)} flex items-center justify-center`}
											title={`${agent.name} — ${d}: ${val} task`}
										>
											{val > 0 && <span className="text-[9px] text-[#fafafa]/70">{val}</span>}
										</div>
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Comparison Table
// ---------------------------------------------------------------------------

function ComparisonTable({ data }: { data: AgentComparisonEntry[] }) {
	if (data.length === 0) {
		return <div className="text-[12px] text-[#525252] text-center py-6">Karsilastirma verisi bulunamadi.</div>;
	}

	const formatMs = (ms: number) => {
		if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
		return `${Math.round(ms / 60_000)}d`;
	};

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-[11px]">
				<thead>
					<tr className="border-b border-[#1f1f1f]">
						<th className="text-left text-[#737373] font-normal py-2 pr-3">Agent</th>
						<th className="text-left text-[#737373] font-normal py-2 px-2">Rol</th>
						<th className="text-center text-[#737373] font-normal py-2 px-2">Skor</th>
						<th className="text-center text-[#737373] font-normal py-2 px-2">Tamamlanan</th>
						<th className="text-center text-[#737373] font-normal py-2 px-2">Ort. Sure</th>
						<th className="text-center text-[#737373] font-normal py-2 px-2">First-Pass</th>
						<th className="text-center text-[#737373] font-normal py-2 px-2">Maliyet/Task</th>
					</tr>
				</thead>
				<tbody>
					{data.map((a) => (
						<tr key={a.agentId} className="border-b border-[#1a1a1a] hover:bg-[#111111]">
							<td className="py-2 pr-3">
								<div className="flex items-center gap-2">
									<AgentAvatarImg avatar={a.avatar} name={a.agentName} size="xs" />
									<span className="text-[#e4e4e7] truncate max-w-[100px]">{a.agentName}</span>
								</div>
							</td>
							<td className="py-2 px-2 text-[#a3a3a3]">{roleLabel(a.role)}</td>
							<td className="py-2 px-2 text-center">
								<span className={`font-medium ${a.score >= 70 ? "text-[#22c55e]" : a.score >= 40 ? "text-[#f59e0b]" : "text-[#ef4444]"}`}>
									{a.score}
								</span>
							</td>
							<td className="py-2 px-2 text-center text-[#e4e4e7]">{a.tasksCompleted}</td>
							<td className="py-2 px-2 text-center text-[#a3a3a3]">{formatMs(a.avgTaskTimeMs)}</td>
							<td className="py-2 px-2 text-center">
								<span className={a.firstPassRate >= 0.8 ? "text-[#22c55e]" : a.firstPassRate >= 0.5 ? "text-[#f59e0b]" : "text-[#ef4444]"}>
									{Math.round(a.firstPassRate * 100)}%
								</span>
							</td>
							<td className="py-2 px-2 text-center text-[#a3a3a3]">${a.costPerTask.toFixed(3)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AgentHeatMap({ projectId }: { projectId: string }) {
	const [heatMap, setHeatMap] = useState<AgentHeatMapCell[]>([]);
	const [comparison, setComparison] = useState<AgentComparisonEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [tab, setTab] = useState<"heatmap" | "comparison">("heatmap");

	useEffect(() => {
		setLoading(true);
		Promise.all([
			fetchAgentHeatMap(projectId).catch(() => []),
			fetchAgentComparison(projectId).catch(() => []),
		])
			.then(([hm, comp]) => {
				setHeatMap(hm);
				setComparison(comp);
			})
			.catch((err) => setError(err?.message || "Veri yuklenemedi"))
			.finally(() => setLoading(false));
	}, [projectId]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 size={18} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	if (error) {
		return <div className="text-[12px] text-[#ef4444] py-3">{error}</div>;
	}

	return (
		<div className="space-y-4">
			{/* Tabs */}
			<div className="flex gap-1 bg-[#0a0a0a] rounded-lg p-0.5 w-fit border border-[#1f1f1f]">
				<button
					type="button"
					onClick={() => setTab("heatmap")}
					className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] transition-colors ${
						tab === "heatmap" ? "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20" : "text-[#737373] hover:text-[#a3a3a3]"
					}`}
				>
					<BarChart3 size={12} />
					Heat Map
				</button>
				<button
					type="button"
					onClick={() => setTab("comparison")}
					className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] transition-colors ${
						tab === "comparison" ? "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20" : "text-[#737373] hover:text-[#a3a3a3]"
					}`}
				>
					<Target size={12} />
					Karsilastirma
				</button>
			</div>

			{/* Content */}
			{tab === "heatmap" && <HeatMapGrid data={heatMap} />}
			{tab === "comparison" && <ComparisonTable data={comparison} />}
		</div>
	);
}
