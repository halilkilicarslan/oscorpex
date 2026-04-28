import { QuotaBar } from './QuotaBar';
import { STATUS_STYLE } from './helpers';
import type { CLIUsageSnapshot } from '../../lib/studio-api';

interface GlobalTabProps {
	selected: CLIUsageSnapshot;
}

export default function GlobalTab({ selected }: GlobalTabProps) {
	return (
		<div className="space-y-4">
			{!selected.permissions.enabled && (
				<div className="rounded-2xl border border-[#f59e0b]/20 bg-[#f59e0b]/10 p-4 text-[12px] text-[#f59e0b]">
					Global quota probe kapalı. Settings tabından provider bazlı opt-in açılmalı.
				</div>
			)}
			{selected.global?.quotas?.length ? (
				<div className="grid gap-3">
					{selected.global.quotas.map((quota, index) => (
						<QuotaBar key={`${quota.type}-${quota.label}-${index}`} quota={quota} />
					))}
				</div>
			) : (
				<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-6 text-center text-[13px] text-[#737373]">
					Global quota unavailable. {selected.errors[0] || 'No provider-reported quota data yet.'}
				</div>
			)}
			{selected.global && (
				<div className="flex flex-wrap gap-2 text-[11px]">
					<span className="rounded-full border border-[#262626] px-2 py-1 text-[#a3a3a3]">
						source: {selected.global.source}
					</span>
					<span className="rounded-full border border-[#262626] px-2 py-1 text-[#a3a3a3]">
						confidence: {selected.global.confidence}
					</span>
					{selected.global.accountTier && (
						<span className="rounded-full border border-[#262626] px-2 py-1 text-[#a3a3a3]">
							tier: {selected.global.accountTier}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
