import WorkItemCard from './WorkItemCard';
import type { WorkItem, WorkItemStatus, SprintOption } from './helpers';

interface BacklogColumnProps {
	col: { key: WorkItemStatus; label: string; color: string };
	items: WorkItem[];
	sprints: SprintOption[];
	onConvert: (id: string) => void;
	onAssignSprint: (id: string, sprintId: string | null) => void;
	onStatusChange: (id: string, status: WorkItemStatus) => void;
	onDelete: (id: string) => void;
}

export default function BacklogColumn({
	col,
	items,
	sprints,
	onConvert,
	onAssignSprint,
	onStatusChange,
	onDelete,
}: BacklogColumnProps) {
	return (
		<div className="w-[280px] shrink-0 flex flex-col">
			<div className={`flex items-center gap-2 px-3 py-2 mb-3 border-t-2 ${col.color} rounded-t-sm`}>
				<span className="text-[12px] font-semibold uppercase text-[#a3a3a3]">{col.label}</span>
				<span className="text-[11px] text-[#525252] bg-[#1f1f1f] px-1.5 py-0.5 rounded-full">
					{items.length}
				</span>
			</div>
			<div className="flex-1 flex flex-col gap-2 overflow-y-auto">
				{items.map((item) => (
					<WorkItemCard
						key={item.id}
						item={item}
						sprints={sprints}
						onConvert={onConvert}
						onAssignSprint={onAssignSprint}
						onStatusChange={onStatusChange}
						onDelete={onDelete}
					/>
				))}
				{items.length === 0 && (
					<div className="flex items-center justify-center py-8 text-[11px] text-[#333]">No items</div>
				)}
			</div>
		</div>
	);
}
