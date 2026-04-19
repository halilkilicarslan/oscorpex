// ---------------------------------------------------------------------------
// Oscorpex — NotificationBell (V6 M1)
// TopBar bell icon with dropdown panel showing recent notifications.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, Trash2, X } from 'lucide-react';
import {
	deleteNotification,
	fetchNotifications,
	fetchUnreadNotificationCount,
	markAllNotificationsRead,
	markNotificationRead,
	type AppNotification,
} from '../lib/studio-api';
import { useWsEventRefresh } from '../hooks/useWsEventRefresh';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

const TYPE_COLORS: Record<string, string> = {
	task_completed: 'text-[#22c55e]',
	task_failed: 'text-[#ef4444]',
	pipeline_completed: 'text-[#3b82f6]',
	review_requested: 'text-[#f59e0b]',
	system: 'text-[#a3a3a3]',
};

const TYPE_ICONS: Record<string, string> = {
	task_completed: '✓',
	task_failed: '✕',
	pipeline_completed: '⚡',
	review_requested: '👁',
	system: '•',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NotificationBellProps {
	/** Optional project scope — if given, only shows notifications for that project */
	projectId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotificationBell({ projectId }: NotificationBellProps) {
	const [unreadCount, setUnreadCount] = useState(0);
	const [notifications, setNotifications] = useState<AppNotification[]>([]);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	// Unread count polling (light-weight)
	const loadUnreadCount = useCallback(async () => {
		try {
			const count = await fetchUnreadNotificationCount(projectId);
			setUnreadCount(count);
		} catch {
			// silently ignore
		}
	}, [projectId]);

	// Full notification list (only when panel is open)
	const loadNotifications = useCallback(async () => {
		setLoading(true);
		try {
			const items = await fetchNotifications({ projectId, limit: 10 });
			setNotifications(items);
			const count = items.filter((n) => !n.read).length;
			setUnreadCount(count);
		} catch {
			// silently ignore
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	// Initial load + polling every 30s
	useEffect(() => {
		loadUnreadCount();
		const interval = setInterval(loadUnreadCount, 30_000);
		return () => clearInterval(interval);
	}, [loadUnreadCount]);

	// Reload when panel opens
	useEffect(() => {
		if (open) loadNotifications();
	}, [open, loadNotifications]);

	// Real-time refresh via WebSocket
	useWsEventRefresh(
		projectId ?? '__global__',
		['task:completed', 'task:failed', 'pipeline:completed'],
		() => {
			loadUnreadCount();
			if (open) loadNotifications();
		},
		{ debounceMs: 800, enabled: true },
	);

	// Close on outside click
	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (
				panelRef.current &&
				!panelRef.current.contains(e.target as Node) &&
				buttonRef.current &&
				!buttonRef.current.contains(e.target as Node)
			) {
				setOpen(false);
			}
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [open]);

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	async function handleMarkRead(id: string) {
		await markNotificationRead(id).catch(() => null);
		setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
		setUnreadCount((c) => Math.max(0, c - 1));
	}

	async function handleDelete(id: string) {
		const wasUnread = notifications.find((n) => n.id === id)?.read === false;
		await deleteNotification(id).catch(() => null);
		setNotifications((prev) => prev.filter((n) => n.id !== id));
		if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
	}

	async function handleMarkAllRead() {
		await markAllNotificationsRead(projectId).catch(() => null);
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
		setUnreadCount(0);
	}

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	return (
		<div className="relative">
			{/* Bell Button */}
			<button
				ref={buttonRef}
				onClick={() => setOpen((o) => !o)}
				aria-label="Notifications"
				className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[#a3a3a3] hover:text-[#fafafa] hover:bg-[#262626] transition-colors"
			>
				<Bell size={16} />
				{unreadCount > 0 && (
					<span
						aria-label={`${unreadCount} unread notifications`}
						className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#ef4444] text-white text-[9px] font-bold flex items-center justify-center leading-none"
					>
						{unreadCount > 99 ? '99+' : unreadCount}
					</span>
				)}
			</button>

			{/* Dropdown Panel */}
			{open && (
				<div
					ref={panelRef}
					className="absolute right-0 top-10 w-80 bg-[#111111] border border-[#262626] rounded-xl shadow-2xl z-50 overflow-hidden"
				>
					{/* Header */}
					<div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
						<span className="text-[13px] font-semibold text-[#fafafa]">Notifications</span>
						<div className="flex items-center gap-2">
							{unreadCount > 0 && (
								<button
									onClick={handleMarkAllRead}
									className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[#a3a3a3] hover:text-[#22c55e] hover:bg-[#1a2a1a] transition-colors"
									title="Mark all as read"
								>
									<CheckCheck size={12} />
									All read
								</button>
							)}
							<button
								onClick={() => setOpen(false)}
								className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
							>
								<X size={14} />
							</button>
						</div>
					</div>

					{/* List */}
					<div className="max-h-80 overflow-y-auto scrollbar-none">
						{loading ? (
							<div className="flex items-center justify-center py-8">
								<div className="w-5 h-5 border-2 border-[#262626] border-t-[#22c55e] rounded-full animate-spin" />
							</div>
						) : notifications.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8 gap-2">
								<Bell size={24} className="text-[#333]" />
								<span className="text-[12px] text-[#525252]">No notifications yet</span>
							</div>
						) : (
							notifications.map((n) => (
								<div
									key={n.id}
									className={`flex gap-3 px-4 py-3 border-b border-[#1a1a1a] last:border-0 transition-colors ${
										n.read ? 'opacity-60' : 'bg-[#141420]'
									}`}
								>
									{/* Icon */}
									<div
										className={`shrink-0 w-6 h-6 rounded-full bg-[#1a1a1a] flex items-center justify-center text-[11px] ${
											TYPE_COLORS[n.type] ?? 'text-[#a3a3a3]'
										}`}
									>
										{TYPE_ICONS[n.type] ?? '•'}
									</div>

									{/* Content */}
									<div className="flex-1 min-w-0">
										<p className="text-[12px] font-medium text-[#e5e5e5] truncate">{n.title}</p>
										{n.body && (
											<p className="text-[11px] text-[#737373] mt-0.5 line-clamp-2">{n.body}</p>
										)}
										<p className="text-[10px] text-[#525252] mt-1">{timeAgo(n.createdAt)}</p>
									</div>

									{/* Actions */}
									<div className="flex flex-col items-center gap-1 shrink-0">
										{!n.read && (
											<button
												onClick={() => handleMarkRead(n.id)}
												title="Mark as read"
												className="text-[#525252] hover:text-[#22c55e] transition-colors"
											>
												<Check size={13} />
											</button>
										)}
										<button
											onClick={() => handleDelete(n.id)}
											title="Delete"
											className="text-[#525252] hover:text-[#ef4444] transition-colors"
										>
											<Trash2 size={12} />
										</button>
									</div>
								</div>
							))
						)}
					</div>

					{/* Footer */}
					{notifications.length > 0 && (
						<div className="px-4 py-2 border-t border-[#1a1a1a]">
							<p className="text-[10px] text-[#525252] text-center">
								Showing last {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
