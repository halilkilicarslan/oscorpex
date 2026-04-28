import { Trash2, ArrowRight } from 'lucide-react';
import { COLUMNS, PRIORITY_COLORS, TYPE_ICONS } from './helpers';
import type { WorkItem, WorkItemStatus, SprintOption } from './helpers';

interface WorkItemCardProps {
	item: WorkItem;
	sprints: SprintOption[];
	onConvert: (id: string) => void;
	onAssignSprint: (id: string, sprintId: string | null) => void;
	onStatusChange: (id: string, status: WorkItemStatus) => void;
	onDelete: (id: string) => void;
}

export default function WorkItemCard({
	item,
	sprints,
	onConvert,
	onAssignSprint,
	onStatusChange,
	onDelete,
}: WorkItemCardProps) {
	return (
		<div className="bg-[#111111] border border-[#262626] rounded-lg p-3 hover:border-[#333] transition-colors group">
			<div className="flex items-start gap-2 mb-2">
				<span className="mt-0.5 shrink-0">{TYPE_ICONS[item.type]}</span>
				<p className="text-[12px] text-[#e5e5e5] leading-snug flex-1">{item.title}</p>
				<button
					type="button"
					onClick={() => onDelete(item.id)}
					className="opacity-0 group-hover:opacity-100 text-[#525252] hover:text-[#f87171] transition-all shrink-0 mt-0.5"
					title="Sil"
				>
					<Trash2 size={11} />
				</button>
			</div>

			<div className="flex items-center gap-2 flex-wrap">
				<span
					className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[item.priority]}`}
				>
					{item.priority}
				</span>
				{item.labels?.map((label) => (
					<span
						key={label}
						className="text-[10px] text-[#525252] bg-[#1a1a1a] border border-[#262626] px-1.5 py-0.5 rounded"
					>
						{label}
					</span>
				))}
				{item.source && <span className="text-[10px] text-[#525252] ml-auto">{item.source}</span>}
			</div>

			<div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#1a1a1a] flex-wrap">
				<select
					value={item.status}
					onChange={(e) => onStatusChange(item.id, e.target.value as WorkItemStatus)}
					className="text-[10px] bg-[#0a0a0a] border border-[#262626] rounded px-1.5 py-0.5 text-[#a3a3a3] hover:border-[#333] focus:outline-none focus:border-[#22c55e]"
					aria-label="Status"
				>
					{COLUMNS.map((c) => (
						<option key={c.key} value={c.key}>
							{c.label}
						</option>
					))}
				</select>
				<select
					value={item.sprintId ?? ''}
					onChange={(e) => onAssignSprint(item.id, e.target.value || null)}
					className="text-[10px] bg-[#0a0a0a] border border-[#262626] rounded px-1.5 py-0.5 text-[#a3a3a3] hover:border-[#333] focus:outline-none focus:border-[#22c55e]"
					aria-label="Sprint"
				>
					<option value="">Sprint yok</option>
					{sprints.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name}
						</option>
					))}
				</select>
				{item.status === 'open' && (
					<button
						type="button"
						onClick={() => onConvert(item.id)}
						className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#22c55e] transition-colors ml-auto"
					>
						<ArrowRight size={10} />
						Convert
					</button>
				)}
			</div>
		</div>
	);
}
