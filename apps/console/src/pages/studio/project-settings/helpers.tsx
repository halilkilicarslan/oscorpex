// ---------------------------------------------------------------------------
// Project Settings — Shared Helpers & Constants
// ---------------------------------------------------------------------------

import { AlertCircle, TrendingUp } from 'lucide-react';
import type { PolicyAction, WebhookType, WebhookEventType } from '../../../lib/studio-api';

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			onClick={() => onChange(!value)}
			className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
				value ? 'bg-[#22c55e]' : 'bg-[#333333]'
			}`}
		>
			<span
				className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
					value ? 'translate-x-[18px]' : 'translate-x-[3px]'
				}`}
			/>
		</button>
	);
}

export function BudgetStatusBar({
	currentCost,
	maxCost,
	warningThreshold,
}: {
	currentCost: number;
	maxCost: number;
	warningThreshold?: number;
}) {
	const pct = Math.min(100, (currentCost / maxCost) * 100);
	const isError = pct >= 100;
	const warnPct = warningThreshold ? (warningThreshold / maxCost) * 100 : 80;
	const isWarning = !isError && pct >= warnPct;

	const barColor = isError ? 'bg-[#ef4444]' : isWarning ? 'bg-[#f59e0b]' : 'bg-[#22c55e]';
	const textColor = isError ? 'text-[#ef4444]' : isWarning ? 'text-[#f59e0b]' : 'text-[#22c55e]';

	return (
		<div className="mt-3 space-y-1.5">
			<div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
				<div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
			</div>
			<div className="flex items-center justify-between text-[10px]">
				<span className={`font-medium ${textColor}`}>${currentCost.toFixed(4)} harcandi</span>
				<span className="text-[#525252]">Limit: ${maxCost.toFixed(2)} ({Math.round(pct)}%)</span>
			</div>
			{isError && (
				<div className="flex items-center gap-1 text-[10px] text-[#ef4444] bg-[#ef4444]/5 border border-[#ef4444]/20 rounded px-2 py-1">
					<AlertCircle size={10} className="shrink-0" />
					Budget limiti asildi — execution durduruldu
				</div>
			)}
			{isWarning && (
				<div className="flex items-center gap-1 text-[10px] text-[#f59e0b] bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded px-2 py-1">
					<TrendingUp size={10} className="shrink-0" />
					Budget limitine yaklasiliyor — dikkat
				</div>
			)}
		</div>
	);
}

export const WEBHOOK_EVENTS: { value: WebhookEventType; label: string }[] = [
	{ value: 'task_completed', label: 'Task Completed' },
	{ value: 'task_failed', label: 'Task Failed' },
	{ value: 'task_approval_required', label: 'Approval Required' },
	{ value: 'task_approved', label: 'Task Approved' },
	{ value: 'task_rejected', label: 'Task Rejected' },
	{ value: 'pipeline_completed', label: 'Pipeline Completed' },
	{ value: 'execution_error', label: 'Execution Error' },
	{ value: 'budget_warning', label: 'Budget Warning' },
	{ value: 'plan_approved', label: 'Plan Approved' },
	{ value: 'agent_started', label: 'Agent Started' },
	{ value: 'agent_stopped', label: 'Agent Stopped' },
];

export const WEBHOOK_TYPE_LABELS: Record<WebhookType, { label: string; color: string }> = {
	slack: { label: 'Slack', color: '#e879f9' },
	discord: { label: 'Discord', color: '#818cf8' },
	generic: { label: 'Generic', color: '#60a5fa' },
};

export const POLICY_ACTIONS: { value: PolicyAction; label: string; color: string }[] = [
	{ value: 'block', label: 'Block', color: 'text-[#f87171] border-[#7f1d1d] bg-[#450a0a]/40' },
	{ value: 'warn', label: 'Warn', color: 'text-[#fbbf24] border-[#78350f] bg-[#451a03]/40' },
	{ value: 'require_approval', label: 'Require Approval', color: 'text-[#60a5fa] border-[#1e3a8a] bg-[#0c1e3f]/40' },
];

export type ConditionPattern =
	| 'complexity'
	| 'complexity_gte'
	| 'title_contains'
	| 'branch'
	| 'description_contains'
	| 'assigned_agent'
	| 'target_files'
	| 'retry_count';

export const CONDITION_PATTERNS: { value: ConditionPattern; label: string; placeholder: string }[] = [
	{ value: 'complexity', label: 'complexity ==', placeholder: 'S | M | L | XL' },
	{ value: 'complexity_gte', label: 'complexity >=', placeholder: 'M | L | XL' },
	{ value: 'title_contains', label: 'title contains', placeholder: 'auth, migration...' },
	{ value: 'branch', label: 'branch ==', placeholder: 'main, develop...' },
	{ value: 'description_contains', label: 'description contains', placeholder: 'security, hotfix...' },
	{ value: 'assigned_agent', label: 'assigned_agent ==', placeholder: 'agent-id...' },
	{ value: 'target_files', label: 'target_files contains', placeholder: 'src/auth, .env...' },
	{ value: 'retry_count', label: 'retry_count >=', placeholder: '2, 3...' },
];

export const BUILTIN_RULES_INFO: { id: string; name: string; description: string; setting: string }[] = [
	{
		id: 'max_cost_per_task',
		name: 'Max cost per task',
		description: 'Blocks if a single task total cost exceeds the budget ceiling.',
		setting: 'budget.maxCostUsd > 0 iken aktif',
	},
	{
		id: 'require_approval_for_large',
		name: 'Require approval for large tasks',
		description: 'Complexity L veya XL olan tum gorevler onay ister.',
		setting: 'Daima aktif',
	},
	{
		id: 'multi_reviewer',
		name: 'Multi-reviewer for sensitive files',
		description: 'Hassas dosyalara dokunan gorevlerde birden fazla reviewer uyarisi.',
		setting: 'Daima aktif (warn)',
	},
];

export function parseCondition(condition: string): { pattern: ConditionPattern; value: string } {
	const trimmed = condition.trim();
	const complexityGteMatch = trimmed.match(/^complexity\s*>=\s*(.+)$/i);
	if (complexityGteMatch) return { pattern: 'complexity_gte', value: complexityGteMatch[1].trim() };
	const complexityMatch = trimmed.match(/^complexity\s*==\s*(.+)$/i);
	if (complexityMatch) return { pattern: 'complexity', value: complexityMatch[1].trim() };
	const titleMatch = trimmed.match(/^title\s+contains\s+(.+)$/i);
	if (titleMatch) return { pattern: 'title_contains', value: titleMatch[1].trim() };
	const branchMatch = trimmed.match(/^branch\s*==\s*(.+)$/i);
	if (branchMatch) return { pattern: 'branch', value: branchMatch[1].trim() };
	const descMatch = trimmed.match(/^description\s+contains\s+(.+)$/i);
	if (descMatch) return { pattern: 'description_contains', value: descMatch[1].trim() };
	const agentMatch = trimmed.match(/^assigned_agent\s*==\s*(.+)$/i);
	if (agentMatch) return { pattern: 'assigned_agent', value: agentMatch[1].trim() };
	const filesMatch = trimmed.match(/^target_files\s+contains\s+(.+)$/i);
	if (filesMatch) return { pattern: 'target_files', value: filesMatch[1].trim() };
	const retryMatch = trimmed.match(/^retry_count\s*>=\s*(.+)$/i);
	if (retryMatch) return { pattern: 'retry_count', value: retryMatch[1].trim() };
	return { pattern: 'complexity', value: '' };
}

export function buildCondition(pattern: ConditionPattern, value: string): string {
	const v = value.trim();
	switch (pattern) {
		case 'complexity':
			return `complexity == ${v}`;
		case 'complexity_gte':
			return `complexity >= ${v}`;
		case 'title_contains':
			return `title contains ${v}`;
		case 'branch':
			return `branch == ${v}`;
		case 'description_contains':
			return `description contains ${v}`;
		case 'assigned_agent':
			return `assigned_agent == ${v}`;
		case 'target_files':
			return `target_files contains ${v}`;
		case 'retry_count':
			return `retry_count >= ${v}`;
	}
}

export function actionBadgeClass(action: string): string {
	const found = POLICY_ACTIONS.find((a) => a.value === action);
	return found?.color ?? 'text-[#a3a3a3] border-[#262626] bg-[#0a0a0a]';
}

export const TIER_INFO: { key: 'S' | 'M' | 'L' | 'XL'; label: string; description: string }[] = [
	{ key: 'S', label: 'Small', description: 'Classification, intake cleanup, metadata' },
	{ key: 'M', label: 'Medium', description: 'Standard tasks, planner first pass' },
	{ key: 'L', label: 'Large', description: 'Complex tasks, refactor, multi-file' },
	{ key: 'XL', label: 'Extra-L', description: 'Hard repair, high-risk, complex review' },
];

export const ROUTING_DEFAULTS: Record<'S' | 'M' | 'L' | 'XL', string> = {
	S: 'claude-haiku-4-5-20251001',
	M: 'claude-sonnet-4-6',
	L: 'claude-sonnet-4-6',
	XL: 'claude-opus-4-6',
};
