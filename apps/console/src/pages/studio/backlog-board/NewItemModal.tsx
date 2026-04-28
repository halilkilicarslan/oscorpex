import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import ModalOverlay from '../ModalOverlay';
import type { NewItemForm, WorkItemType, Priority } from './helpers';

interface NewItemModalProps {
	onClose: () => void;
	onSubmit: (form: NewItemForm) => void;
}

export default function NewItemModal({ onClose, onSubmit }: NewItemModalProps) {
	const [form, setForm] = useState<NewItemForm>({
		title: '',
		type: 'feature',
		priority: 'medium',
		description: '',
	});

	return (
		<ModalOverlay onClose={onClose} className="bg-black/70">
			<div className="bg-[#111111] border border-[#262626] rounded-xl p-5 w-[400px] shadow-2xl">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-[13px] font-semibold text-[#fafafa]">New Work Item</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
					>
						<X size={14} />
					</button>
				</div>

				<div className="flex flex-col gap-3">
					<div>
						<label className="block text-[11px] text-[#737373] mb-1">Title</label>
						<input
							// eslint-disable-next-line jsx-a11y/no-autofocus
							autoFocus
							value={form.title}
							onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
							placeholder="Work item title..."
							className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] placeholder-[#3a3a3a] focus:outline-none focus:border-[#22c55e]/50 transition-colors"
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="block text-[11px] text-[#737373] mb-1">Type</label>
							<select
								value={form.type}
								onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as WorkItemType }))}
								className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] focus:outline-none focus:border-[#22c55e]/50 transition-colors"
							>
								<option value="feature">Feature</option>
								<option value="bug">Bug</option>
								<option value="defect">Defect</option>
								<option value="security">Security</option>
								<option value="hotfix">Hotfix</option>
								<option value="improvement">Improvement</option>
							</select>
						</div>
						<div>
							<label className="block text-[11px] text-[#737373] mb-1">Priority</label>
							<select
								value={form.priority}
								onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
								className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] focus:outline-none focus:border-[#22c55e]/50 transition-colors"
							>
								<option value="critical">Critical</option>
								<option value="high">High</option>
								<option value="medium">Medium</option>
								<option value="low">Low</option>
							</select>
						</div>
					</div>

					<div>
						<label className="block text-[11px] text-[#737373] mb-1">Description</label>
						<textarea
							value={form.description}
							onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
							placeholder="Optional description..."
							rows={3}
							className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] placeholder-[#3a3a3a] resize-none focus:outline-none focus:border-[#22c55e]/50 transition-colors"
						/>
					</div>
				</div>

				<div className="flex gap-2 mt-4 justify-end">
					<button
						type="button"
						onClick={onClose}
						className="px-3 py-1.5 text-[11px] text-[#737373] hover:text-[#a3a3a3] transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => form.title.trim() && onSubmit(form)}
						disabled={!form.title.trim()}
						className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Plus size={12} />
						Create
					</button>
				</div>
			</div>
		</ModalOverlay>
	);
}
