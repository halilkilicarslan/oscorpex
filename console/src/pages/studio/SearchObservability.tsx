// ---------------------------------------------------------------------------
// SearchObservability — RAG/FTS search quality dashboard (v4.1)
// ---------------------------------------------------------------------------

import { useState, useEffect } from "react";
import { Loader2, Search, Zap, Target, Clock, XCircle } from "lucide-react";
import { fetchSearchObservability, type SearchObservabilityData, type SearchLogEntry } from "../../lib/studio-api";

function StatCard({ icon: Icon, label, value, sub, color }: {
	icon: typeof Search;
	label: string;
	value: string | number;
	sub?: string;
	color: string;
}) {
	return (
		<div className="bg-[#111111] border border-[#1f1f1f] rounded-lg px-3 py-2.5">
			<div className="flex items-center gap-2 mb-1">
				<Icon size={12} className={color} />
				<span className="text-[10px] text-[#737373] uppercase tracking-wider">{label}</span>
			</div>
			<div className="text-[18px] font-semibold text-[#fafafa]">{value}</div>
			{sub && <div className="text-[10px] text-[#525252] mt-0.5">{sub}</div>}
		</div>
	);
}

function HitRateBar({ rate }: { rate: number }) {
	const pct = Math.round(rate * 100);
	const color = pct >= 80 ? "bg-[#22c55e]" : pct >= 50 ? "bg-[#f59e0b]" : "bg-[#ef4444]";
	return (
		<div className="flex items-center gap-2">
			<div className="flex-1 h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
				<div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
			</div>
			<span className={`text-[12px] font-medium ${pct >= 80 ? "text-[#22c55e]" : pct >= 50 ? "text-[#f59e0b]" : "text-[#ef4444]"}`}>
				{pct}%
			</span>
		</div>
	);
}

function HourlyChart({ data }: { data: SearchObservabilityData["hourlyBreakdown"] }) {
	if (data.length === 0) return null;
	const maxSearches = Math.max(...data.map((d) => d.searches), 1);

	return (
		<div className="space-y-1.5">
			<h4 className="text-[11px] text-[#737373] font-medium">Saatlik Dagilim</h4>
			<div className="flex items-end gap-1 h-16">
				{data.map((d, i) => {
					const hitPct = d.searches > 0 ? d.hits / d.searches : 0;
					const barColor = hitPct >= 0.8 ? "bg-[#22c55e]/60" : hitPct >= 0.5 ? "bg-[#f59e0b]/60" : "bg-[#ef4444]/60";
					return (
						<div
							key={i}
							className={`flex-1 ${barColor} rounded-t-sm min-w-[4px]`}
							style={{ height: `${Math.max((d.searches / maxSearches) * 100, 5)}%` }}
							title={`${d.hour}: ${d.searches} arama, ${d.hits} hit, ${d.avgLatency}ms`}
						/>
					);
				})}
			</div>
		</div>
	);
}

function RecentSearches({ data }: { data: SearchLogEntry[] }) {
	if (data.length === 0) {
		return <div className="text-[11px] text-[#525252] text-center py-4">Arama kaydi bulunamadi.</div>;
	}

	return (
		<div className="space-y-1.5">
			<h4 className="text-[11px] text-[#737373] font-medium">Son Aramalar</h4>
			<div className="max-h-[300px] overflow-y-auto">
				<table className="w-full text-[11px]">
					<thead>
						<tr className="border-b border-[#1f1f1f]">
							<th className="text-left text-[#525252] font-normal py-1.5">Sorgu</th>
							<th className="text-center text-[#525252] font-normal py-1.5 w-16">Sonuc</th>
							<th className="text-center text-[#525252] font-normal py-1.5 w-16">Rank</th>
							<th className="text-center text-[#525252] font-normal py-1.5 w-16">Gecikme</th>
							<th className="text-right text-[#525252] font-normal py-1.5 w-20">Zaman</th>
						</tr>
					</thead>
					<tbody>
						{data.map((s) => (
							<tr key={s.id} className="border-b border-[#1a1a1a] hover:bg-[#111111]">
								<td className="py-1.5 pr-2">
									<div className="flex items-center gap-1.5">
										{s.resultCount > 0 ? (
											<Target size={10} className="text-[#22c55e] shrink-0" />
										) : (
											<XCircle size={10} className="text-[#ef4444] shrink-0" />
										)}
										<span className="text-[#a3a3a3] truncate max-w-[200px]" title={s.queryText}>
											{s.queryText.slice(0, 60)}{s.queryText.length > 60 ? "..." : ""}
										</span>
									</div>
								</td>
								<td className="py-1.5 text-center">
									<span className={s.resultCount > 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>
										{s.resultCount}
									</span>
								</td>
								<td className="py-1.5 text-center text-[#737373]">
									{s.topRank != null ? s.topRank.toFixed(2) : "\u2014"}
								</td>
								<td className="py-1.5 text-center">
									<span className={s.latencyMs > 200 ? "text-[#f59e0b]" : "text-[#737373]"}>
										{s.latencyMs}ms
									</span>
								</td>
								<td className="py-1.5 text-right text-[#525252]">
									{new Date(s.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export function SearchObservability({ projectId }: { projectId: string }) {
	const [data, setData] = useState<SearchObservabilityData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	useEffect(() => {
		setLoading(true);
		fetchSearchObservability(projectId)
			.then(setData)
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

	if (error) return <div className="text-[12px] text-[#ef4444] py-3">{error}</div>;

	if (!data || data.totalSearches === 0) {
		return (
			<div className="text-center py-8 text-[#525252] text-[12px]">
				<Search size={20} className="mx-auto mb-2 text-[#333]" />
				Henuz arama verisi yok.
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
				<StatCard icon={Search} label="Toplam Arama" value={data.totalSearches} color="text-[#3b82f6]" />
				<StatCard icon={Target} label="Hit Rate" value={`${Math.round(data.hitRate * 100)}%`} sub={`${data.totalHits} hit / ${data.totalMisses} miss`} color="text-[#22c55e]" />
				<StatCard icon={Clock} label="Ort. Gecikme" value={`${data.avgLatencyMs}ms`} color="text-[#f59e0b]" />
				<StatCard icon={Zap} label="Ort. Sonuc" value={data.avgResultCount} sub={`Rank: ${data.avgTopRank}`} color="text-[#a855f7]" />
			</div>

			<div className="bg-[#111111] border border-[#1f1f1f] rounded-lg p-3">
				<div className="text-[10px] text-[#737373] uppercase tracking-wider mb-2">Hit Rate</div>
				<HitRateBar rate={data.hitRate} />
			</div>

			{data.hourlyBreakdown.length > 0 && (
				<div className="bg-[#111111] border border-[#1f1f1f] rounded-lg p-3">
					<HourlyChart data={data.hourlyBreakdown} />
				</div>
			)}

			<div className="bg-[#111111] border border-[#1f1f1f] rounded-lg p-3">
				<RecentSearches data={data.recentSearches} />
			</div>
		</div>
	);
}
