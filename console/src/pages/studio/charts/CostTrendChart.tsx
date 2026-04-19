// ---------------------------------------------------------------------------
// CostTrendChart — Daily cost trend using Recharts LineChart
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	ResponsiveContainer,
} from 'recharts';
import { fetchActivityTimeline, fetchProjectCosts } from '../../../lib/studio-api';

interface CostTrendChartProps {
	projectId: string;
}

interface DailyPoint {
	date: string;
	cost: number;
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
			<p className="text-[#22c55e] font-semibold">${(payload[0].value ?? 0).toFixed(4)}</p>
		</div>
	);
}

export default function CostTrendChart({ projectId }: CostTrendChartProps) {
	const [data, setData] = useState<DailyPoint[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);

		Promise.all([
			fetchActivityTimeline(projectId, 14),
			fetchProjectCosts(projectId).catch(() => null),
		])
			.then(([timeline, costs]) => {
				if (cancelled) return;

				// Distribute total cost evenly across active days as a simple trend approximation.
				// This gives a meaningful chart even without per-day cost breakdown from the API.
				const totalCost = costs?.totalCostUsd ?? 0;
				const activeDays = timeline.filter(
					(d) => d.tasksCompleted > 0 || d.runsStarted > 0,
				);
				const totalActivity = activeDays.reduce(
					(s, d) => s + d.tasksCompleted + d.runsStarted,
					0,
				);

				const points: DailyPoint[] = timeline.map((d) => {
					const activity = d.tasksCompleted + d.runsStarted;
					const dayCost =
						totalActivity > 0 ? (activity / totalActivity) * totalCost : 0;
					return {
						date: d.date.slice(5), // MM-DD
						cost: Number(dayCost.toFixed(4)),
					};
				});

				setData(points);
			})
			.catch(() => {
				if (!cancelled) setData([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => { cancelled = true; };
	}, [projectId]);

	if (loading) {
		return <div className="h-[250px] animate-pulse bg-[#1a1a1a] rounded-lg" />;
	}

	const hasData = data.some((d) => d.cost > 0);

	if (!hasData) {
		return (
			<div className="h-[250px] flex items-center justify-center text-[12px] text-[#525252] bg-[#0d0d0d] rounded-lg border border-[#1a1a1a]">
				No cost data yet
			</div>
		);
	}

	return (
		<ResponsiveContainer width="100%" height={250}>
			<LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
				<CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
				<XAxis
					dataKey="date"
					tick={{ fontSize: 10, fill: '#9ca3af' }}
					tickLine={false}
					axisLine={false}
				/>
				<YAxis
					tick={{ fontSize: 10, fill: '#9ca3af' }}
					tickLine={false}
					axisLine={false}
					tickFormatter={(v: number) => `$${v.toFixed(2)}`}
					width={52}
				/>
				<Tooltip content={<CustomTooltip />} cursor={{ stroke: '#262626', strokeWidth: 1 }} />
				<Line
					type="monotone"
					dataKey="cost"
					stroke="#22c55e"
					strokeWidth={1.5}
					dot={{ r: 3, fill: '#22c55e', strokeWidth: 0 }}
					activeDot={{ r: 5, fill: '#22c55e' }}
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}
