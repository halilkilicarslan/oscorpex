import {
	AlertTriangle,
	Zap,
	Shield,
	CheckCircle,
	Brain,
	Users,
	Clock,
} from 'lucide-react';
import type { PlatformAnalytics } from '../../lib/studio-api';

export const COLORS = [
	'#3b82f6',
	'#8b5cf6',
	'#10b981',
	'#f59e0b',
	'#ef4444',
	'#06b6d4',
	'#ec4899',
	'#84cc16',
];

export interface Insight {
	icon: React.ReactNode;
	severity: 'positive' | 'warning' | 'critical' | 'neutral';
	metric: string;
	evidence: string;
	action: string;
	roi: string;
}

export const SEV_STYLES = {
	positive: {
		border: 'border-[#22c55e]/30',
		bg: 'bg-[#22c55e]/5',
		badge: 'bg-[#22c55e]/15 text-[#22c55e]',
		label: 'Great',
	},
	warning: {
		border: 'border-[#f59e0b]/30',
		bg: 'bg-[#f59e0b]/5',
		badge: 'bg-[#f59e0b]/15 text-[#f59e0b]',
		label: 'Warning',
	},
	critical: {
		border: 'border-[#ef4444]/30',
		bg: 'bg-[#ef4444]/5',
		badge: 'bg-[#ef4444]/15 text-[#ef4444]',
		label: 'Fix Now',
	},
	neutral: {
		border: 'border-[#3b82f6]/30',
		bg: 'bg-[#3b82f6]/5',
		badge: 'bg-[#3b82f6]/15 text-[#3b82f6]',
		label: 'Info',
	},
};

export function generateInsights(d: PlatformAnalytics): Insight[] {
	const ins: Insight[] = [];
	const t = d.totals;

	if (t.totalTasks >= 5) {
		if (t.failureRate > 15) {
			ins.push({
				icon: <AlertTriangle size={16} className="text-[#ef4444]" />,
				severity: 'critical',
				metric: `${t.failureRate}% failure rate`,
				evidence: `${t.tasksFailed} out of ${t.totalTasks} tasks failed.`,
				action: 'Reduce task complexity or tune review loops to lower failure rates.',
				roi: `Saves re-run costs for ${t.tasksFailed} failed tasks.`,
			});
		} else if (t.failureRate < 5) {
			ins.push({
				icon: <CheckCircle size={16} className="text-[#22c55e]" />,
				severity: 'positive',
				metric: `Only ${t.failureRate}% failure rate`,
				evidence: `${t.tasksDone} tasks completed successfully. Almost every task passed on the first run.`,
				action: 'Keep up the great work.',
				roi: 'Low failure rate = fewer re-runs = lower costs.',
			});
		}
	}

	if (t.cacheRate > 0) {
		if (t.cacheRate > 80) {
			ins.push({
				icon: <Zap size={16} className="text-[#22c55e]" />,
				severity: 'positive',
				metric: `${t.cacheRate}% cache hit — excellent token savings`,
				evidence: 'Most tokens are served from cache. Cost optimization is ideal.',
				action: 'Keep this pattern. The context packet system is working correctly.',
				roi: 'Cache enables 90%+ cost savings.',
			});
		} else if (t.cacheRate < 40) {
			ins.push({
				icon: <Brain size={16} className="text-[#f59e0b]" />,
				severity: 'warning',
				metric: `Only ${t.cacheRate}% cache hit`,
				evidence: 'Most tokens go directly to the API. Cache usage is low.',
				action: 'Group tasks on similar files to increase cache hit rate.',
				roi: 'Every 10% cache increase reduces costs by ~8%.',
			});
		}
	}

	if (t.totalEvents >= 20) {
		if (t.errorRate > 10) {
			ins.push({
				icon: <Shield size={16} className="text-[#ef4444]" />,
				severity: 'critical',
				metric: `${t.errorRate}% event error rate`,
				evidence: `${t.totalErrors} errors in ${t.totalEvents} events. Too many failed events.`,
				action: 'Investigate recurring error patterns and resolve root causes.',
				roi: `Fixing these errors saves an estimated ${Math.round(t.totalErrors * 0.5)} minutes.`,
			});
		} else if (t.errorRate < 3) {
			ins.push({
				icon: <Shield size={16} className="text-[#22c55e]" />,
				severity: 'positive',
				metric: `Only ${t.errorRate}% error rate — very clean`,
				evidence: `${t.totalErrors} errors in ${t.totalEvents} events. Almost everything works on the first try.`,
				action: 'Maintain this quality level.',
				roi: 'Clean runs = less debug time = faster results.',
			});
		}
	}

	if (t.uniqueAgents >= 6 && t.totalProjects >= 1) {
		ins.push({
			icon: <Users size={16} className="text-[#3b82f6]" />,
			severity: 'positive',
			metric: `${t.uniqueAgents} different agents active`,
			evidence: 'The Scrum team is running at full capacity. Each agent handles tasks in its area of expertise.',
			action: 'Track agent scores and optimize low-performing agents.',
			roi: 'Specialized agents can improve overall success rate by 15-20%.',
		});
	}

	if (t.avgTaskMin > 0) {
		if (t.avgTaskMin > 10) {
			ins.push({
				icon: <Clock size={16} className="text-[#f59e0b]" />,
				severity: 'warning',
				metric: `Average task duration ${t.avgTaskMin}min`,
				evidence: `Tasks take ${t.avgTaskMin} minutes on average. This may be a bit high.`,
				action: 'Try decomposing XL tasks into micro-tasks for parallel execution.',
				roi: 'Task decomposition can reduce total time by 30-40%.',
			});
		} else if (t.avgTaskMin < 4 && t.totalTasks >= 5) {
			ins.push({
				icon: <Zap size={16} className="text-[#22c55e]" />,
				severity: 'positive',
				metric: `Average ${t.avgTaskMin}min — very fast task completion`,
				evidence: 'Tasks complete quickly. Model routing and complexity sizing are working well.',
				action: 'Maintain this speed level.',
				roi: 'Fast task completion = less CLI usage time = lower costs.',
			});
		}
	}

	return ins;
}
