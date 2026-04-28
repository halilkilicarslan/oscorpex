import { Kanban, GitBranch } from 'lucide-react';
import type { BoardView } from './helpers';

interface BoardViewSwitcherProps {
	boardView: BoardView;
	onChange: (view: BoardView) => void;
}

export default function BoardViewSwitcher({ boardView, onChange }: BoardViewSwitcherProps) {
	return (
		<div className="flex items-center gap-1 px-5 py-2 border-b border-[#1a1a1a] bg-[#0a0a0a] shrink-0">
			<button
				onClick={() => onChange('kanban')}
				className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
					boardView === 'kanban'
						? 'bg-[#1f1f1f] text-[#fafafa]'
						: 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#141414]'
				}`}
			>
				<Kanban size={12} />
				Kanban
			</button>
			<button
				onClick={() => onChange('pipeline')}
				className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
					boardView === 'pipeline'
						? 'bg-[#1f1f1f] text-[#fafafa]'
						: 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#141414]'
				}`}
			>
				<GitBranch size={12} />
				Pipeline
			</button>
		</div>
	);
}
