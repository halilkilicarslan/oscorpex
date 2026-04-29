import { Shield, Users, Zap, AlertTriangle, DollarSign, Activity, Clock, XCircle, CheckCircle2 } from 'lucide-react';
import type { ApprovalWithSla } from '../../../types/control-plane';
import StatusBadge from './status-badge.js';
import StatCard from './stat-card.js';

interface SummaryTabProps {
	summary: any;
	approvals: ApprovalWithSla[];
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
}

export default function SummaryTab({ summary, approvals, onApprove, onReject }: SummaryTabProps) {
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
				<StatCard label="Pending Approvals" value={summary.summary.pendingApprovals} icon={<Shield size={16} />} color="#f59e0b" />
				<StatCard label="Active Agents" value={summary.summary.activeAgents} icon={<Users size={16} />} color="#22c55e" />
				<StatCard label="Cooldown Providers" value={summary.summary.cooldownProviders} icon={<Zap size={16} />} color="#a855f7" />
				<StatCard label="Open Incidents" value={summary.summary.openIncidents} icon={<AlertTriangle size={16} />} color="#ef4444" />
				<StatCard label="Over Budget" value={summary.summary.projectsOverBudget} icon={<DollarSign size={16} />} color="#f97316" />
			</div>

			{summary.approvals.pendingCount > 0 && (
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<h3 className="text-[12px] font-semibold text-[#fafafa] mb-3">Approval Queue</h3>
					<div className="space-y-2">
						{approvals.filter(a => a.status === 'pending').slice(0, 5).map(a => (
							<div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]">
								<StatusBadge status={a.status} />
								<span className="text-[12px] text-[#a3a3a3] flex-1">{a.title}</span>
								<span className="text-[10px] text-[#525252]">{a.kind}</span>
								<button onClick={() => onApprove(a.id)} className="p-1 rounded hover:bg-[#22c55e]/10 text-[#22c55e]"><CheckCircle2 size={14} /></button>
								<button onClick={() => onReject(a.id)} className="p-1 rounded hover:bg-[#ef4444]/10 text-[#ef4444]"><XCircle size={14} /></button>
							</div>
						))}
					</div>
				</div>
			)}

			{summary.runtime.providerDetails.length > 0 && (
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
					<h3 className="text-[12px] font-semibold text-[#fafafa] mb-3">Provider Health</h3>
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
						<StatCard label="Online" value={summary.runtime.onlineCount} icon={<Activity size={14} />} color="#22c55e" />
						<StatCard label="Degraded" value={summary.runtime.degradedCount} icon={<AlertTriangle size={14} />} color="#f59e0b" />
						<StatCard label="Cooldown" value={summary.runtime.cooldownCount} icon={<Clock size={14} />} color="#a855f7" />
						<StatCard label="Offline" value={summary.runtime.offlineCount} icon={<XCircle size={14} />} color="#ef4444" />
					</div>
				</div>
			)}
		</div>
	);
}
