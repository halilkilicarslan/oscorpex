interface StatCardProps {
	label: string;
	value: string | number;
	sub: string;
	icon: React.ReactNode;
	color: string;
}

export default function StatCard({ label, value, sub, icon, color }: StatCardProps) {
	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
			<div className="flex items-center justify-between mb-2">
				<span className="text-[10px] font-medium text-[#737373] uppercase tracking-wider">{label}</span>
				<span style={{ color }}>{icon}</span>
			</div>
			<div className="text-[22px] font-bold text-[#fafafa] tabular-nums">{value}</div>
			<p className="text-[10px] text-[#525252] mt-0.5">{sub}</p>
		</div>
	);
}
