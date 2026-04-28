import type { WorkItemType, Priority } from './helpers';

interface FilterBarProps {
	filterType: WorkItemType | '';
	filterPriority: Priority | '';
	filterSource: string;
	onFilterTypeChange: (value: WorkItemType | '') => void;
	onFilterPriorityChange: (value: Priority | '') => void;
	onFilterSourceChange: (value: string) => void;
	onClearFilters: () => void;
}

export default function FilterBar({
	filterType,
	filterPriority,
	filterSource,
	onFilterTypeChange,
	onFilterPriorityChange,
	onFilterSourceChange,
	onClearFilters,
}: FilterBarProps) {
	return (
		<div className="flex items-center gap-3 p-3 bg-[#111111] border border-[#262626] rounded-lg flex-wrap">
			<span className="text-[11px] text-[#525252]">Type:</span>
			<select
				value={filterType}
				onChange={(e) => onFilterTypeChange(e.target.value as WorkItemType | '')}
				className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1 text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e]/50"
			>
				<option value="">All</option>
				<option value="feature">Feature</option>
				<option value="bug">Bug</option>
				<option value="defect">Defect</option>
				<option value="security">Security</option>
				<option value="hotfix">Hotfix</option>
				<option value="improvement">Improvement</option>
			</select>

			<span className="text-[11px] text-[#525252]">Priority:</span>
			<select
				value={filterPriority}
				onChange={(e) => onFilterPriorityChange(e.target.value as Priority | '')}
				className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1 text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e]/50"
			>
				<option value="">All</option>
				<option value="critical">Critical</option>
				<option value="high">High</option>
				<option value="medium">Medium</option>
				<option value="low">Low</option>
			</select>

			<span className="text-[11px] text-[#525252]">Source:</span>
			<input
				value={filterSource}
				onChange={(e) => onFilterSourceChange(e.target.value)}
				placeholder="Filter by source..."
				className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1 text-[11px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none focus:border-[#22c55e]/50 w-36"
			/>

			{(filterType || filterPriority || filterSource) && (
				<button
					type="button"
					onClick={onClearFilters}
					className="text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors ml-auto"
				>
					Clear
				</button>
			)}
		</div>
	);
}
