// ---------------------------------------------------------------------------
// StatsCards — Reusable stats card grid
// Extracted from the repeated StatCard + grid pattern across all page files.
// Each page renders 3-5 stat cards at the top with an icon, label, value, and
// optional sub-label. This component unifies that layout.
// ---------------------------------------------------------------------------

import React from 'react';

export interface StatCardDef {
	label: string;
	value: string | number;
	icon: React.ReactNode;
	sub?: string;
	/** Tailwind bg class for the icon container background. Defaults to bg-[#1f1f1f] */
	iconBg?: string;
}

interface StatCardProps extends StatCardDef {
	className?: string;
}

export function StatCard({ label, value, icon, sub, iconBg, className }: StatCardProps) {
	return (
		<div className={`bg-[#111111] border border-[#262626] rounded-xl p-4 flex items-center gap-3 ${className ?? ''}`}>
			<div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg ?? 'bg-[#1f1f1f]'}`}>
				{icon}
			</div>
			<div className="min-w-0">
				<div className="text-[11px] text-[#525252] font-medium">{label}</div>
				<div className="text-lg font-bold text-[#fafafa] leading-tight truncate">{value}</div>
				{sub && <div className="text-[10px] text-[#525252] truncate mt-0.5">{sub}</div>}
			</div>
		</div>
	);
}

interface StatsCardsProps {
	stats: StatCardDef[];
	/** Tailwind grid-cols class. Defaults to auto-fit based on count (max 4) */
	columns?: 2 | 3 | 4 | 5;
	className?: string;
}

const GRID_COLS: Record<number, string> = {
	2: 'grid-cols-2',
	3: 'grid-cols-3',
	4: 'grid-cols-4',
	5: 'grid-cols-5',
};

export function StatsCards({ stats, columns, className }: StatsCardsProps) {
	const cols = columns ?? Math.min(stats.length, 4) as 2 | 3 | 4 | 5;
	const gridClass = GRID_COLS[cols] ?? 'grid-cols-4';

	return (
		<div className={`grid ${gridClass} gap-3 ${className ?? ''}`}>
			{stats.map((stat, i) => (
				<StatCard key={i} {...stat} />
			))}
		</div>
	);
}
