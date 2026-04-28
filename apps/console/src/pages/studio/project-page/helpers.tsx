import type React from 'react';
import {
	MessageSquare,
	Users,
	Kanban,
	Eye,
	FolderTree,
	Activity,
	Inbox,
	BarChart3,
	Terminal,
	Settings,
	Package,
	CalendarDays,
	Users2,
	FileBarChart,
	Cpu,
} from 'lucide-react';

export const APP_STATUS_WS_EVENTS = ['execution:started', 'pipeline:completed'];
export const UNREAD_COUNT_WS_EVENTS = ['message:created'];

export type BoardView = 'kanban' | 'pipeline';

export type Tab =
	| 'chat'
	| 'team'
	| 'board'
	| 'preview'
	| 'files'
	| 'events'
	| 'messages'
	| 'dashboard'
	| 'logs'
	| 'diff'
	| 'settings'
	| 'backlog'
	| 'sprint'
	| 'ceremonies'
	| 'report'
	| 'agentic';

export const STATIC_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
	{ id: 'chat', label: 'Planner', icon: <MessageSquare size={16} /> },
	{ id: 'team', label: 'Team', icon: <Users size={16} /> },
	{ id: 'board', label: 'Board', icon: <Kanban size={16} /> },
	{ id: 'preview', label: 'Preview', icon: <Eye size={16} /> },
	{ id: 'files', label: 'Files', icon: <FolderTree size={16} /> },
	{ id: 'events', label: 'Events', icon: <Activity size={16} /> },
	{ id: 'messages', label: 'Messages', icon: <Inbox size={16} /> },
	{ id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={16} /> },
	{ id: 'logs', label: 'Logs', icon: <Terminal size={16} /> },
	{ id: 'diff', label: 'Diff', icon: <Settings size={16} /> },
	{ id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
	{ id: 'backlog', label: 'Backlog', icon: <Package size={16} /> },
	{ id: 'sprint', label: 'Sprint', icon: <CalendarDays size={16} /> },
	{ id: 'ceremonies', label: 'Ceremonies', icon: <Users2 size={16} /> },
	{ id: 'report', label: 'Report', icon: <FileBarChart size={16} /> },
	{ id: 'agentic', label: 'Agentic', icon: <Cpu size={16} /> },
];

export function TabLoader() {
	return (
		<div className="flex items-center justify-center h-64">
			<div className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
		</div>
	);
}
