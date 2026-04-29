import { Zap } from 'lucide-react';
import type { AutoStartStatus } from "../../../lib/studio-api";
import { PIPELINE_STATUS_COLORS, PIPELINE_STATUS_LABELS } from './helpers';

export default function PipelineAutoStartBadge({ status }: { status: AutoStartStatus }) {
	if (!status.planApproved || !status.pipeline) return null;

	const pipelineStatus = status.pipeline.status;
	const colorClass = PIPELINE_STATUS_COLORS[pipelineStatus] ?? 'text-[#525252]';
	const label = PIPELINE_STATUS_LABELS[pipelineStatus] ?? pipelineStatus;

	return (
		<div className="flex items-center gap-2 px-3 py-1.5 mb-4 rounded-lg bg-[#22c55e]/5 border border-[#22c55e]/15 text-[11px]">
			<Zap size={12} className="text-[#22c55e] shrink-0" />
			<span className="text-[#a3a3a3]">Pipeline auto-start:</span>
			<span className={`font-medium ${colorClass}`}>{label}</span>
			{status.pipeline.totalStages > 0 && (
				<span className="text-[#525252] ml-auto">
					Stage {status.pipeline.currentStage + 1} / {status.pipeline.totalStages}
				</span>
			)}
		</div>
	);
}
