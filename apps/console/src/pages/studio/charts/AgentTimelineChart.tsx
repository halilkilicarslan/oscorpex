// ---------------------------------------------------------------------------
// AgentTimelineChart — Agent performance over time using Recharts AreaChart
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	ResponsiveContainer,
} from 'recharts';
import { fetchAgentTimeline, type AgentPerformancePoint } from '../../../lib/studio-api';

interface AgentTimelineChartProps {
	projectId: string;
	agentId: string;
}

interface CustomTooltipProps {
	active?: boolean;
	payload?: Array<{ name: string; value: number; color: string }>;
	label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
	if (!active || !payload?.length) return null;
	return (
		<div className="bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-[11px] space-y-1">
			<p className="text-[#737373] mb-1">{label}</p>
			{payload.map((p) => (
				<p key={p.name} style={{ color: p.color }} className="font-semibold">
					{p.name === 'tokensUsed'
						? `${(p.value / 1000).toFixed(1)}K tokens`
						: `$${p.value.toFixed(4)}`}
				</p>
			))}
		</div>
	);
}

export default function AgentTimelineChart({ projectId, agentId }: AgentTimelineChartProps) {
	const [data, setData] = useState<AgentPerformancePoint[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!agentId) return;
		let cancelled = false;
		setLoading(true);
		fetchAgentTimeline(projectId, agentId, 14)
			.then((points) => {
				if (!cancelled) setData(points);
			})
			.catch(() => {
				if (!cancelled) setData([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => { cancelled = true; };
	}, [projectId, agentId]);

	if (loading) {
		return <div className="h-[250px] animate-pulse bg-[#1a1a1a] rounded-lg" />;
	}

	const hasData = data.some((d) => d.tokensUsed > 0 || d.costUsd > 0);

	if (!hasData) {
		return (
			<div className="h-[250px] flex items-center justify-center text-[12px] text-[#525252] bg-[#0d0d0d] rounded-lg border border-[#1a1a1a]">
				No timeline data yet
			</div>
		);
	}

	const chartData = data.map((d) => ({
		date: d.date.slice(5),
		tokensUsed: d.tokensUsed,
		costUsd: d.costUsd,
	}));

	return (
		<ResponsiveContainer width="100%" height={250}>
			<AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
				<defs>
					<linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
						<stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
					</linearGradient>
					<linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
						<stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
					</linearGradient>
				</defs>
				<CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
				<XAxis
					dataKey="date"
					tick={{ fontSize: 10, fill: '#9ca3af' }}
					tickLine={false}
					axisLine={false}
				/>
				<YAxis
					yAxisId="tokens"
					tick={{ fontSize: 10, fill: '#9ca3af' }}
					tickLine={false}
					axisLine={false}
					tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
					width={36}
				/>
				<YAxis
					yAxisId="cost"
					orientation="right"
					tick={{ fontSize: 10, fill: '#9ca3af' }}
					tickLine={false}
					axisLine={false}
					tickFormatter={(v: number) => `$${v.toFixed(2)}`}
					width={44}
				/>
				<Tooltip content={<CustomTooltip />} cursor={{ stroke: '#262626', strokeWidth: 1 }} />
				<Area
					yAxisId="tokens"
					type="monotone"
					dataKey="tokensUsed"
					stroke="#22c55e"
					strokeWidth={1.5}
					fill="url(#tokenGrad)"
					dot={false}
					activeDot={{ r: 4, fill: '#22c55e' }}
				/>
				<Area
					yAxisId="cost"
					type="monotone"
					dataKey="costUsd"
					stroke="#3b82f6"
					strokeWidth={1.5}
					fill="url(#costGrad)"
					dot={false}
					activeDot={{ r: 4, fill: '#3b82f6' }}
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}
