import type { AuditEvent } from '../../../types/control-plane';
import StatusBadge from './status-badge.js';

interface AuditTabProps {
	auditEvents: AuditEvent[];
}

export default function AuditTab({ auditEvents }: AuditTabProps) {
	return (
		<div className="space-y-2">
			{auditEvents.length === 0 ? (
				<div className="text-center py-12 text-[12px] text-[#525252]">No audit events.</div>
			) : (
				auditEvents.map(e => (
					<div key={e.id} className="flex items-center gap-3 px-4 py-2 rounded-xl bg-[#111111] border border-[#262626]">
						<StatusBadge status={e.severity} />
						<span className="text-[10px] text-[#525252] uppercase w-20">{e.category}</span>
						<span className="text-[12px] text-[#a3a3a3] flex-1">{e.action}</span>
						<span className="text-[10px] text-[#525252]">{e.actor}</span>
						<span className="text-[10px] text-[#525252]">{new Date(e.created_at).toLocaleString()}</span>
					</div>
				))
			)}
		</div>
	);
}
