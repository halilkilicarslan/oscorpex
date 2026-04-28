import { Terminal, RefreshCw } from 'lucide-react';
import { STATUS_STYLE, fmtTokens, fmtMoney } from './helpers';
import type { CLIUsageSnapshot, CLIProviderId } from '../../lib/studio-api';

interface ProviderCardProps {
	provider: CLIUsageSnapshot;
	selected: boolean;
	onSelect: () => void;
	onRefresh: () => void;
}

export default function ProviderCard({ provider, selected, onSelect, onRefresh }: ProviderCardProps) {
	const quotaStatus = provider.global?.quotas?.[0]?.status ?? (provider.global ? 'unknown' : 'unknown');
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`text-left rounded-2xl border p-4 transition-colors ${
				selected ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-[#262626] bg-[#111111] hover:border-[#333]'
			}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f1f1f] text-[#22c55e]">
						<Terminal size={18} />
					</div>
					<div>
						<div className="text-[13px] font-semibold text-[#fafafa]">{provider.label}</div>
						<div className="text-[10px] text-[#525252]">{provider.version || 'version unknown'}</div>
					</div>
				</div>
				<span
					className={`rounded-full border px-2 py-0.5 text-[10px] ${
						provider.installed
							? 'border-[#22c55e]/20 text-[#22c55e]'
							: 'border-[#ef4444]/20 text-[#ef4444]'
					}`}
				>
					{provider.installed ? 'installed' : 'missing'}
				</span>
			</div>
			<div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">Auth</div>
					<div className="text-[#fafafa]">{provider.authStatus}</div>
				</div>
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">Quota</div>
					<div className={STATUS_STYLE[quotaStatus].split(' ')[0]}>{quotaStatus}</div>
				</div>
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">Today</div>
					<div className="text-[#fafafa]">{fmtTokens(provider.oscorpex.todayTokens)}</div>
				</div>
				<div className="rounded-lg bg-[#0a0a0a] p-2">
					<div className="text-[#525252]">Week cost</div>
					<div className="text-[#fafafa]">{fmtMoney(provider.oscorpex.weekCostUsd)}</div>
				</div>
			</div>
			<div className="mt-3 flex items-center justify-between gap-2">
				<div className="truncate text-[10px] text-[#525252]">
					{provider.binaryPath || 'binary path unavailable'}
				</div>
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onRefresh();
					}}
					className="rounded-lg p-1 text-[#737373] hover:bg-[#1f1f1f] hover:text-[#fafafa]"
					title="Refresh"
				>
					<RefreshCw size={13} />
				</button>
			</div>
		</button>
	);
}
