// ---------------------------------------------------------------------------
// Team List Sidebar
// ---------------------------------------------------------------------------

import { Sparkles, Plus, Trash2 } from 'lucide-react';
import type { TeamTemplate, CustomTeamTemplate } from '../../../lib/studio-api';

interface TeamListProps {
	presetTeams: TeamTemplate[];
	teams: CustomTeamTemplate[];
	selectedId: string | null;
	selectedPresetId: string | null;
	onSelect: (id: string) => void;
	onSelectPreset: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
}

export default function TeamList({ presetTeams, teams, selectedId, selectedPresetId, onSelect, onSelectPreset, onNew, onDelete }: TeamListProps) {
	return (
		<div className="w-[220px] shrink-0 bg-[#0a0a0a] border-r border-[#1f1f1f] flex flex-col">
			<div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-[#1f1f1f]">
				<Sparkles size={11} className="text-[#a78bfa]" />
				<span className="text-[11px] font-semibold text-[#a3a3a3] uppercase">Preset Teams</span>
			</div>
			<div className="overflow-y-auto p-2 space-y-1 max-h-[40%]">
				{presetTeams.length === 0 && (
					<p className="text-[10px] text-[#525252] text-center py-4">No preset teams.</p>
				)}
				{presetTeams.map((t) => (
					<div
						key={t.id}
						onClick={() => onSelectPreset(t.id)}
						className={[
							'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
							selectedPresetId === t.id
								? 'bg-[#1a1626] border border-[#a78bfa]/40'
								: 'hover:bg-[#111111] border border-transparent',
						].join(' ')}
						title={t.description}
					>
						<div className="min-w-0 flex-1">
							<span className="text-[11px] font-medium text-[#e5e5e5] block truncate">{t.name}</span>
							<span className="text-[9px] text-[#525252]">{t.roles.length} roles</span>
						</div>
					</div>
				))}
			</div>

			<div className="flex items-center justify-between px-3 py-2.5 border-t border-b border-[#1f1f1f]">
				<span className="text-[11px] font-semibold text-[#a3a3a3] uppercase">My Teams</span>
				<button
					onClick={onNew}
					className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[#22c55e] bg-[#22c55e]/10 rounded hover:bg-[#22c55e]/20 transition-colors"
				>
					<Plus size={11} /> New
				</button>
			</div>
			<div className="flex-1 overflow-y-auto p-2 space-y-1">
				{teams.length === 0 && (
					<p className="text-[10px] text-[#525252] text-center py-8">
						No custom teams yet. Click a preset above or &quot;New&quot; to create one.
					</p>
				)}
				{teams.map((t) => (
					<div
						key={t.id}
						onClick={() => onSelect(t.id)}
						className={[
							'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors group',
							selectedId === t.id
								? 'bg-[#1f1f1f] border border-[#333]'
								: 'hover:bg-[#111111] border border-transparent',
						].join(' ')}
					>
						<div className="min-w-0 flex-1">
							<span className="text-[11px] font-medium text-[#e5e5e5] block truncate">{t.name}</span>
							<span className="text-[9px] text-[#525252]">{t.roles.length} roles</span>
						</div>
						<button
							onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
							className="opacity-0 group-hover:opacity-100 p-1 text-[#525252] hover:text-[#ef4444] transition-all"
						>
							<Trash2 size={11} />
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
