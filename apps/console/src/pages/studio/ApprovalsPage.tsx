import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert, XCircle } from "lucide-react";

interface WriteApproval {
	id: string;
	toolName: string;
	projectId: string;
	actorId: string;
	source: string;
	riskLevel: string;
	status: string;
	checkpointId: string;
	createdAt: string;
	expiresAt?: string;
	argsSummary?: string;
}

function StatusBadge({ status }: { status: string }) {
	const map: Record<string, string> = {
		pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
		approved: "bg-green-500/10 text-[#22c55e] border-green-500/20",
		rejected: "bg-red-500/10 text-red-400 border-red-500/20",
		expired: "bg-[#262626] text-[#737373] border-[#333]",
	};
	const cls = map[status] ?? "bg-[#262626] text-[#737373] border-[#333]";
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
			{status}
		</span>
	);
}

function RiskBadge({ level }: { level: string }) {
	const map: Record<string, string> = {
		low: "text-[#22c55e]",
		medium: "text-yellow-400",
		high: "text-red-400",
	};
	const icons: Record<string, React.ReactNode> = {
		low: <CheckCircle2 size={13} />,
		medium: <AlertTriangle size={13} />,
		high: <ShieldAlert size={13} />,
	};
	const cls = map[level] ?? "text-[#737373]";
	return (
		<span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
			{icons[level] ?? <AlertTriangle size={13} />}
			{level}
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

export default function ApprovalsPage() {
	const [approvals, setApprovals] = useState<WriteApproval[]>([]);
	const [selected, setSelected] = useState<WriteApproval | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState(false);
	const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);

	const fetchApprovals = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const res = await fetch("/api/studio/mcp/approvals");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			setApprovals(data.approvals ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load approvals");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchApprovals();
	}, [fetchApprovals]);

	const handleAction = async (approvalId: string, action: "approve" | "reject") => {
		setActionLoading(true);
		setError(null);
		try {
			const res = await fetch(`/api/studio/mcp/approvals/${approvalId}/${action}`, { method: "POST" });
			if (!res.ok) throw new Error(`Action failed: HTTP ${res.status}`);
			await fetchApprovals();
			setSelected(null);
			setConfirmAction(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Action failed");
		} finally {
			setActionLoading(false);
		}
	};

	const pendingCount = approvals.filter((a) => a.status === "pending").length;

	return (
		<div className="p-6 space-y-6 min-h-screen bg-[#0a0a0a]">
			{/* Header */}
			<div className="flex items-end justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-xl font-semibold text-[#e5e5e5]">MCP Write Approvals</h1>
					<p className="text-sm text-[#737373] mt-1">
						Tool write operations awaiting human review.{" "}
						{pendingCount > 0 && (
							<span className="text-yellow-400 font-medium">{pendingCount} pending</span>
						)}
					</p>
				</div>
				<button
					type="button"
					onClick={() => void fetchApprovals()}
					disabled={loading}
					className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[#262626] text-[#a3a3a3] hover:bg-[#1a1a1a] disabled:opacity-50"
				>
					{loading ? <Loader2 size={12} className="animate-spin" /> : null}
					Refresh
				</button>
			</div>

			{/* Error banner */}
			{error && (
				<div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
					<XCircle size={15} />
					{error}
				</div>
			)}

			{/* Loading */}
			{loading && (
				<div className="flex items-center gap-2 text-[#737373] text-sm">
					<Loader2 size={15} className="animate-spin" />
					Loading approvals...
				</div>
			)}

			{/* Approval list */}
			{!loading && (
				<div className="rounded-xl border border-[#262626] bg-[#111] overflow-hidden">
					{approvals.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-16 gap-3 text-[#525252]">
							<CheckCircle2 size={32} className="text-[#22c55e] opacity-40" />
							<p className="text-sm">No approvals found.</p>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full text-xs">
								<thead className="border-b border-[#262626] text-[#525252]">
									<tr>
										<th className="py-3 px-4 text-left font-medium">Tool</th>
										<th className="py-3 px-4 text-left font-medium">Source</th>
										<th className="py-3 px-4 text-left font-medium">Actor</th>
										<th className="py-3 px-4 text-left font-medium">Risk</th>
										<th className="py-3 px-4 text-left font-medium">Status</th>
										<th className="py-3 px-4 text-left font-medium">Created</th>
										<th className="py-3 px-4 text-left font-medium">Action</th>
									</tr>
								</thead>
								<tbody>
									{approvals.map((approval) => (
										<tr
											key={approval.id}
											className={`border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors ${
												selected?.id === approval.id ? "bg-[#1a1a1a]" : ""
											}`}
										>
											<td className="py-3 px-4 text-[#e5e5e5] font-mono">{approval.toolName}</td>
											<td className="py-3 px-4 text-[#a3a3a3]">{approval.source}</td>
											<td className="py-3 px-4 text-[#a3a3a3] truncate max-w-[120px]">{approval.actorId}</td>
											<td className="py-3 px-4">
												<RiskBadge level={approval.riskLevel} />
											</td>
											<td className="py-3 px-4">
												<StatusBadge status={approval.status} />
											</td>
											<td className="py-3 px-4 text-[#737373]">
												<span className="flex items-center gap-1">
													<Clock size={11} />
													{formatTime(approval.createdAt)}
												</span>
											</td>
											<td className="py-3 px-4">
												<button
													type="button"
													onClick={() => {
														setSelected(approval);
														setConfirmAction(null);
													}}
													className="px-2 py-1 rounded border border-[#262626] text-[#a3a3a3] hover:bg-[#262626] hover:text-[#e5e5e5] transition-colors"
												>
													Review
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}

			{/* Detail panel */}
			{selected && (
				<div className="rounded-xl border border-[#262626] bg-[#111] p-5 space-y-5">
					<div className="flex items-start justify-between">
						<div>
							<h2 className="text-base font-semibold text-[#e5e5e5]">Approval Detail</h2>
							<p className="text-xs text-[#525252] mt-1 font-mono">{selected.id}</p>
						</div>
						<button
							type="button"
							onClick={() => setSelected(null)}
							className="p-1 rounded hover:bg-[#262626] text-[#737373] hover:text-[#e5e5e5]"
							aria-label="Close detail"
						>
							<XCircle size={16} />
						</button>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="rounded-lg bg-[#1a1a1a] border border-[#262626] p-4 space-y-2">
							<h3 className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wide">Request Info</h3>
							<dl className="space-y-1.5 text-sm">
								<div className="flex justify-between">
									<dt className="text-[#525252]">Tool</dt>
									<dd className="text-[#e5e5e5] font-mono">{selected.toolName}</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-[#525252]">Source</dt>
									<dd className="text-[#a3a3a3]">{selected.source}</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-[#525252]">Actor</dt>
									<dd className="text-[#a3a3a3] truncate max-w-[160px]">{selected.actorId}</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-[#525252]">Project</dt>
									<dd className="text-[#a3a3a3] truncate max-w-[160px]">{selected.projectId}</dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-[#525252]">Risk</dt>
									<dd><RiskBadge level={selected.riskLevel} /></dd>
								</div>
								<div className="flex justify-between">
									<dt className="text-[#525252]">Status</dt>
									<dd><StatusBadge status={selected.status} /></dd>
								</div>
							</dl>
						</div>

						<div className="rounded-lg bg-[#1a1a1a] border border-[#262626] p-4 space-y-2">
							<h3 className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wide">Timing</h3>
							<dl className="space-y-1.5 text-sm">
								<div className="flex justify-between">
									<dt className="text-[#525252]">Created</dt>
									<dd className="text-[#a3a3a3]">{formatTime(selected.createdAt)}</dd>
								</div>
								{selected.expiresAt && (
									<div className="flex justify-between">
										<dt className="text-[#525252]">Expires</dt>
										<dd className="text-yellow-400">{formatTime(selected.expiresAt)}</dd>
									</div>
								)}
							</dl>

							{selected.argsSummary && (
								<div className="mt-3">
									<h4 className="text-xs text-[#525252] mb-1">Args Summary</h4>
									<pre className="text-xs text-[#a3a3a3] bg-[#111] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
										{selected.argsSummary}
									</pre>
								</div>
							)}
						</div>
					</div>

					{/* Rollback preview — P8-D */}
					{selected.checkpointId && (
						<div className="p-3 rounded-lg bg-[#1a1a1a] border border-[#262626]">
							<h4 className="text-sm font-medium text-[#a3a3a3] mb-2">Rollback Preview</h4>
							<p className="text-xs text-[#737373]">Checkpoint: {selected.checkpointId}</p>
							<button
								type="button"
								className="mt-2 px-3 py-1 text-xs rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
							>
								Preview Rollback
							</button>
						</div>
					)}

					{/* Approve / Reject actions */}
					{selected.status === "pending" && (
						<div className="rounded-lg bg-[#1a1a1a] border border-[#262626] p-4 space-y-3">
							<h3 className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wide">Actions</h3>

							{confirmAction === null && (
								<div className="flex gap-3">
									<button
										type="button"
										onClick={() => setConfirmAction("approve")}
										className="px-4 py-2 text-xs rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors font-medium"
									>
										Approve
									</button>
									<button
										type="button"
										onClick={() => setConfirmAction("reject")}
										className="px-4 py-2 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors font-medium"
									>
										Reject
									</button>
								</div>
							)}

							{confirmAction === "approve" && (
								<div className="space-y-2">
									<p className="text-xs text-[#a3a3a3]">
										Confirm approval for <span className="text-[#e5e5e5] font-mono">{selected.toolName}</span>?
									</p>
									<div className="flex gap-2">
										<button
											type="button"
											onClick={() => void handleAction(selected.id, "approve")}
											disabled={actionLoading}
											className="px-3 py-1.5 text-xs rounded bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 disabled:opacity-50 transition-colors"
										>
											{actionLoading ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
											Confirm Approve
										</button>
										<button
											type="button"
											onClick={() => setConfirmAction(null)}
											className="px-3 py-1.5 text-xs rounded border border-[#262626] text-[#737373] hover:bg-[#262626] transition-colors"
										>
											Cancel
										</button>
									</div>
								</div>
							)}

							{confirmAction === "reject" && (
								<div className="space-y-2">
									<p className="text-xs text-[#a3a3a3]">
										Reject <span className="text-[#e5e5e5] font-mono">{selected.toolName}</span>? This action cannot be undone.
									</p>
									<div className="flex gap-2">
										<button
											type="button"
											onClick={() => void handleAction(selected.id, "reject")}
											disabled={actionLoading}
											className="px-3 py-1.5 text-xs rounded bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
										>
											{actionLoading ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
											Confirm Reject
										</button>
										<button
											type="button"
											onClick={() => setConfirmAction(null)}
											className="px-3 py-1.5 text-xs rounded border border-[#262626] text-[#737373] hover:bg-[#262626] transition-colors"
										>
											Cancel
										</button>
									</div>
								</div>
							)}
						</div>
					)}

					{selected.status !== "pending" && (
						<div className="rounded-lg border border-[#262626] bg-[#1a1a1a] px-4 py-3 text-xs text-[#737373]">
							This approval is <span className="text-[#a3a3a3]">{selected.status}</span> and no longer actionable.
						</div>
					)}
				</div>
			)}
		</div>
	);
}
