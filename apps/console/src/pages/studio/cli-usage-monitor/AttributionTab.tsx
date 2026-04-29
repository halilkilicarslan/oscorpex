import { Cpu, ShieldAlert } from 'lucide-react';
import type { CLIUsageSnapshot } from "../../../lib/studio-api";

interface AttributionTabProps {
	selected: CLIUsageSnapshot;
}

export default function AttributionTab({ selected }: AttributionTabProps) {
	return (
		<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-5">
			{selected.attribution?.comparable ? (
				<div className="space-y-4">
					<div className="flex items-center gap-3">
						<Cpu size={18} className="text-[#22c55e]" />
						<div className="text-[13px] text-[#fafafa]">Comparable global/local usage found.</div>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-xl bg-[#111111] p-4">
							<div className="text-[10px] text-[#525252]">Oscorpex share</div>
							<div className="mt-2 text-2xl font-bold text-[#22c55e]">
								{selected.attribution.oscorpexSharePercent}%
							</div>
						</div>
						<div className="rounded-xl bg-[#111111] p-4">
							<div className="text-[10px] text-[#525252]">External / unknown</div>
							<div className="mt-2 text-2xl font-bold text-[#a3a3a3]">
								{selected.attribution.externalSharePercent}%
							</div>
						</div>
					</div>
				</div>
			) : (
				<div className="flex items-start gap-3 text-[13px] text-[#737373]">
					<ShieldAlert size={18} className="mt-0.5 text-[#f59e0b]" />
					<div>
						{selected.attribution?.reason ||
							'Global quota and Oscorpex usage are not directly comparable for this provider yet.'}
					</div>
				</div>
			)}
		</div>
	);
}
