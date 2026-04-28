import { useState } from 'react';
import { XCircle } from 'lucide-react';
import ModalOverlay from '../ModalOverlay';

interface RejectModalProps {
	taskTitle: string;
	onConfirm: (reason: string) => void;
	onCancel: () => void;
}

export default function RejectModal({ taskTitle, onConfirm, onCancel }: RejectModalProps) {
	const [reason, setReason] = useState('');

	return (
		<ModalOverlay onClose={onCancel} className="bg-black/70">
			<div className="bg-[#111] border border-[#262626] rounded-xl p-5 w-[360px] shadow-2xl">
				<div className="flex items-center gap-2 mb-3">
					<XCircle size={16} className="text-[#ef4444]" />
					<h2 className="text-[13px] font-semibold text-[#e5e5e5]">Reject Task</h2>
				</div>

				<p className="text-[11px] text-[#737373] mb-3 leading-snug">
					You are about to reject <span className="text-[#a3a3a3] font-medium">"{taskTitle}"</span>.
				</p>

				<label className="block text-[11px] text-[#737373] mb-1.5">Rejection reason (optional)</label>
				<textarea
					// eslint-disable-next-line jsx-a11y/no-autofocus
					autoFocus
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder="Why are you rejecting this task?"
					rows={3}
					className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] placeholder-[#3a3a3a] resize-none focus:outline-none focus:border-[#ef4444]/50 transition-colors"
				/>

				<div className="flex gap-2 mt-4 justify-end">
					<button
						type="button"
						onClick={onCancel}
						className="px-3 py-1.5 text-[11px] text-[#737373] hover:text-[#a3a3a3] transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => onConfirm(reason.trim())}
						className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/20 rounded-lg transition-colors"
					>
						<XCircle size={12} />
						Reject
					</button>
				</div>
			</div>
		</ModalOverlay>
	);
}
