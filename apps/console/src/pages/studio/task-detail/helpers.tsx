// ---------------------------------------------------------------------------
// Task Detail Modal — Constants & Helpers
// ---------------------------------------------------------------------------

import { Clock, Loader2, CheckCircle2, XCircle, Eye, AlertCircle, RotateCw, ShieldAlert } from 'lucide-react';
import type { Task } from '../../../lib/studio-api';

export const STATUS_ICON: Record<Task['status'], React.ReactNode> = {
	queued: <Clock size={14} className="text-[#525252]" />,
	assigned: <AlertCircle size={14} className="text-[#3b82f6]" />,
	running: <Loader2 size={14} className="text-[#f59e0b] animate-spin" />,
	review: <Eye size={14} className="text-[#a855f7]" />,
	revision: <RotateCw size={14} className="text-[#f97316]" />,
	waiting_approval: <ShieldAlert size={14} className="text-[#f59e0b]" />,
	done: <CheckCircle2 size={14} className="text-[#22c55e]" />,
	failed: <XCircle size={14} className="text-[#ef4444]" />,
};

export const STATUS_LABEL: Record<Task['status'], string> = {
	queued: 'Sirada',
	assigned: 'Atandi',
	running: 'Calisiyor',
	review: 'Inceleme',
	revision: 'Revizyon',
	waiting_approval: 'Onay Bekliyor',
	done: 'Tamamlandi',
	failed: 'Hata',
};

export const STATUS_COLOR: Record<Task['status'], string> = {
	queued: 'bg-[#262626] text-[#525252]',
	assigned: 'bg-[#3b82f6]/10 text-[#3b82f6]',
	running: 'bg-[#f59e0b]/10 text-[#f59e0b]',
	review: 'bg-[#a855f7]/10 text-[#a855f7]',
	revision: 'bg-[#f97316]/10 text-[#f97316]',
	waiting_approval: 'bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/30',
	done: 'bg-[#22c55e]/10 text-[#22c55e]',
	failed: 'bg-[#ef4444]/10 text-[#ef4444]',
};

export const COMPLEXITY_COLORS: Record<string, string> = {
	S: 'bg-[#22c55e]/10 text-[#22c55e]',
	M: 'bg-[#f59e0b]/10 text-[#f59e0b]',
	L: 'bg-[#ef4444]/10 text-[#ef4444]',
	XL: 'bg-[#ef4444]/10 text-[#ef4444]',
};

export function formatDate(iso?: string): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return d.toLocaleString('tr-TR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

export function formatDuration(startedAt?: string, completedAt?: string): string {
	if (!startedAt) return '—';
	const start = new Date(startedAt).getTime();
	const end = completedAt ? new Date(completedAt).getTime() : Date.now();
	const sec = Math.floor((end - start) / 1000);
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}d ${sec % 60}s`;
	return `${Math.floor(sec / 3600)}s ${Math.floor((sec % 3600) / 60)}d`;
}
