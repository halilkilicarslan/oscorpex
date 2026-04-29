import { STATUS_STYLE, statusIcon } from './helpers';
import type { CLIUsageSnapshot } from "../../../lib/studio-api";

interface QuotaBarProps {
	quota: NonNullable<CLIUsageSnapshot['global']>['quotas'][number];
}

export default function QuotaBar({ quota }: QuotaBarProps) {
	const percent = quota.percentRemaining ?? 0;
	return (
		<div className="rounded-xl border border-[#262626] bg-[#0a0a0a] p-3">
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="text-[12px] font-medium text-[#fafafa]">{quota.label}</div>
					<div className="text-[10px] text-[#525252]">
						{quota.type}
						{quota.resetText ? ` · ${quota.resetText}` : ''}
					</div>
				</div>
				<span
					className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[quota.status]}`}
				>
					{statusIcon(quota.status)}
					{quota.percentRemaining != null
						? `${Math.round(quota.percentRemaining)}% left`
						: quota.dollarRemaining != null
							? `$${quota.dollarRemaining.toFixed(2)}`
							: 'unknown'}
				</span>
			</div>
			{quota.percentRemaining != null && (
				<div className="mt-3 h-2 overflow-hidden rounded-full bg-[#1f1f1f]">
					<div
						className="h-full rounded-full bg-[#22c55e]"
						style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
					/>
				</div>
			)}
		</div>
	);
}
