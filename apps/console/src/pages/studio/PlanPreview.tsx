import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { ProjectPlan, PlanCostEstimate } from '../../lib/studio-api';
import { fetchPlanCostEstimate } from '../../lib/studio-api';
import PhaseSection from './phase-section.js';
import CostEstimatePanel from './cost-estimate-panel.js';
import PlanActions from './plan-actions.js';

export default function PlanPreview({
	plan,
	projectId,
	onApprove,
	onReject,
}: {
	plan: ProjectPlan;
	projectId: string;
	onApprove: () => void;
	onReject: (feedback?: string) => void;
}) {
	const [costEstimate, setCostEstimate] = useState<PlanCostEstimate | null>(null);
	const [costLoading, setCostLoading] = useState(false);

	const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
	const isDraft = plan.status === 'draft';

	// Fetch cost estimate when showing a draft plan
	useEffect(() => {
		if (!isDraft) {
			setCostEstimate(null);
			return;
		}

		let cancelled = false;
		setCostLoading(true);
		fetchPlanCostEstimate(projectId, plan.id)
			.then((estimate) => {
				if (!cancelled) setCostEstimate(estimate);
			})
			.catch(() => {
				// Non-critical — silently skip if the estimate fails
			})
			.finally(() => {
				if (!cancelled) setCostLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [projectId, plan.id, isDraft]);

	return (
		<div className="border border-[#262626] rounded-2xl bg-[#111111] overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between px-5 py-4 border-b border-[#262626]">
				<div>
					<h3 className="text-[14px] font-semibold text-[#fafafa]">Project Plan v{plan.version}</h3>
					<span className="text-[11px] text-[#525252]">
						{plan.phases.length} phases &middot; {totalTasks} tasks
					</span>
				</div>
				<span
					className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
						plan.status === 'approved'
							? 'bg-[#22c55e]/10 text-[#22c55e]'
							: plan.status === 'rejected'
								? 'bg-[#ef4444]/10 text-[#ef4444]'
								: 'bg-[#f59e0b]/10 text-[#f59e0b]'
					}`}
				>
					{plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
				</span>
			</div>

			{/* Phases */}
			<div className="p-4 flex flex-col gap-3">
				{plan.phases
					.sort((a, b) => a.order - b.order)
					.map((phase, i) => (
						<PhaseSection key={phase.id} phase={phase} index={i} />
					))}
			</div>

			{/* Cost estimate — shown only for draft plans, above the action buttons */}
			{isDraft && (
				<div className="px-4 pb-4">
					{costLoading && (
						<div className="flex items-center gap-2 px-4 py-3 border border-[#262626] rounded-xl bg-[#0a0a0a]">
							<Loader2 size={12} className="text-[#525252] animate-spin shrink-0" />
							<span className="text-[11px] text-[#525252]">Calculating cost estimate...</span>
						</div>
					)}
					{!costLoading && costEstimate && (
						<CostEstimatePanel plan={plan} estimate={costEstimate} />
					)}
				</div>
			)}

			{/* Actions */}
			{isDraft && <PlanActions onApprove={onApprove} onReject={onReject} />}
		</div>
	);
}
