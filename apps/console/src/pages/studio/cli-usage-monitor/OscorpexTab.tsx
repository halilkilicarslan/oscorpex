import { fmtTokens, fmtMoney } from './helpers';
import type { CLIUsageSnapshot } from "../../../lib/studio-api";

interface OscorpexTabProps {
	selected: CLIUsageSnapshot;
}

export default function OscorpexTab({ selected }: OscorpexTabProps) {
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
					<div className="text-[10px] text-[#525252]">Today tokens</div>
					<div className="mt-2 text-xl font-bold">{fmtTokens(selected.oscorpex.todayTokens)}</div>
				</div>
				<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
					<div className="text-[10px] text-[#525252]">Week tokens</div>
					<div className="mt-2 text-xl font-bold">{fmtTokens(selected.oscorpex.weekTokens)}</div>
				</div>
				<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
					<div className="text-[10px] text-[#525252]">Week cost</div>
					<div className="mt-2 text-xl font-bold">{fmtMoney(selected.oscorpex.weekCostUsd)}</div>
				</div>
				<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
					<div className="text-[10px] text-[#525252]">Runs / failures</div>
					<div className="mt-2 text-xl font-bold">
						{selected.oscorpex.runCount}/{selected.oscorpex.failureCount}
					</div>
				</div>
			</div>
			<div className="rounded-2xl border border-[#262626] bg-[#0a0a0a]">
				<div className="border-b border-[#262626] px-4 py-3 text-[12px] font-medium text-[#fafafa]">
					Project breakdown
				</div>
				<div className="divide-y divide-[#1f1f1f]">
					{selected.oscorpex.projectBreakdown.length === 0 && (
						<div className="px-4 py-5 text-[12px] text-[#737373]">
							No Oscorpex usage for this CLI yet.
						</div>
					)}
					{selected.oscorpex.projectBreakdown.map((project) => (
						<div
							key={project.projectId}
							className="flex items-center justify-between gap-3 px-4 py-3 text-[12px]"
						>
							<div className="min-w-0">
								<div className="truncate text-[#fafafa]">{project.projectName}</div>
								<div className="truncate text-[10px] text-[#525252]">{project.projectId}</div>
							</div>
							<div className="text-right text-[#a3a3a3]">
								{fmtTokens(project.tokens)} · {fmtMoney(project.costUsd)}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
