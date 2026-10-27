import { useEffect, useState } from "react";

interface PruningCandidate {
	memoryId: string;
	reason: string;
	confidence: number;
	recommendedAction: string;
	severity: "high" | "medium" | "low";
}

interface SchedulerJobsResponse {
	enabled: boolean;
	jobs: Array<{ id: string; name: string; enabled: boolean }>;
}

function SeverityBadge({ severity }: { severity: PruningCandidate["severity"] }) {
	const classes: Record<PruningCandidate["severity"], string> = {
		high: "bg-red-500/10 text-red-400",
		medium: "bg-amber-500/10 text-amber-400",
		low: "bg-[#262626] text-[#737373]",
	};
	return (
		<span className={`text-xs px-2 py-0.5 rounded font-medium ${classes[severity]}`}>
			{severity}
		</span>
	);
}

function ConfidenceBar({ value }: { value: number }) {
	const pct = Math.round(value * 100);
	const color = pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-amber-500" : "bg-[#22c55e]";
	return (
		<div className="flex items-center gap-2">
			<div className="w-16 h-1.5 bg-[#262626] rounded-full overflow-hidden">
				<div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
			</div>
			<span className="text-xs text-[#525252]">{pct}%</span>
		</div>
	);
}

export default function MemoryPruningPage() {
	const [candidates, setCandidates] = useState<PruningCandidate[]>([]);
	const [schedulerEnabled, setSchedulerEnabled] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch("/api/studio/scheduler/jobs")
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<SchedulerJobsResponse>;
			})
			.then((data) => {
				setSchedulerEnabled(data.enabled);
				// Pruning candidates come from scheduler output in real impl.
				// Currently the memory-pruning job surfaces proposals via job results.
				// Placeholder: empty until a dedicated pruning endpoint is wired.
				setCandidates([]);
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : "Failed to load data");
			})
			.finally(() => setLoading(false));
	}, []);

	return (
		<div className="min-h-screen bg-[#0a0a0a] p-6">
			{/* Header */}
			<div className="mb-6">
				<h1 className="text-xl font-semibold text-[#e5e5e5] mb-1">Memory Pruning Proposals</h1>
				<p className="text-sm text-[#737373]">
					Read-only proposals — no automatic deletion. Review and approve individually.
				</p>
			</div>

			{/* Scheduler status badge */}
			{schedulerEnabled !== null && (
				<div className="mb-4 flex items-center gap-2">
					<span className="text-xs text-[#525252]">Scheduler:</span>
					<span
						className={`text-xs px-2 py-0.5 rounded font-medium ${
							schedulerEnabled
								? "bg-[#22c55e]/10 text-[#22c55e]"
								: "bg-[#262626] text-[#737373]"
						}`}
					>
						{schedulerEnabled ? "enabled" : "disabled"}
					</span>
				</div>
			)}

			{/* Content area */}
			{loading ? (
				<div className="flex items-center gap-2 text-[#525252]">
					<div className="w-4 h-4 rounded-full border border-[#262626] border-t-[#22c55e] animate-spin" />
					<span className="text-sm">Loading proposals...</span>
				</div>
			) : error ? (
				<div className="p-4 border border-red-500/20 rounded-lg bg-red-500/5 text-sm text-red-400">
					{error}
				</div>
			) : candidates.length === 0 ? (
				<div className="text-[#525252] p-10 text-center border border-[#262626] rounded-lg">
					<div className="text-4xl mb-3 opacity-30">✓</div>
					<div className="text-sm font-medium text-[#737373]">No pruning proposals at this time.</div>
					<div className="text-xs text-[#525252] mt-1">
						Memory pruning runs automatically via the scheduler. Check back after the next cycle.
					</div>
				</div>
			) : (
				<div className="space-y-2">
					{candidates.map((c) => (
						<div
							key={c.memoryId}
							className="p-4 border border-[#262626] rounded-lg bg-[#111111] hover:border-[#363636] transition-colors"
						>
							<div className="flex items-start gap-3">
								<SeverityBadge severity={c.severity} />
								<div className="flex-1 min-w-0">
									<div className="text-sm text-[#e5e5e5] mb-1">{c.reason}</div>
									<div className="flex items-center gap-4">
										<span className="text-xs text-[#525252]">
											Action:{" "}
											<span className="text-[#737373]">{c.recommendedAction}</span>
										</span>
										<ConfidenceBar value={c.confidence} />
									</div>
								</div>
								<span className="text-xs text-[#525252] font-mono shrink-0">
									{c.memoryId.slice(0, 8)}
								</span>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
