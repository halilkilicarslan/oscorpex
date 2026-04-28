import { useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import type { Phase } from '../../lib/studio-api';
import TaskRow from './task-row.js';

export default function PhaseSection({ phase, index }: { phase: Phase; index: number }) {
	const [expanded, setExpanded] = useState(true);

	return (
		<div className="border border-[#262626] rounded-xl overflow-hidden">
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-4 py-3 bg-[#111111] hover:bg-[#161616] transition-colors text-left"
			>
				{expanded ? (
					<ChevronDown size={14} className="text-[#525252]" />
				) : (
					<ChevronRight size={14} className="text-[#525252]" />
				)}
				<span className="text-[11px] font-bold text-[#525252] shrink-0">PHASE {index + 1}</span>
				<span className="text-[13px] font-medium text-[#e5e5e5] flex-1 truncate">{phase.name}</span>
				<span className="text-[11px] text-[#525252]">{phase.tasks.length} tasks</span>
			</button>

			{expanded && (
				<div className="p-3 flex flex-col gap-2 bg-[#0d0d0d]">
					{phase.tasks.map((task) => (
						<TaskRow key={task.id} task={task} />
					))}
					{phase.dependsOn.length > 0 && (
						<div className="flex items-center gap-1.5 px-3 pt-1">
							<GitBranch size={11} className="text-[#525252]" />
							<span className="text-[10px] text-[#525252]">
								Depends on: Phase {phase.dependsOn.map((_, i) => i + 1).join(', ')}
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
