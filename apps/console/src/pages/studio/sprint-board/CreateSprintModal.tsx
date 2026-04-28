// ---------------------------------------------------------------------------
// Create Sprint Modal
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import ModalOverlay from '../ModalOverlay';
import { defaultSprintDates } from './helpers.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

interface CreateSprintModalProps {
	projectId: string;
	defaultName: string;
	onClose: () => void;
	onCreated: () => void;
}

export default function CreateSprintModal({ projectId, defaultName, onClose, onCreated }: CreateSprintModalProps) {
	const defaults = defaultSprintDates();
	const [name, setName] = useState(defaultName);
	const [goal, setGoal] = useState('');
	const [startDate, setStartDate] = useState(defaults.startDate);
	const [endDate, setEndDate] = useState(defaults.endDate);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		const trimmed = name.trim();
		if (!trimmed) {
			setError('Name is required');
			return;
		}
		if (endDate < startDate) {
			setError('End date cannot be before start date');
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const res = await fetch(`${BASE}/api/studio/projects/${projectId}/sprints`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: trimmed,
					goal: goal.trim() || undefined,
					startDate,
					endDate,
				}),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? 'Failed to create sprint');
			}
			onCreated();
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	return (
		<ModalOverlay onClose={onClose}>
			<div className="w-[420px] bg-[#111111] border border-[#262626] rounded-xl shadow-2xl">
				<div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
					<h3 className="text-[13px] font-semibold text-[#fafafa]">New Sprint</h3>
					<button type="button" onClick={onClose} className="text-[#525252] hover:text-[#a3a3a3] transition-colors" aria-label="Close">
						<X size={14} />
					</button>
				</div>
				<div className="px-4 py-3 space-y-3">
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">Name</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
							placeholder="Sprint 1"
						/>
					</div>
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">Goal (optional)</label>
						<input
							type="text"
							value={goal}
							onChange={(e) => setGoal(e.target.value)}
							className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
							placeholder="Complete auth flow"
						/>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<div>
							<label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">Start Date</label>
							<input
								type="date"
								value={startDate}
								onChange={(e) => setStartDate(e.target.value)}
								className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
							/>
						</div>
						<div>
							<label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">End Date</label>
							<input
								type="date"
								value={endDate}
								onChange={(e) => setEndDate(e.target.value)}
								className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
							/>
						</div>
					</div>
					{error && (
						<div className="px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
							{error}
						</div>
					)}
				</div>
				<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1a1a1a]">
					<button type="button" onClick={onClose} disabled={saving} className="px-3 py-1.5 text-[11px] text-[#a3a3a3] hover:text-[#fafafa] transition-colors disabled:opacity-50">
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={saving}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
					>
						{saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
						Create
					</button>
				</div>
			</div>
		</ModalOverlay>
	);
}
