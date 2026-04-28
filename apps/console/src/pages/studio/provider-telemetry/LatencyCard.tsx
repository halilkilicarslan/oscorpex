// ---------------------------------------------------------------------------
// Latency Card
// ---------------------------------------------------------------------------

import { Zap, AlertTriangle } from 'lucide-react';
import type { ProviderLatencySnapshot } from '../../../lib/studio-api';
import { formatDuration, formatDateTime } from './helpers.js';
import ClassificationBadge from './ClassificationBadge.js';

interface LatencyCardProps {
	snapshot: ProviderLatencySnapshot;
}

export default function LatencyCard({ snapshot }: LatencyCardProps) {
	const successRate = snapshot.totalExecutions > 0
		? Math.round((snapshot.successfulExecutions / snapshot.totalExecutions) * 100)
		: 0;

	return (
		<div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2.5">
					<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f1f1f] text-[#22c55e]">
						<Zap size={16} />
					</div>
					<div>
						<div className="text-[13px] font-semibold text-[#fafafa]">{snapshot.providerId}</div>
						<div className="text-[10px] text-[#525252]">{snapshot.totalExecutions} runs</div>
					</div>
				</div>
				<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${successRate >= 90 ? 'border-[#22c55e]/20 text-[#22c55e] bg-[#22c55e]/10' : successRate >= 70 ? 'border-[#f59e0b]/20 text-[#f59e0b] bg-[#f59e0b]/10' : 'border-[#ef4444]/20 text-[#ef4444] bg-[#ef4444]/10'}`}>
					{successRate}% success
				</span>
			</div>

			<div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">Avg latency</div>
					<div className="text-[#fafafa] font-medium">{formatDuration(snapshot.averageLatencyMs)}</div>
				</div>
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">P95 latency</div>
					<div className="text-[#fafafa] font-medium">{formatDuration(snapshot.p95LatencyMs)}</div>
				</div>
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">Successful</div>
					<div className="text-[#22c55e]">{snapshot.successfulExecutions}</div>
				</div>
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">Failed</div>
					<div className="text-[#ef4444]">{snapshot.failedExecutions}</div>
				</div>
			</div>

			{snapshot.lastFailureAt && (
				<div className="mt-3 flex items-center gap-2 text-[10px] text-[#525252]">
					<AlertTriangle size={10} className="text-[#f59e0b]" />
					Last failure: {formatDateTime(snapshot.lastFailureAt)}
					{snapshot.lastFailureClassification && (
						<ClassificationBadge classification={snapshot.lastFailureClassification} />
					)}
				</div>
			)}
		</div>
	);
}
