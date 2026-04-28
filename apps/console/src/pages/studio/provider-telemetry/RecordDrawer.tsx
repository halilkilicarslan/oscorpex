// ---------------------------------------------------------------------------
// Record Drawer
// ---------------------------------------------------------------------------

import {
	ArrowRightLeft,
	AlertTriangle,
	ShieldAlert,
	X,
	RefreshCw,
} from 'lucide-react';
import type { ProviderExecutionTelemetry } from '../../../lib/studio-api';
import { formatDuration, formatDateTime } from './helpers.js';
import SuccessBadge from './SuccessBadge.js';
import ClassificationBadge from './ClassificationBadge.js';

interface RecordDrawerProps {
	record: ProviderExecutionTelemetry;
	onClose: () => void;
}

export default function RecordDrawer({ record, onClose }: RecordDrawerProps) {
	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
			<div
				className="h-full w-full max-w-lg overflow-y-auto border-l border-[#262626] bg-[#0a0a0a] p-6"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between gap-4 mb-6">
					<div>
						<h2 className="text-[16px] font-semibold text-[#fafafa]">Execution Detail</h2>
						<p className="mt-1 text-[11px] text-[#525252]">{record.runId}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded-lg p-2 text-[#525252] hover:bg-[#1f1f1f] hover:text-[#a3a3a3]"
					>
						<X size={16} />
					</button>
				</div>

				<div className="space-y-5">
					<div className="flex flex-wrap items-center gap-2">
						<SuccessBadge success={record.success} />
						{record.errorClassification && <ClassificationBadge classification={record.errorClassification} />}
						{record.degradedMode && (
							<span className="inline-flex items-center gap-1 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/10 px-2 py-0.5 text-[10px] text-[#f59e0b]">
								<ShieldAlert size={10} />
								degraded
							</span>
						)}
						{record.canceled && (
							<span className="inline-flex items-center gap-1 rounded-full border border-[#ef4444]/20 bg-[#ef4444]/10 px-2 py-0.5 text-[10px] text-[#ef4444]">
								<X size={10} />
								canceled
							</span>
						)}
					</div>

					<div className="grid grid-cols-2 gap-3 text-[12px]">
						<div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
							<div className="text-[#525252]">Task</div>
							<div className="mt-1 text-[#fafafa] truncate">{record.taskId}</div>
						</div>
						<div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
							<div className="text-[#525252]">Latency</div>
							<div className="mt-1 text-[#fafafa]">{formatDuration(record.latencyMs)}</div>
						</div>
						<div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
							<div className="text-[#525252]">Primary</div>
							<div className="mt-1 text-[#fafafa]">{record.primaryProvider}</div>
						</div>
						<div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
							<div className="text-[#525252]">Final</div>
							<div className="mt-1 text-[#fafafa]">{record.finalProvider ?? '—'}</div>
						</div>
						<div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
							<div className="text-[#525252]">Started</div>
							<div className="mt-1 text-[#fafafa]">{formatDateTime(record.startedAt)}</div>
						</div>
						<div className="rounded-xl border border-[#262626] bg-[#111111] p-3">
							<div className="text-[#525252]">Completed</div>
							<div className="mt-1 text-[#fafafa]">{record.completedAt ? formatDateTime(record.completedAt) : '—'}</div>
						</div>
					</div>

					{record.fallbackTimeline.length > 0 && (
						<div className="rounded-2xl border border-[#262626] bg-[#111111]">
							<div className="flex items-center gap-2 border-b border-[#262626] px-4 py-3">
								<ArrowRightLeft size={14} className="text-[#22c55e]" />
								<span className="text-[12px] font-medium text-[#fafafa]">Fallback Timeline</span>
								<span className="ml-auto text-[10px] text-[#525252]">{record.fallbackCount} hop(s)</span>
							</div>
							<div className="divide-y divide-[#1f1f1f]">
								{record.fallbackTimeline.map((entry, index) => (
									<div key={index} className="px-4 py-3">
										<div className="flex items-center justify-between gap-2 text-[12px]">
											<div className="flex items-center gap-1.5">
												<span className="text-[#525252]">{entry.fromProvider}</span>
												<ArrowRightLeft size={10} className="text-[#333]" />
												<span className="text-[#fafafa]">{entry.toProvider}</span>
											</div>
											<span className="text-[10px] text-[#525252]">{formatDuration(entry.latencyMs)}</span>
										</div>
										<div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
											<span className="text-[#737373]">{entry.reason}</span>
											<ClassificationBadge classification={entry.errorClassification} />
										</div>
										<div className="mt-1 text-[10px] text-[#525252]">{formatDateTime(entry.timestamp)}</div>
									</div>
								))}
								</div>
							</div>
						)}

						{record.errorMessage && (
							<div className="rounded-2xl border border-[#ef4444]/20 bg-[#ef4444]/5 p-4">
								<div className="flex items-center gap-2 text-[12px] font-medium text-[#ef4444]">
									<AlertTriangle size={14} />
									Error
								</div>
								<pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-[#ef4444]/80 font-mono leading-relaxed">
									{record.errorMessage}
								</pre>
							</div>
						)}

						{record.degradedMessage && (
							<div className="rounded-2xl border border-[#f59e0b]/20 bg-[#f59e0b]/5 p-4">
								<div className="flex items-center gap-2 text-[12px] font-medium text-[#f59e0b]">
									<ShieldAlert size={14} />
									Degraded
								</div>
								<p className="mt-2 text-[11px] text-[#f59e0b]/80">{record.degradedMessage}</p>
							</div>
						)}

						{record.cancelReason && (
							<div className="rounded-2xl border border-[#ef4444]/20 bg-[#ef4444]/5 p-4">
								<div className="flex items-center gap-2 text-[12px] font-medium text-[#ef4444]">
									<X size={14} />
									Canceled
								</div>
								<p className="mt-2 text-[11px] text-[#ef4444]/80">{record.cancelReason}</p>
							</div>
						)}

						{record.retryReason && (
							<div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
								<div className="flex items-center gap-2 text-[12px] font-medium text-[#fafafa]">
									<RefreshCw size={14} />
									Retry Reason
								</div>
								<p className="mt-2 text-[11px] text-[#737373]">{record.retryReason}</p>
							</div>
						)}
					</div>
			</div>
		</div>
	);
}
