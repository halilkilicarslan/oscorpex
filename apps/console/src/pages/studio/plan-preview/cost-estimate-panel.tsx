import { useState } from 'react';
import { DollarSign, ChevronUp, ChevronDown, GitBranch, Users, Cpu } from 'lucide-react';
import type { ProjectPlan, PlanCostEstimate } from "../../../lib/studio-api";
import {
	getCostColor,
	getCostBgColor,
	formatTokens,
	buildPhaseBreakdown,
	buildAgentBreakdown,
} from './cost-helpers.js';

export default function CostEstimatePanel({ plan, estimate }: { plan: ProjectPlan; estimate: PlanCostEstimate }) {
	const [showBreakdown, setShowBreakdown] = useState(false);
	const [activeTab, setActiveTab] = useState<'phase' | 'agent'>('phase');

	if (!estimate || estimate.estimatedCost == null) return null;

	const costColor = getCostColor(estimate.estimatedCost);
	const costBg = getCostBgColor(estimate.estimatedCost);
	const isHighCost = estimate.estimatedCost >= 1.0;

	const phaseRows = buildPhaseBreakdown(plan, estimate);
	const agentRows = buildAgentBreakdown(plan, estimate);

	return (
		<div className={`border rounded-xl overflow-hidden ${costBg}`}>
			{/* Summary row */}
			<button
				onClick={() => setShowBreakdown(!showBreakdown)}
				className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
			>
				<DollarSign size={14} style={{ color: costColor }} className="shrink-0" />

				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-2 flex-wrap">
						<span className="text-[13px] font-semibold" style={{ color: costColor }}>
							~${estimate.estimatedCost.toFixed(4)} {estimate.currency}
						</span>
						{isHighCost && (
							<span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#ef4444]/20 text-[#ef4444]">
								HIGH COST
							</span>
						)}
					</div>
					<span className="text-[11px] text-[#525252]">
						{formatTokens(estimate.estimatedTokens)} tokens &middot; {estimate.taskCount} tasks &middot;{' '}
						{estimate.model}
					</span>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					<span className="text-[10px] text-[#525252]">breakdown</span>
					{showBreakdown ? (
						<ChevronUp size={13} className="text-[#525252]" />
					) : (
						<ChevronDown size={13} className="text-[#525252]" />
					)}
				</div>
			</button>

			{/* Token input/output mini-bar */}
			<div className="px-4 pb-3 flex items-center gap-3">
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-[#525252]">Input</span>
					<span className="text-[10px] font-medium text-[#a3a3a3]">
						{formatTokens(estimate.breakdown.inputTokens)} tok
					</span>
					<span className="text-[10px] text-[#525252]">·</span>
					<span className="text-[10px] text-[#525252]">${(estimate.breakdown?.inputCost ?? 0).toFixed(4)}</span>
				</div>
				<div className="w-px h-3 bg-[#262626]" />
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-[#525252]">Output</span>
					<span className="text-[10px] font-medium text-[#a3a3a3]">
						{formatTokens(estimate.breakdown.outputTokens)} tok
					</span>
					<span className="text-[10px] text-[#525252]">·</span>
					<span className="text-[10px] text-[#525252]">${(estimate.breakdown?.outputCost ?? 0).toFixed(4)}</span>
				</div>
			</div>

			{/* Collapsible breakdown */}
			{showBreakdown && (
				<div className="border-t border-[#262626]/50 bg-[#0a0a0a]/60">
					{/* Tab bar */}
					<div className="flex border-b border-[#262626]/50">
						<button
							onClick={() => setActiveTab('phase')}
							className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium transition-colors ${
								activeTab === 'phase'
									? 'text-[#e5e5e5] border-b-2 border-[#525252] -mb-px'
									: 'text-[#525252] hover:text-[#a3a3a3]'
							}`}
						>
							<GitBranch size={11} />
							By Phase
						</button>
						<button
							onClick={() => setActiveTab('agent')}
							className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium transition-colors ${
								activeTab === 'agent'
									? 'text-[#e5e5e5] border-b-2 border-[#525252] -mb-px'
									: 'text-[#525252] hover:text-[#a3a3a3]'
							}`}
						>
							<Users size={11} />
							By Agent
						</button>
					</div>

					{/* Phase breakdown table */}
					{activeTab === 'phase' && (
						<div className="p-3 flex flex-col gap-1.5">
							{phaseRows.map((row, i) => (
								<div
									key={i}
									className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#141414] border border-[#1f1f1f]"
								>
									<span className="text-[10px] font-bold text-[#525252] shrink-0 w-14">
										Phase {i + 1}
									</span>
									<span className="text-[11px] text-[#a3a3a3] flex-1 truncate">{row.name}</span>
									<div className="flex items-center gap-3 shrink-0">
										<span className="text-[10px] text-[#525252]">{row.taskCount}t</span>
										<span className="text-[10px] text-[#525252]">{formatTokens(row.tokens)} tok</span>
										<span
											className="text-[10px] font-semibold"
											style={{ color: getCostColor(row.cost) }}
										>
											${(row.cost ?? 0).toFixed(4)}
										</span>
									</div>
								</div>
							))}
						</div>
					)}

					{/* Agent breakdown table */}
					{activeTab === 'agent' && (
						<div className="p-3 flex flex-col gap-1.5">
							{agentRows.map((row, i) => (
								<div
									key={i}
									className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#141414] border border-[#1f1f1f]"
								>
									<Cpu size={11} className="text-[#525252] shrink-0" />
									<span className="text-[11px] text-[#a3a3a3] flex-1 truncate capitalize">{row.agent}</span>
									<div className="flex items-center gap-3 shrink-0">
										<span className="text-[10px] text-[#525252]">{row.taskCount}t</span>
										<span className="text-[10px] text-[#525252]">{formatTokens(row.tokens)} tok</span>
										<span
											className="text-[10px] font-semibold"
											style={{ color: getCostColor(row.cost) }}
										>
											${(row.cost ?? 0).toFixed(4)}
										</span>
									</div>
								</div>
							))}
						</div>
					)}

					<div className="px-4 pb-3">
						<p className="text-[10px] text-[#404040]">
							Estimates based on ~{formatTokens(estimate.avgTokensPerTask)} avg tokens/task using{' '}
							{estimate.model}. Actual costs may vary.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
