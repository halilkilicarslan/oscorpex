import { Suspense, lazy } from 'react';
import { Activity } from 'lucide-react';
import type { AgentAnalytics } from '../../../lib/studio-api';

const AgentTimelineChart = lazy(() => import('../charts/AgentTimelineChart'));

interface AgentTimelinePanelProps {
	projectId: string;
	agents: AgentAnalytics[];
	selectedAgentId: string;
	onSelectAgent: (agentId: string) => void;
}

export default function AgentTimelinePanel({
	projectId,
	agents,
	selectedAgentId,
	onSelectAgent,
}: AgentTimelinePanelProps) {
	if (agents.length === 0) return null;

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
			<div className="flex items-center gap-2 mb-4">
				<Activity size={14} className="text-[#3b82f6]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Agent Timeline</h3>
				<div className="ml-auto">
					<select
						value={selectedAgentId}
						onChange={(e) => onSelectAgent(e.target.value)}
						className="appearance-none bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1 text-[11px] text-[#e5e5e5] focus:outline-none focus:border-[#22c55e]/50"
					>
						{agents.map((a) => (
							<option key={a.agentId} value={a.agentId}>
								{a.agentName}
							</option>
						))}
					</select>
				</div>
			</div>
			<Suspense fallback={<div className="h-[250px] animate-pulse bg-[#1a1a1a] rounded-lg" />}>
				{selectedAgentId && (
					<AgentTimelineChart projectId={projectId} agentId={selectedAgentId} />
				)}
			</Suspense>
			<div className="flex items-center gap-4 mt-3">
				<div className="flex items-center gap-1.5">
					<div className="w-2 h-2 rounded-full bg-[#22c55e]" />
					<span className="text-[10px] text-[#525252]">Tokens used</span>
				</div>
				<div className="flex items-center gap-1.5">
					<div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
					<span className="text-[10px] text-[#525252]">Cost (USD)</span>
				</div>
			</div>
		</div>
	);
}
