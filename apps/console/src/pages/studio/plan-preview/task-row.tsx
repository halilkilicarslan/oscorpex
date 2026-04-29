import { ListChecks } from 'lucide-react';
import type { Task } from "../../../lib/studio-api";

const complexityColor: Record<string, string> = {
	S: 'text-[#22c55e] bg-[#22c55e]/10',
	M: 'text-[#f59e0b] bg-[#f59e0b]/10',
	L: 'text-[#ef4444] bg-[#ef4444]/10',
};

export default function TaskRow({ task }: { task: Task }) {
	return (
		<div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
			<ListChecks size={14} className="text-[#525252] shrink-0" />
			<div className="flex-1 min-w-0">
				<span className="text-[12px] text-[#e5e5e5] block truncate">{task.title}</span>
				{task.description && (
					<span className="text-[11px] text-[#525252] block truncate">{task.description}</span>
				)}
			</div>
			<span
				className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${complexityColor[task.complexity] ?? 'text-[#525252]'}`}
			>
				{task.complexity}
			</span>
			<span className="text-[10px] text-[#525252] shrink-0">{task.assignedAgent}</span>
		</div>
	);
}
