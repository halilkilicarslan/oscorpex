import { DollarSign } from 'lucide-react';
import AgentAvatarImg from '../../../components/AgentAvatar';
import { roleLabel } from '../../../lib/studio-api';
import type { CostBreakdownEntry, ProjectCostSummary } from '../../../lib/studio-api';

interface CostBreakdownPanelProps {
	entries: CostBreakdownEntry[];
	costs: ProjectCostSummary | null;
}

export default function CostBreakdownPanel({ entries, costs }: CostBreakdownPanelProps) {
	if (entries.length === 0) return null;

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<DollarSign size={14} className="text-[#10b981]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Cost Breakdown</h3>
				<span className="ml-auto text-[10px] text-[#525252]">
					Total: ${costs?.totalCostUsd?.toFixed(4) ?? '0'}
				</span>
			</div>
			<div className="flex items-center gap-3 px-4 py-2 bg-[#0d0d0d]">
				<span className="text-[10px] text-[#525252] uppercase tracking-wider w-48 shrink-0">Agent</span>
				<span className="text-[10px] text-[#525252] uppercase tracking-wider w-28 shrink-0">Model</span>
				<span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Tasks</span>
				<span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Input</span>
				<span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Output</span>
				<span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Total</span>
				<span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Cost</span>
			</div>
			{entries.map((entry, i) => (
				<div
					key={`${entry.agentId}-${entry.model}-${i}`}
					className="flex items-center gap-3 px-4 py-2.5 border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors"
				>
					<div className="flex items-center gap-2 w-48 shrink-0">
						<AgentAvatarImg avatar={entry.agentAvatar ?? ''} name={entry.agentName ?? '?'} size="xs" />
						<div className="min-w-0">
							<p className="text-[11px] text-[#a3a3a3] font-medium truncate">
								{entry.agentName ?? entry.agentId.slice(0, 8)}
							</p>
							{entry.agentRole && (
								<p className="text-[9px] text-[#525252] truncate">{roleLabel(entry.agentRole)}</p>
							)}
						</div>
					</div>
					<span className="text-[11px] text-[#525252] w-28 truncate shrink-0 font-mono">{entry.model}</span>
					<span className="text-[11px] text-[#a3a3a3] w-14 text-center">{entry.taskCount}</span>
					<span className="text-[11px] text-[#525252] w-20 text-right font-mono">{(entry.inputTokens / 1000).toFixed(1)}K</span>
					<span className="text-[11px] text-[#525252] w-20 text-right font-mono">{(entry.outputTokens / 1000).toFixed(1)}K</span>
					<span className="text-[11px] text-[#a3a3a3] w-20 text-right font-mono">{(entry.totalTokens / 1000).toFixed(1)}K</span>
					<span className="text-[11px] text-[#10b981] w-20 text-right font-mono font-semibold">${entry.costUsd.toFixed(4)}</span>
				</div>
			))}
		</div>
	);
}
