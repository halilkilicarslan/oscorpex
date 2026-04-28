import { COLORS } from './helpers';

interface RatioBarItem {
	label: string;
	value: number;
	color: string;
}

interface RatioBarProps {
	items: RatioBarItem[];
}

export function RatioBar({ items }: RatioBarProps) {
	const total = items.reduce((a, b) => a + b.value, 0);
	if (total === 0) return null;
	return (
		<div>
			<div className="flex h-2.5 rounded-full overflow-hidden bg-[#1a1a1a]">
				{items.map((item, i) => (
					<div
						key={i}
						className="transition-all"
						style={{
							width: `${Math.max(Math.round((100 * item.value) / total), 2)}%`,
							background: item.color,
						}}
					/>
				))}
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
				{items.map((item, i) => (
					<span key={i} className="text-[10px] text-[#737373] flex items-center gap-1">
						<span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
						{item.label}: {item.value} ({Math.round((100 * item.value) / total)}%)
					</span>
				))}
			</div>
		</div>
	);
}

interface MiniProps {
	label: string;
	value: string | number;
	color?: string;
}

export function Mini({ label, value, color }: MiniProps) {
	return (
		<div className="text-center">
			<div className={`text-[18px] font-bold tabular-nums ${color || 'text-[#fafafa]'}`}>{value}</div>
			<p className="text-[9px] text-[#737373] uppercase tracking-wider">{label}</p>
		</div>
	);
}

interface BarRowProps {
	label: string;
	value: number;
	max: number;
	color: string;
	index: number;
}

export function BarRow({ label, value, max, color, index }: BarRowProps) {
	const pct = max > 0 ? Math.round((100 * value) / max) : 0;
	return (
		<div>
			<div className="flex justify-between text-[10px] mb-0.5">
				<span className="font-medium text-[#e4e4e7] truncate max-w-[180px]">{label}</span>
				<span className="text-[#737373] tabular-nums">
					{value} <span className="text-[#525252]">({pct}%)</span>
				</span>
			</div>
			<div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
				<div
					className="h-full rounded-full transition-all"
					style={{
						width: `${pct}%`,
						background: color || COLORS[index % COLORS.length],
					}}
				/>
			</div>
		</div>
	);
}
