import type { Incident } from '../../../types/control-plane';
import StatusBadge from './status-badge.js';

interface IncidentsTabProps {
	incidents: Incident[];
	onAck: (id: string) => void;
	onResolve: (id: string) => void;
	onReopen: (id: string) => void;
}

export default function IncidentsTab({ incidents, onAck, onResolve, onReopen }: IncidentsTabProps) {
	return (
		<div className="space-y-2">
			{incidents.length === 0 ? (
				<div className="text-center py-12 text-[12px] text-[#525252]">No incidents recorded.</div>
			) : (
				incidents.map(i => (
					<div key={i.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#111111] border border-[#262626]">
						<StatusBadge status={i.status} />
						<div className="flex-1 min-w-0">
							<p className="text-[12px] font-medium text-[#fafafa]">{i.title}</p>
							<p className="text-[10px] text-[#525252]">{i.type} · {i.severity} · {new Date(i.created_at).toLocaleString()}</p>
						</div>
						{i.status === 'open' && (
							<button onClick={() => onAck(i.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#3b82f6]/10 text-[#3b82f6] hover:bg-[#3b82f6]/20">Ack</button>
						)}
						{(i.status === 'open' || i.status === 'acknowledged') && (
							<button onClick={() => onResolve(i.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20">Resolve</button>
						)}
						{i.status === 'resolved' && (
							<button onClick={() => onReopen(i.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20">Reopen</button>
						)}
					</div>
				))
			)}
		</div>
	);
}
