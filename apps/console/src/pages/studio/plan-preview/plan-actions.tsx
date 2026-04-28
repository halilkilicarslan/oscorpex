import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface PlanActionsProps {
	onApprove: () => void | Promise<void>;
	onReject: (feedback?: string) => void | Promise<void>;
}

export default function PlanActions({ onApprove, onReject }: PlanActionsProps) {
	const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
	const [feedback, setFeedback] = useState('');
	const [showRejectInput, setShowRejectInput] = useState(false);

	const handleApprove = async () => {
		setLoading('approve');
		try {
			await onApprove();
		} finally {
			setLoading(null);
		}
	};

	const handleReject = async () => {
		setLoading('reject');
		try {
			await onReject(feedback || undefined);
		} finally {
			setLoading(null);
			setShowRejectInput(false);
			setFeedback('');
		}
	};

	return (
		<div className="px-5 py-4 border-t border-[#262626] flex flex-col gap-3">
			{showRejectInput && (
				<div className="flex gap-2">
					<input
						type="text"
						value={feedback}
						onChange={(e) => setFeedback(e.target.value)}
						placeholder="What should be changed?"
						className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#ef4444] focus:outline-none"
						autoFocus
					/>
					<button
						onClick={handleReject}
						disabled={loading !== null}
						className="px-3 py-2 rounded-lg text-[12px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 disabled:opacity-50 transition-colors"
					>
						{loading === 'reject' ? <Loader2 size={14} className="animate-spin" /> : 'Send'}
					</button>
					<button
						onClick={() => {
							setShowRejectInput(false);
							setFeedback('');
						}}
						className="px-3 py-2 rounded-lg text-[12px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
					>
						Cancel
					</button>
				</div>
			)}

			{!showRejectInput && (
				<div className="flex items-center gap-2 justify-end">
					<button
						onClick={() => setShowRejectInput(true)}
						disabled={loading !== null}
						className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium border border-[#262626] text-[#a3a3a3] hover:text-[#ef4444] hover:border-[#ef4444]/30 disabled:opacity-50 transition-colors"
					>
						<XCircle size={14} />
						Request Changes
					</button>
					<button
						onClick={handleApprove}
						disabled={loading !== null}
						className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
					>
						{loading === 'approve' ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<CheckCircle2 size={14} />
						)}
						Approve Plan
					</button>
				</div>
			)}
		</div>
	);
}
