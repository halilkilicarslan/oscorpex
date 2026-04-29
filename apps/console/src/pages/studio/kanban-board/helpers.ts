import type { Task } from "../../../lib/studio-api";

export const PAGE_SIZE = 50;

export const KANBAN_WS_EVENTS = ['task:completed', 'task:failed', 'task:started', 'task:assigned', 'task:retry'];

export const COLUMNS: { key: Task['status']; label: string; color: string }[] = [
	{ key: 'queued', label: 'Queued', color: 'border-[#525252]' },
	{ key: 'assigned', label: 'Assigned', color: 'border-[#3b82f6]' },
	{ key: 'running', label: 'Running', color: 'border-[#f59e0b]' },
	{ key: 'review', label: 'Review', color: 'border-[#a855f7]' },
	{ key: 'revision', label: 'Revision', color: 'border-[#f97316]' },
	{ key: 'waiting_approval', label: 'Awaiting Approval', color: 'border-[#f59e0b]' },
	{ key: 'done', label: 'Done', color: 'border-[#22c55e]' },
	{ key: 'failed', label: 'Failed', color: 'border-[#ef4444]' },
];

export const PIPELINE_STATUS_COLORS: Record<string, string> = {
	idle: 'text-[#525252]',
	running: 'text-[#22c55e]',
	paused: 'text-[#f59e0b]',
	completed: 'text-[#3b82f6]',
	failed: 'text-[#ef4444]',
};

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
	idle: 'Idle',
	running: 'Running',
	paused: 'Paused',
	completed: 'Completed',
	failed: 'Failed',
};
