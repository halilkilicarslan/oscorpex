import type { ProjectAnalytics, AgentAnalytics } from '../../../lib/studio-api';
import { formatDuration, scoreColor } from './helpers';

interface MetricCardsProps {
	overview: ProjectAnalytics | null;
	agents: AgentAnalytics[];
}

export default function MetricCards({ overview, agents }: MetricCardsProps) {
	if (overview?.avgCompletionTimeMs === null && (overview?.pipelineRunCount ?? 0) === 0) return null;

	const scored = agents.filter((a) => a.tasksAssigned > 0);
	const avgScore =
		scored.length > 0
			? Math.round(scored.reduce((s, a) => s + (a.score ?? 0), 0) / scored.length)
			: 0;

	return (
		<div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
				<span className="text-[10px] text-[#525252] uppercase tracking-wider">Avg Completion</span>
				<span className="text-[18px] font-bold text-[#fafafa]">
					{formatDuration(overview?.avgCompletionTimeMs ?? null)}
				</span>
				<span className="text-[10px] text-[#525252]">Per task</span>
			</div>
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
				<span className="text-[10px] text-[#525252] uppercase tracking-wider">Total Failures</span>
				<span className="text-[18px] font-bold text-[#ef4444]">{overview?.totalFailures ?? 0}</span>
				<span className="text-[10px] text-[#525252]">Including retries</span>
			</div>
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
				<span className="text-[10px] text-[#525252] uppercase tracking-wider">Blocked Tasks</span>
				<span className="text-[18px] font-bold text-[#ef4444]">{overview?.blockedTasks ?? 0}</span>
				<span className="text-[10px] text-[#525252]">Needs attention</span>
			</div>
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
				<span className="text-[10px] text-[#525252] uppercase tracking-wider">Review Rejects</span>
				<span className="text-[18px] font-bold text-[#f97316]">{overview?.totalReviewRejections ?? 0}</span>
				<span className="text-[10px] text-[#525252]">Code rejected</span>
			</div>
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
				<span className="text-[10px] text-[#525252] uppercase tracking-wider">Pipeline Success</span>
				<span className="text-[18px] font-bold text-[#a855f7]">{overview?.pipelineSuccessRate ?? 0}%</span>
				<span className="text-[10px] text-[#525252]">{overview?.pipelineRunCount ?? 0} runs</span>
			</div>
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
				<span className="text-[10px] text-[#525252] uppercase tracking-wider">In Progress</span>
				<span className="text-[18px] font-bold text-[#f59e0b]">{overview?.inProgressTasks ?? 0}</span>
				<span className="text-[10px] text-[#525252]">Tasks running</span>
			</div>
			{agents.length > 0 && (
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
					<span className="text-[10px] text-[#525252] uppercase tracking-wider">Team Score</span>
					<span className="text-[18px] font-bold" style={{ color: scoreColor(avgScore) }}>
						{avgScore}
					</span>
					<span className="text-[10px] text-[#525252]">{scored.length} agents avg</span>
				</div>
			)}
		</div>
	);
}
