// ---------------------------------------------------------------------------
// Add Work Item Picker
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Plus } from 'lucide-react';

interface SprintWorkItem {
	id: string;
	title: string;
	type: string;
	priority: string;
	status: string;
	sprintId?: string | null;
}

interface AddWorkItemPickerProps {
	unassigned: SprintWorkItem[];
	onAdd: (itemId: string) => void;
	disabled?: boolean;
}

export default function AddWorkItemPicker({ unassigned, onAdd, disabled }: AddWorkItemPickerProps) {
	const [open, setOpen] = useState(false);
	if (unassigned.length === 0) return null;
	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={disabled}
				className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[#22c55e] border border-[#22c55e]/30 rounded hover:bg-[#22c55e]/10 transition-colors disabled:opacity-40"
			>
				<Plus size={10} /> Item ekle ({unassigned.length})
			</button>
			{open && (
				<div className="absolute right-0 top-full mt-1 w-64 max-h-56 overflow-y-auto bg-[#0d0d0d] border border-[#262626] rounded-lg shadow-xl z-10">
					{unassigned.map((it) => (
						<button
							key={it.id}
							type="button"
							onClick={() => { onAdd(it.id); setOpen(false); }}
							className="block w-full text-left px-3 py-1.5 text-[11px] text-[#e5e5e5] hover:bg-[#1a1a1a] transition-colors border-b border-[#1a1a1a] last:border-b-0"
						>
							<div className="flex items-center gap-2">
								<span className="text-[9px] text-[#525252] bg-[#1a1a1a] px-1 rounded border border-[#262626]">{it.type}</span>
								<span className="truncate">{it.title}</span>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
