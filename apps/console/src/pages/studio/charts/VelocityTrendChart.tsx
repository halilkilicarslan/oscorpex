// ---------------------------------------------------------------------------
// VelocityTrendChart — Sprint velocity trend using Recharts BarChart
// ---------------------------------------------------------------------------

import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	ResponsiveContainer,
} from 'recharts';

interface SprintSummary {
	id: string;
	name: string;
	velocity?: number;
	status: string;
}

interface VelocityTrendChartProps {
	sprints: SprintSummary[];
}

interface CustomTooltipProps {
	active?: boolean;
	payload?: Array<{ value: number }>;
	label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
	if (!active || !payload?.length) return null;
	return (
		<div className="bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-[11px]">
			<p className="text-[#737373] mb-1">{label}</p>
			<p className="text-[#22c55e] font-semibold">{payload[0].value} items</p>
		</div>
	);
}

export default function VelocityTrendChart({ sprints }: VelocityTrendChartProps) {
	const completed = sprints.filter((s) => s.status === 'completed');

	if (completed.length === 0) {
		return (
			<div className="h-[200px] flex items-center justify-center text-[12px] text-[#525252] bg-[#0d0d0d] rounded-lg border border-[#1a1a1a]">
				No completed sprints yet
			</div>
		);
	}

	const data = completed.map((s) => ({
		name: s.name.length > 12 ? s.name.slice(0, 12) + '…' : s.name,
		velocity: s.velocity ?? 0,
	}));

	return (
		<ResponsiveContainer width="100%" height={200}>
			<BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
				<XAxis
					dataKey="name"
					tick={{ fontSize: 10, fill: '#9ca3af' }}
					tickLine={false}
					axisLine={false}
				/>
				<YAxis
					tick={{ fontSize: 10, fill: '#9ca3af' }}
					tickLine={false}
					axisLine={false}
					allowDecimals={false}
					width={28}
				/>
				<Tooltip content={<CustomTooltip />} cursor={{ fill: '#1a1a1a' }} />
				<Bar
					dataKey="velocity"
					fill="#22c55e"
					radius={[3, 3, 0, 0]}
					maxBarSize={40}
				/>
			</BarChart>
		</ResponsiveContainer>
	);
}
