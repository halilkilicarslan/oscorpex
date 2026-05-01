import type { ProjectPlan, PlanCostEstimate } from "../../../lib/studio-api";

export function getCostColor(cost: number): string {
	if (cost < 0.5) return '#22c55e';
	if (cost < 1.0) return '#f59e0b';
	return '#ef4444';
}

export function getCostBgColor(cost: number): string {
	if (cost < 0.5) return 'bg-[#22c55e]/10 border-[#22c55e]/20';
	if (cost < 1.0) return 'bg-[#f59e0b]/10 border-[#f59e0b]/20';
	return 'bg-[#ef4444]/10 border-[#ef4444]/20';
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export interface PhaseCostRow {
	name: string;
	taskCount: number;
	tokens: number;
	cost: number;
}

export function buildPhaseBreakdown(plan: ProjectPlan, estimate: PlanCostEstimate): PhaseCostRow[] {
	const tokensPerTask = estimate.avgTokensPerTask;
	const costPerTask = estimate.taskCount > 0 ? estimate.estimatedCost / estimate.taskCount : 0;

	return plan.phases
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((phase) => ({
			name: phase.name,
			taskCount: phase.tasks.length,
			tokens: phase.tasks.length * tokensPerTask,
			cost: phase.tasks.length * costPerTask,
		}));
}

export interface AgentCostRow {
	agent: string;
	agentKey: string;
	taskCount: number;
	tokens: number;
	cost: number;
}

export function buildAgentBreakdown(
	plan: ProjectPlan,
	estimate: PlanCostEstimate,
	resolveAgentName?: (task: { assignedAgent: string; assignedAgentId?: string }) => string,
): AgentCostRow[] {
	const tokensPerTask = estimate.avgTokensPerTask;
	const costPerTask = estimate.taskCount > 0 ? estimate.estimatedCost / estimate.taskCount : 0;

	const agentMap = new Map<string, { label: string; taskCount: number }>();
	for (const phase of plan.phases) {
		for (const task of phase.tasks) {
			const key = task.assignedAgentId || task.assignedAgent || 'unassigned';
			const label = resolveAgentName
				? resolveAgentName({ assignedAgent: task.assignedAgent, assignedAgentId: task.assignedAgentId })
				: task.assignedAgent || 'unassigned';
			const existing = agentMap.get(key) ?? { label, taskCount: 0 };
			agentMap.set(key, { label, taskCount: existing.taskCount + 1 });
		}
	}

	return Array.from(agentMap.entries())
		.map(([agentKey, { label, taskCount }]) => ({
			agent: label,
			agentKey,
			taskCount,
			tokens: taskCount * tokensPerTask,
			cost: taskCount * costPerTask,
		}))
		.sort((a, b) => b.cost - a.cost);
}
