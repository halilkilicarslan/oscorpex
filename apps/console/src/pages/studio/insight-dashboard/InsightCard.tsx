import type { Insight } from './helpers';
import { SEV_STYLES } from './helpers';

export default function InsightCard({ icon, severity, metric, evidence, action, roi }: Insight) {
	const s = SEV_STYLES[severity];
	return (
		<div className={`rounded-xl border ${s.border} ${s.bg} p-4`}>
			<div className="flex items-center gap-2 mb-2">
				<span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${s.badge}`}>
					{s.label}
				</span>
			</div>
			<div className="flex items-center gap-2 mb-1.5">
				{icon}
				<h4 className="text-[12px] font-bold text-[#fafafa]">{metric}</h4>
			</div>
			<p className="text-[10px] text-[#a3a3a3] mb-3">{evidence}</p>
			<div className="grid grid-cols-2 gap-2">
				<div className="rounded-lg bg-[#0a0a0a]/40 p-2.5">
					<p className="text-[8px] font-bold uppercase tracking-wider text-[#737373] mb-0.5">Action</p>
					<p className="text-[10px] text-[#e4e4e7]">{action}</p>
				</div>
				<div className="rounded-lg bg-[#0a0a0a]/40 p-2.5">
					<p className="text-[8px] font-bold uppercase tracking-wider text-[#737373] mb-0.5">Impact</p>
					<p className="text-[10px] text-[#e4e4e7]">{roi}</p>
				</div>
			</div>
		</div>
	);
}
