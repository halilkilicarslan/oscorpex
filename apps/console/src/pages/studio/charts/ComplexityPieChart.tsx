// ---------------------------------------------------------------------------
// ComplexityPieChart — Task complexity distribution using Recharts PieChart
// ---------------------------------------------------------------------------

import {
	PieChart,
	Pie,
	Cell,
	Tooltip,
	Legend,
	ResponsiveContainer,
} from 'recharts';

interface ComplexityPieChartProps {
	data: Record<string, number>;
}

const COLORS: Record<string, string> = {
	S: '#22c55e',
	M: '#3b82f6',
	L: '#f59e0b',
	XL: '#ef4444',
};

const ORDER = ['S', 'M', 'L', 'XL'];

interface CustomTooltipProps {
	active?: boolean;
	payload?: Array<{ name: string; value: number }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
	if (!active || !payload?.length) return null;
	const item = payload[0];
	return (
		<div className="bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-[11px]">
			<p className="text-[#a3a3a3]">
				<span style={{ color: COLORS[item.name] ?? '#737373' }} className="font-semibold">
					{item.name}
				</span>
				{' — '}
				{item.value} task{item.value !== 1 ? 's' : ''}
			</p>
		</div>
	);
}

interface LegendPayloadItem {
	value: string;
	color: string;
}

function CustomLegend({ payload }: { payload?: LegendPayloadItem[] }) {
	if (!payload?.length) return null;
	return (
		<div className="flex items-center justify-center gap-4 mt-2">
			{payload.map((entry) => (
				<div key={entry.value} className="flex items-center gap-1.5">
					<span
						className="w-2 h-2 rounded-full"
						style={{ backgroundColor: entry.color }}
					/>
					<span className="text-[10px] text-[#9ca3af]">{entry.value}</span>
				</div>
			))}
		</div>
	);
}

export default function ComplexityPieChart({ data }: ComplexityPieChartProps) {
	const entries = ORDER.map((key) => ({
		name: key,
		value: data[key] ?? 0,
	})).filter((e) => e.value > 0);

	if (entries.length === 0) {
		return (
			<div className="h-[220px] flex items-center justify-center text-[12px] text-[#525252] bg-[#0d0d0d] rounded-lg border border-[#1a1a1a]">
				No task data yet
			</div>
		);
	}

	return (
		<ResponsiveContainer width="100%" height={220}>
			<PieChart>
				<Pie
					data={entries}
					cx="50%"
					cy="45%"
					innerRadius={55}
					outerRadius={85}
					paddingAngle={2}
					dataKey="value"
					strokeWidth={0}
				>
					{entries.map((entry) => (
						<Cell
							key={entry.name}
							fill={COLORS[entry.name] ?? '#737373'}
							opacity={0.9}
						/>
					))}
				</Pie>
				<Tooltip content={<CustomTooltip />} />
				<Legend content={<CustomLegend />} />
			</PieChart>
		</ResponsiveContainer>
	);
}
