export const BASE = import.meta.env.VITE_API_BASE ?? '';
export const PAGE_SIZE = 50;

export type WorkItemType = 'feature' | 'bug' | 'defect' | 'security' | 'hotfix' | 'improvement';
export type WorkItemStatus = 'open' | 'planned' | 'in_progress' | 'done' | 'closed' | 'wontfix';
export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface WorkItem {
	id: string;
	title: string;
	description?: string;
	type: WorkItemType;
	status: WorkItemStatus;
	priority: Priority;
	labels?: string[];
	source?: string;
	sprintId?: string | null;
	createdAt: string;
}

export interface SprintOption {
	id: string;
	name: string;
	status: string;
}

export const COLUMNS: { key: WorkItemStatus; label: string; color: string }[] = [
	{ key: 'open', label: 'Open', color: 'border-[#525252]' },
	{ key: 'planned', label: 'Planned', color: 'border-[#3b82f6]' },
	{ key: 'in_progress', label: 'In Progress', color: 'border-[#f59e0b]' },
	{ key: 'done', label: 'Done', color: 'border-[#22c55e]' },
	{ key: 'closed', label: 'Closed', color: 'border-[#737373]' },
	{ key: 'wontfix', label: "Won't Fix", color: 'border-[#991b1b]' },
];

export const PRIORITY_COLORS: Record<Priority, string> = {
	critical: 'bg-[#7f1d1d] text-[#fca5a5] border-[#991b1b]',
	high: 'bg-[#7c2d12] text-[#fdba74] border-[#9a3412]',
	medium: 'bg-[#713f12] text-[#fde68a] border-[#854d0e]',
	low: 'bg-[#1a2e1a] text-[#86efac] border-[#166534]',
};

import { Lightbulb, Bug, Shield, Zap, Wrench } from 'lucide-react';

export const TYPE_ICONS: Record<WorkItemType, React.ReactNode> = {
	feature: <Lightbulb size={12} className="text-[#a78bfa]" />,
	bug: <Bug size={12} className="text-[#ef4444]" />,
	defect: <Bug size={12} className="text-[#f97316]" />,
	security: <Shield size={12} className="text-[#38bdf8]" />,
	hotfix: <Zap size={12} className="text-[#f59e0b]" />,
	improvement: <Wrench size={12} className="text-[#22c55e]" />,
};

export interface NewItemForm {
	title: string;
	type: WorkItemType;
	priority: Priority;
	description: string;
}
