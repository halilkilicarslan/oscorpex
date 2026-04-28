// ---------------------------------------------------------------------------
// Burndown Chart
// ---------------------------------------------------------------------------

interface BurndownPoint {
	date: string;
	remaining: number;
}

interface BurndownChartProps {
	points: BurndownPoint[];
	totalItems: number;
}

export default function BurndownChart({ points, totalItems }: BurndownChartProps) {
	if (points.length === 0) {
		return (
			<div className="flex items-center justify-center h-32 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]">
				<span className="text-[12px] text-[#333]">No data yet</span>
			</div>
		);
	}

	const W = 400;
	const H = 110;
	const P = 16;
	const maxY = Math.max(totalItems, ...points.map((p) => p.remaining), 1);
	const step = points.length > 1 ? (W - P * 2) / (points.length - 1) : 0;
	const toX = (i: number) => P + i * step;
	const toY = (v: number) => H - P - (v / maxY) * (H - P * 2);

	const actualPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.remaining)}`).join(' ');
	const idealStart = toY(totalItems);
	const idealEnd = toY(0);
	const idealPath = `M ${P} ${idealStart} L ${W - P} ${idealEnd}`;

	return (
		<div className="rounded-lg bg-[#0d0d0d] border border-[#1a1a1a] p-2 overflow-hidden">
			<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-32" role="img" aria-label="Burndown chart">
				<line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#1a1a1a" strokeWidth={1} />
				<path d={idealPath} stroke="#525252" strokeWidth={1} strokeDasharray="3,3" fill="none" />
				<path d={actualPath} stroke="#3b82f6" strokeWidth={1.5} fill="none" />
				{points.map((p, i) => (
					<circle key={`${p.date}-${i}`} cx={toX(i)} cy={toY(p.remaining)} r={2} fill="#3b82f6" />
				))}
			</svg>
			<div className="flex items-center justify-between text-[10px] text-[#525252] px-2 pt-1">
				<span>{points[0]?.date}</span>
				<span className="flex items-center gap-3">
					<span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#3b82f6]" /> Gercek</span>
					<span className="flex items-center gap-1"><span className="w-2 h-px border-t border-dashed border-[#525252]" /> Ideal</span>
				</span>
				<span>{points[points.length - 1]?.date}</span>
			</div>
		</div>
	);
}
