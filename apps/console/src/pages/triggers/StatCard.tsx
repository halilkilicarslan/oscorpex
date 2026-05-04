import React from 'react';

interface StatCardProps {
	label: string;
	value: number;
	color: string;
	icon: React.ReactNode;
}

export function StatCard({ label, value, color, icon }: StatCardProps) {
	return (
		<div className="flex-1 px-4 py-3 border-r border-[#262626] last:border-r-0">
			<div className="flex items-center gap-1.5 mb-1" style={{ color }}>
				{icon}
				<span className="text-[11px] text-[#525252]">{label}</span>
			</div>
			<span className="text-xl font-semibold text-[#fafafa]">{value}</span>
		</div>
	);
}
