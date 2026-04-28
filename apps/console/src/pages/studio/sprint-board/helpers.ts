// ---------------------------------------------------------------------------
// Sprint Board — Constants & Helpers
// ---------------------------------------------------------------------------

export type SprintStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export const STATUS_BADGE: Record<SprintStatus, string> = {
	planned: 'bg-[#1e3a5f] text-[#93c5fd] border-[#2563eb]',
	active: 'bg-[#052e16] text-[#86efac] border-[#166534]',
	completed: 'bg-[#1a1a1a] text-[#a3a3a3] border-[#262626]',
	cancelled: 'bg-[#450a0a] text-[#fca5a5] border-[#991b1b]',
};

export const ITEM_STATUS_COLORS: Record<string, string> = {
	open: 'text-[#525252]',
	planned: 'text-[#3b82f6]',
	in_progress: 'text-[#f59e0b]',
	done: 'text-[#22c55e]',
};

export function defaultSprintDates(): { startDate: string; endDate: string } {
	const start = new Date();
	const end = new Date(start);
	end.setDate(end.getDate() + 14);
	return {
		startDate: start.toISOString().slice(0, 10),
		endDate: end.toISOString().slice(0, 10),
	};
}

export function formatDate(d?: string) {
	return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}
