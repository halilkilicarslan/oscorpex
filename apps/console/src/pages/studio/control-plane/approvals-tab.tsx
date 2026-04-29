import type { ApprovalWithSla } from '../../../types/control-plane';
import { formatDuration } from './helpers.js';
import StatusBadge from './status-badge.js';

interface ApprovalsTabProps {
	approvals: ApprovalWithSla[];
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
	onEscalate: (id: string) => void;
}

export default function ApprovalsTab({ approvals, onApprove, onReject, onEscalate }: ApprovalsTabProps) {
	return (
		<div className="space-y-2">
			{approvals.length === 0 ? (
				<div className="text-center py-12 text-[12px] text-[#525252]">No approval requests.</div>
			) : (
				approvals.map(a => (
					<div key={a.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#111111] border border-[#262626]">
						<StatusBadge status={a.status} />
						<div className="flex-1 min-w-0">
							<p className="text-[12px] font-medium text-[#fafafa]">{a.title}</p>
							<p className="text-[10px] text-[#525252]">
								{a.kind} · by {a.requested_by} · {new Date(a.created_at).toLocaleString()}
								{'sla' in a && a.sla && (
									<span className="ml-2">
										{a.sla.isExpiringSoon && <span className="text-[#f59e0b]">expires in {formatDuration(a.sla.expiresInMinutes)}</span>}
										{a.sla.escalated && <span className="text-[#ef4444] ml-1">escalated{a.sla.escalationTarget ? ` → ${a.sla.escalationTarget}` : ''}</span>}
										{a.status === 'pending' && !a.sla.isExpiringSoon && <span>age {formatDuration(a.sla.pendingAgeMinutes)}</span>}
									</span>
								)}
							</p>
						</div>
						{a.status === 'pending' && (
							<div className="flex items-center gap-1">
								<button onClick={() => onApprove(a.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20">Approve</button>
								<button onClick={() => onReject(a.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20">Reject</button>
								<button onClick={() => onEscalate(a.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20">Escalate</button>
							</div>
						)}
					</div>
				))
			)}
		</div>
	);
}
