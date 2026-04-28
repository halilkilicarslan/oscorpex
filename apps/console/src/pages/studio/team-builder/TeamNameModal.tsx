// ---------------------------------------------------------------------------
// Team Name Modal
// ---------------------------------------------------------------------------

import { useState } from 'react';

interface TeamNameModalProps {
	initial?: { name: string; description: string };
	onSave: (name: string, description: string) => void;
	onCancel: () => void;
}

export default function TeamNameModal({ initial, onSave, onCancel }: TeamNameModalProps) {
	const [name, setName] = useState(initial?.name ?? '');
	const [desc, setDesc] = useState(initial?.description ?? '');

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-5 w-[380px] shadow-2xl">
				<h3 className="text-[14px] font-semibold text-[#fafafa] mb-4">
					{initial ? 'Edit Team' : 'New Team'}
				</h3>
				<div className="space-y-3">
					<div>
						<label className="text-[11px] text-[#737373] block mb-1">Team Name</label>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Custom Team"
							className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[12px] text-[#e5e5e5] placeholder:text-[#525252] focus:outline-none focus:border-[#22c55e]/50"
						/>
					</div>
					<div>
						<label className="text-[11px] text-[#737373] block mb-1">Description</label>
						<input
							value={desc}
							onChange={(e) => setDesc(e.target.value)}
							placeholder="Brief description of the team"
							className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[12px] text-[#e5e5e5] placeholder:text-[#525252] focus:outline-none focus:border-[#22c55e]/50"
						/>
					</div>
				</div>
				<div className="flex justify-end gap-2 mt-5">
					<button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-[#a3a3a3] hover:text-[#fafafa] transition-colors">
						Cancel
					</button>
					<button
						onClick={() => onSave(name.trim(), desc.trim())}
						disabled={!name.trim()}
						className="px-3 py-1.5 text-[11px] font-medium text-[#0a0a0a] bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-40 transition-all"
					>
						{initial ? 'Update' : 'Create'}
					</button>
				</div>
			</div>
		</div>
	);
}
