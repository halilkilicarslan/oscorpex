import { ListChecks } from 'lucide-react';
import { roleLabel, type Task } from "../../../lib/studio-api";
import AgentAvatarImg from '../../../components/AgentAvatar';

const complexityColor: Record<string, string> = {
	S: 'text-[#22c55e] bg-[#22c55e]/10',
	M: 'text-[#f59e0b] bg-[#f59e0b]/10',
	L: 'text-[#ef4444] bg-[#ef4444]/10',
};

export default function TaskRow({
	task,
	agentMetaById,
}: {
	task: Task;
	agentMetaById: Map<string, { name: string; avatar: string; role: string }>;
}) {
	const agentMeta = (task.assignedAgentId ? agentMetaById.get(task.assignedAgentId) : undefined) ?? agentMetaById.get(task.assignedAgent);
	const resolvedAgentName = agentMeta?.name ?? task.assignedAgent;
	const resolvedAgentAvatar = agentMeta?.avatar ?? resolvedAgentName.charAt(0).toUpperCase();
	const resolvedAgentRole = agentMeta?.role ? roleLabel(agentMeta.role) : '';
	const startedAtLabel = task.startedAt ? new Date(task.startedAt).toLocaleString('tr-TR') : 'Henuz baslamadi';
	const durationLabel =
		task.startedAt && task.completedAt
			? formatDuration(new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime())
			: task.startedAt
				? 'Devam ediyor'
				: '-';

	return (
		<div className="flex items-start gap-3 px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
			<ListChecks size={14} className="text-[#525252] shrink-0 mt-0.5" />
			<div className="flex-1 min-w-0">
				<span className="text-[12px] text-[#e5e5e5] block whitespace-normal break-words">{task.title}</span>
				{task.description && (
					<span className="text-[11px] text-[#525252] block whitespace-normal break-words mt-0.5">{task.description}</span>
				)}
				<div className="mt-1 text-[10px] text-[#525252] flex items-center gap-3">
					<span>Baslangic: {startedAtLabel}</span>
					<span>Sure: {durationLabel}</span>
				</div>
			</div>
			<div className="flex items-center gap-2 shrink-0 ml-2">
				<span
					className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${complexityColor[task.complexity] ?? 'text-[#525252]'}`}
				>
					{task.complexity}
				</span>
				<div className="flex items-center gap-1.5">
					<AgentAvatarImg avatar={resolvedAgentAvatar} name={resolvedAgentName} size="xs" />
					<div className="max-w-[170px] min-w-0 leading-tight">
						<div className="text-[10px] text-[#737373] whitespace-normal break-words">{resolvedAgentName}</div>
						<div className="text-[9px] text-[#525252] whitespace-normal break-words">
							{resolvedAgentRole || 'Rol bilinmiyor'}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return '-';
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}s ${minutes}d ${seconds}sn`;
	if (minutes > 0) return `${minutes}d ${seconds}sn`;
	return `${seconds}sn`;
}
