import { ShieldAlert } from 'lucide-react';
import type { Task } from '../../lib/studio-api';

interface ApprovalBannerProps {
	tasks: Task[];
}

export default function ApprovalBanner({ tasks }: ApprovalBannerProps) {
	const pendingCount = tasks.filter((t) => t.status === 'waiting_approval').length;
	if (pendingCount === 0) return null;

	return (
		<div className="flex items-center gap-2.5 px-3 py-2 mb-4 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/25 text-[11px]">
			<ShieldAlert size={13} className="text-[#f59e0b] shrink-0" />
			<span className="text-[#f59e0b] font-semibold">{pendingCount} task onay bekliyor</span>
			<span className="text-[#737373]">—</span>
			<span className="text-[#737373]">
				Awaiting Approval kolonundaki task'ları inceleyip onaylayın veya reddedin.
			</span>
			<span className="ml-auto bg-[#f59e0b]/15 text-[#f59e0b] font-bold text-[10px] px-2 py-0.5 rounded-full border border-[#f59e0b]/30">
				{pendingCount}
			</span>
		</div>
	);
}
