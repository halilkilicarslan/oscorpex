import { Loader2, ChevronDown } from 'lucide-react';
import type { AgentRunHistory } from '../../lib/studio-api';
import RunStatusBadge from './run-status-badge.js';
import { relativeTime } from './helpers.js';

interface HistoryPanelProps {
	show: boolean;
	loading: boolean;
	history: AgentRunHistory[];
	ref: React.RefObject<HTMLDivElement | null>;
	onClose: () => void;
}

export default function HistoryPanel({ show, loading, history, ref, onClose }: HistoryPanelProps) {
	if (!show) return null;

	return (
		<div
			className="absolute right-0 top-full mt-1 w-64 bg-[#111111] border border-[#262626] rounded-lg shadow-xl z-50 overflow-hidden"
			ref={ref}
		>
			<div className="px-3 py-2 border-b border-[#262626]">
				<span className="text-[10px] font-semibold text-[#525252] uppercase tracking-wide">
					Son Çalıştırmalar
				</span>
			</div>

			{loading ? (
				<div className="flex items-center justify-center py-4">
					<Loader2 size={14} className="text-[#525252] animate-spin" />
				</div>
			) : history.length === 0 ? (
				<div className="px-3 py-3 text-[11px] text-[#525252] text-center">No run history yet</div>
			) : (
				<ul className="divide-y divide-[#1f1f1f]">
					{history.map((run) => (
						<li key={run.id} className="px-3 py-2">
							<div className="flex items-center justify-between mb-0.5">
								<RunStatusBadge status={run.status} />
								<span className="text-[9px] text-[#525252] font-mono">
									{relativeTime(run.startedAt ?? run.createdAt)}
								</span>
							</div>
							{run.taskPrompt && (
								<p className="text-[10px] text-[#737373] truncate" title={run.taskPrompt}>
									{run.taskPrompt}
								</p>
							)}
							<div className="flex items-center gap-2 mt-0.5">
								{run.pid && (
									<span className="text-[9px] font-mono text-[#525252]">PID {run.pid}</span>
								)}
								{run.exitCode !== null && run.exitCode !== undefined && (
									<span
										className={`text-[9px] font-mono ${
											run.exitCode === 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
										}`}
									>
										exit: {run.exitCode}
									</span>
								)}
							</div>
						</li>
					))}
				</ul>
			)}

			<div className="border-t border-[#262626]">
				<button
					onClick={onClose}
					className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
				>
					<ChevronDown size={11} />
					Close
				</button>
			</div>
		</div>
	);
}
