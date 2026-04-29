interface StatCardProps {
	label: string;
	value: string | number;
	icon: React.ReactNode;
	color?: string;
}

export default function StatCard({ label, value, icon, color = '#22c55e' }: StatCardProps) {
	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<span style={{ color }}>{icon}</span>
				<span className="text-[11px] text-[#525252] uppercase tracking-wider">{label}</span>
			</div>
			<span className="text-[22px] font-bold text-[#fafafa]">{value}</span>
		</div>
	);
}
