// ---------------------------------------------------------------------------
// Role Palette
// ---------------------------------------------------------------------------

import { ChevronRight, ChevronLeft } from 'lucide-react';
import { roleLabel, type AgentConfig } from '../../../lib/studio-api';
import AgentAvatarImg from '../../../components/AgentAvatar';
import { COLOR_MAP } from './constants.js';

interface RolePaletteProps {
	presets: AgentConfig[];
	placedRoles: Set<string>;
	collapsed: boolean;
	onToggle: () => void;
	onAgentClick?: (agent: AgentConfig) => void;
}

export default function RolePalette({ presets, placedRoles, collapsed, onToggle, onAgentClick }: RolePaletteProps) {
	const available = presets.filter((p) => !placedRoles.has(p.role));

	const onDragStart = (event: React.DragEvent, role: string) => {
		event.dataTransfer.setData('application/team-builder-role', role);
		event.dataTransfer.effectAllowed = 'move';
	};

	if (collapsed) {
		return (
			<button
				onClick={onToggle}
				className="flex items-center justify-center w-8 bg-[#0a0a0a] border-r border-[#1f1f1f] hover:bg-[#111111] transition-colors"
			>
				<ChevronRight size={14} className="text-[#525252]" />
			</button>
		);
	}

	return (
		<div className="w-[180px] shrink-0 bg-[#0a0a0a] border-r border-[#1f1f1f] flex flex-col">
			<div className="flex items-center justify-between px-3 py-2 border-b border-[#1f1f1f]">
				<span className="text-[11px] font-semibold text-[#a3a3a3] uppercase">Roles</span>
				<button onClick={onToggle} className="text-[#525252] hover:text-[#a3a3a3]">
					<ChevronLeft size={14} />
				</button>
			</div>
			<div className="flex-1 overflow-y-auto p-2 space-y-1">
				{available.length === 0 && (
					<p className="text-[10px] text-[#525252] text-center py-4">All roles placed</p>
				)}
				{available.map((preset) => {
					const color = COLOR_MAP[preset.role] ?? '#525252';
					return (
						<div
							key={preset.role}
							draggable
							onDragStart={(e) => onDragStart(e, preset.role)}
							onClick={() => onAgentClick?.(preset)}
							className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#111111] border border-[#1f1f1f] cursor-grab active:cursor-grabbing hover:border-[#333] transition-colors"
						>
							<AgentAvatarImg avatar={preset.avatar} name={preset.name} size="xs" />
							<div className="min-w-0 flex-1">
								<span className="text-[10px] font-medium text-[#e5e5e5] block truncate">{preset.name}</span>
								<span className="text-[9px] block truncate" style={{ color }}>{roleLabel(preset.role)}</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
