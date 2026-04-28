import { ShieldAlert } from 'lucide-react';
import TaskCard from '../TaskCard';
import type { Task, ProjectAgent } from '../../lib/studio-api';

interface KanbanColumnProps {
	col: { key: Task['status']; label: string; color: string };
	tasks: Task[];
	agents: ProjectAgent[];
	subTaskMap: Map<string, Task[]>;
	onRetry?: (taskId: string) => void;
	onApprove?: (taskId: string) => void;
	onReject?: (task: Task) => void;
	onTerminal: (task: Task) => void;
	onDetail: (task: Task) => void;
}

export default function KanbanColumn({
	col,
	tasks,
	agents,
	subTaskMap,
	onRetry,
	onApprove,
	onReject,
	onTerminal,
	onDetail,
}: KanbanColumnProps) {
	const isApprovalCol = col.key === 'waiting_approval';

	return (
		<div className="w-[280px] shrink-0 flex flex-col">
			<div className={`flex items-center gap-2 px-3 py-2 mb-3 border-t-2 ${col.color} rounded-t-sm`}>
				{isApprovalCol && <ShieldAlert size={12} className="text-[#f59e0b]" />}
				<span
					className={`text-[12px] font-semibold uppercase ${isApprovalCol ? 'text-[#f59e0b]' : 'text-[#a3a3a3]'}`}
				>
					{col.label}
				</span>
				<span className="text-[11px] text-[#525252] bg-[#1f1f1f] px-1.5 py-0.5 rounded-full">
					{tasks.length}
				</span>
			</div>

			<div className="flex-1 flex flex-col gap-2 overflow-y-auto">
				{tasks.map((task) => {
					const subTasks = subTaskMap.get(task.id) ?? [];
					const doneSubTasks = subTasks.filter((st) => st.status === 'done').length;
					return (
						<div key={task.id} className="relative">
							{task.parentTaskId && (
								<span className="absolute -top-1.5 right-2 z-10 text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30">
									Sub-task
								</span>
							)}
							{subTasks.length > 0 && (
								<span className="absolute -top-1.5 left-2 z-10 text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-[#1f1f1f] text-[#737373] border border-[#262626]">
									{doneSubTasks}/{subTasks.length} sub-tasks
								</span>
							)}
							<TaskCard
								task={task}
								agents={agents}
								onRetry={onRetry ? () => onRetry(task.id) : undefined}
								onApprove={onApprove ? () => onApprove(task.id) : undefined}
								onReject={onReject ? () => onReject(task) : undefined}
								onTerminal={() => onTerminal(task)}
								onClick={() => onDetail(task)}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}
