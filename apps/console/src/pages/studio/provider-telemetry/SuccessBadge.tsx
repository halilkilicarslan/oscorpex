// ---------------------------------------------------------------------------
// Success Badge
// ---------------------------------------------------------------------------

import { CheckCircle2, XCircle } from 'lucide-react';

interface SuccessBadgeProps {
	success: boolean;
}

export default function SuccessBadge({ success }: SuccessBadgeProps) {
	if (success) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full border border-[#22c55e]/20 bg-[#22c55e]/10 px-2 py-0.5 text-[10px] text-[#22c55e]">
				<CheckCircle2 size={10} />
				success
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-[#ef4444]/20 bg-[#ef4444]/10 px-2 py-0.5 text-[10px] text-[#ef4444]">
			<XCircle size={10} />
			failed
		</span>
	);
}
