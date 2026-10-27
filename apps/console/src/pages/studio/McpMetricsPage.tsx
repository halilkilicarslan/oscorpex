import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Shield, Wrench } from "lucide-react";

interface McpMetrics {
	totalTools?: number;
	readOnlyTools?: number;
	writeTools?: number;
	writeEnabled?: boolean;
	totalInvocations?: number;
	approvalRate?: number;
	rejectionRate?: number;
	avgDurationMs?: number;
	pendingApprovals?: number;
}

interface StatCardProps {
	label: string;
	value: string | number;
	icon: React.ReactNode;
	accent?: string;
	sub?: string;
}

function StatCard({ label, value, icon, accent = "text-[#22c55e]", sub }: StatCardProps) {
	return (
		<div className="rounded-xl border border-[#262626] bg-[#111] p-5 space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-xs text-[#525252] font-medium uppercase tracking-wide">{label}</span>
				<span className={`${accent}`}>{icon}</span>
			</div>
			<p className={`text-2xl font-bold ${accent}`}>{value}</p>
			{sub && <p className="text-xs text-[#525252]">{sub}</p>}
		</div>
	);
}

export default function McpMetricsPage() {
	const [metrics, setMetrics] = useState<McpMetrics | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchMetrics = () => {
		setLoading(true);
		setError(null);
		fetch("/api/studio/mcp/metrics")
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d: McpMetrics) => setMetrics(d))
			.catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load metrics"))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		fetchMetrics();
	}, []);

	return (
		<div className="p-6 space-y-6 min-h-screen bg-[#0a0a0a]">
			{/* Header */}
			<div className="flex items-end justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-xl font-semibold text-[#e5e5e5]">MCP Metrics</h1>
					<p className="text-sm text-[#737373] mt-1">
						Tool registry stats, invocation rates, and approval pipeline health.
					</p>
				</div>
				<button
					type="button"
					onClick={fetchMetrics}
					disabled={loading}
					className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[#262626] text-[#a3a3a3] hover:bg-[#1a1a1a] disabled:opacity-50"
				>
					<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
					Refresh
				</button>
			</div>

			{/* Error */}
			{error && (
				<div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
					{error}
				</div>
			)}

			{/* Loading */}
			{loading && (
				<div className="flex items-center gap-2 text-[#737373] text-sm">
					<Loader2 size={15} className="animate-spin" />
					Loading metrics...
				</div>
			)}

			{/* Metrics grid */}
			{!loading && metrics && (
				<>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
						<StatCard
							label="Total Tools"
							value={metrics.totalTools ?? 0}
							icon={<Wrench size={18} />}
							accent="text-[#22c55e]"
							sub="Registered in MCP registry"
						/>
						<StatCard
							label="Read-Only Tools"
							value={metrics.readOnlyTools ?? 0}
							icon={<Shield size={18} />}
							accent="text-blue-400"
							sub="No approval required"
						/>
						<StatCard
							label="Write Tools"
							value={metrics.writeTools ?? 0}
							icon={<Wrench size={18} />}
							accent="text-yellow-400"
							sub="Require human approval"
						/>
						<StatCard
							label="Write Approvals"
							value={metrics.writeEnabled ? "Enabled" : "Disabled"}
							icon={<CheckCircle2 size={18} />}
							accent={metrics.writeEnabled ? "text-[#22c55e]" : "text-red-400"}
							sub={metrics.writeEnabled ? "Gate active — humans in loop" : "Write ops blocked"}
						/>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
						<StatCard
							label="Total Invocations"
							value={metrics.totalInvocations ?? 0}
							icon={<Wrench size={16} />}
							accent="text-[#a3a3a3]"
						/>
						<StatCard
							label="Approval Rate"
							value={metrics.approvalRate != null ? `${(metrics.approvalRate * 100).toFixed(1)}%` : "—"}
							icon={<CheckCircle2 size={16} />}
							accent="text-[#22c55e]"
						/>
						<StatCard
							label="Rejection Rate"
							value={metrics.rejectionRate != null ? `${(metrics.rejectionRate * 100).toFixed(1)}%` : "—"}
							icon={<Shield size={16} />}
							accent="text-red-400"
						/>
						<StatCard
							label="Avg Duration"
							value={
								metrics.avgDurationMs != null
									? metrics.avgDurationMs < 1000
										? `${Math.round(metrics.avgDurationMs)}ms`
										: `${(metrics.avgDurationMs / 1000).toFixed(1)}s`
									: "—"
							}
							icon={<Loader2 size={16} />}
							accent="text-[#a3a3a3]"
							sub="Per tool invocation"
						/>
					</div>

					{(metrics.pendingApprovals ?? 0) > 0 && (
						<div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
							<Shield size={16} />
							<span>
								<strong>{metrics.pendingApprovals}</strong> write approval{metrics.pendingApprovals !== 1 ? "s" : ""} pending human review.
							</span>
						</div>
					)}
				</>
			)}

			{!loading && !metrics && !error && (
				<div className="flex flex-col items-center justify-center py-16 gap-2 text-[#525252]">
					<p className="text-sm">No metrics available.</p>
				</div>
			)}
		</div>
	);
}
