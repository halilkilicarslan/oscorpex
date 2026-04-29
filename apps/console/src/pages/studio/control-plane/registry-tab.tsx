import type { AgentInstance, ProviderRuntime } from '../../../types/control-plane';
import StatusBadge from './status-badge.js';

interface RegistryTabProps {
	agents: AgentInstance[];
	providers: ProviderRuntime[];
	onResetCooldown: (providerId: string) => void;
}

export default function RegistryTab({ agents, providers, onResetCooldown }: RegistryTabProps) {
	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-[12px] font-semibold text-[#fafafa] mb-2">Agents</h3>
				{agents.length === 0 ? (
					<p className="text-[12px] text-[#525252]">No registered agents.</p>
				) : (
					<div className="space-y-1">
						{agents.map(a => (
							<div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#111111] border border-[#262626]">
								<StatusBadge status={a.status} />
								<span className="text-[12px] text-[#a3a3a3] flex-1">{a.name}</span>
								<span className="text-[10px] text-[#525252]">{a.role}</span>
								{a.last_seen_at && (
									<span className="text-[10px] text-[#525252]">{new Date(a.last_seen_at).toLocaleTimeString()}</span>
								)}
							</div>
						))}
					</div>
				)}
			</div>
			<div>
				<h3 className="text-[12px] font-semibold text-[#fafafa] mb-2">Providers</h3>
				{providers.length === 0 ? (
					<p className="text-[12px] text-[#525252]">No registered providers.</p>
				) : (
					<div className="space-y-1">
						{providers.map(p => (
							<div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#111111] border border-[#262626]">
								<StatusBadge status={p.status} />
								<span className="text-[12px] text-[#a3a3a3] flex-1">{p.name}</span>
								<span className="text-[10px] text-[#525252]">{p.type}</span>
								{p.capabilities.length > 0 && (
									<span className="text-[10px] text-[#525252]">{p.capabilities.length} caps</span>
								)}
								{p.status === 'cooldown' && (
									<button onClick={() => onResetCooldown(p.id)} className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#a855f7]/10 text-[#a855f7] hover:bg-[#a855f7]/20">Reset</button>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
