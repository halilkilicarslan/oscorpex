import { useEffect, useState } from "react";
import { Clock, Loader2, RefreshCw } from "lucide-react";

interface McpAuditEvent {
	id: string;
	toolName: string;
	source: string;
	decision: string;
	status: string;
	durationMs: number;
	createdAt: string;
	actorId: string;
	errorCode?: string;
}

function DecisionBadge({ decision }: { decision: string }) {
	const map: Record<string, string> = {
		approved: "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20",
		rejected: "bg-red-500/10 text-red-400 border-red-500/20",
		auto_approved: "bg-blue-500/10 text-blue-400 border-blue-500/20",
		pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
	};
	const cls = map[decision] ?? "bg-[#262626] text-[#737373] border-[#333]";
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${cls}`}>
			{decision}
		</span>
	);
}

function StatusDot({ status }: { status: string }) {
	const map: Record<string, string> = {
		success: "bg-[#22c55e]",
		error: "bg-red-400",
		timeout: "bg-yellow-400",
		pending: "bg-blue-400",
	};
	const cls = map[status] ?? "bg-[#525252]";
	return (
		<span className="inline-flex items-center gap-1.5 text-xs text-[#a3a3a3]">
			<span className={`w-1.5 h-1.5 rounded-full ${cls}`} />
			{status}
		</span>
	);
}

function formatTime(iso: string) {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

function formatDuration(ms: number) {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export default function McpAuditPage() {
	const [events, setEvents] = useState<McpAuditEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchEvents = () => {
		setLoading(true);
		setError(null);
		fetch("/api/studio/mcp/audit")
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d) => setEvents(d.events ?? []))
			.catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load audit events"))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		fetchEvents();
	}, []);

	return (
		<div className="p-6 space-y-6 min-h-screen bg-[#0a0a0a]">
			{/* Header */}
			<div className="flex items-end justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-xl font-semibold text-[#e5e5e5]">MCP Audit Log</h1>
					<p className="text-sm text-[#737373] mt-1">
						Audit trail for all MCP tool invocations — decisions, statuses, and durations.
					</p>
				</div>
				<button
					type="button"
					onClick={fetchEvents}
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
					Loading audit events...
				</div>
			)}

			{/* Table */}
			{!loading && (
				<div className="rounded-xl border border-[#262626] bg-[#111] overflow-hidden">
					{events.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-16 gap-2 text-[#525252]">
							<p className="text-sm">No audit events found.</p>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full text-xs">
								<thead className="border-b border-[#262626] text-[#525252]">
									<tr>
										<th className="py-3 px-4 text-left font-medium">Time</th>
										<th className="py-3 px-4 text-left font-medium">Tool</th>
										<th className="py-3 px-4 text-left font-medium">Source</th>
										<th className="py-3 px-4 text-left font-medium">Decision</th>
										<th className="py-3 px-4 text-left font-medium">Status</th>
										<th className="py-3 px-4 text-left font-medium">Duration</th>
										<th className="py-3 px-4 text-left font-medium">Actor</th>
										<th className="py-3 px-4 text-left font-medium">Error</th>
									</tr>
								</thead>
								<tbody>
									{events.map((event) => (
										<tr key={event.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors">
											<td className="py-3 px-4 text-[#737373] whitespace-nowrap">
												<span className="flex items-center gap-1">
													<Clock size={11} />
													{formatTime(event.createdAt)}
												</span>
											</td>
											<td className="py-3 px-4 text-[#e5e5e5] font-mono">{event.toolName}</td>
											<td className="py-3 px-4 text-[#a3a3a3]">{event.source}</td>
											<td className="py-3 px-4">
												<DecisionBadge decision={event.decision} />
											</td>
											<td className="py-3 px-4">
												<StatusDot status={event.status} />
											</td>
											<td className="py-3 px-4 text-[#a3a3a3] tabular-nums">
												{formatDuration(event.durationMs)}
											</td>
											<td className="py-3 px-4 text-[#737373] truncate max-w-[120px]">{event.actorId}</td>
											<td className="py-3 px-4">
												{event.errorCode ? (
													<span className="text-red-400 font-mono">{event.errorCode}</span>
												) : (
													<span className="text-[#525252]">—</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}

			{/* Summary row */}
			{!loading && events.length > 0 && (
				<p className="text-xs text-[#525252]">
					{events.length} events total —{" "}
					{events.filter((e) => e.decision === "approved").length} approved,{" "}
					{events.filter((e) => e.decision === "rejected").length} rejected
				</p>
			)}
		</div>
	);
}
