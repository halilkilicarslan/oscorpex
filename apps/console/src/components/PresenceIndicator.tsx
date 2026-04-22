// ---------------------------------------------------------------------------
// Oscorpex — PresenceIndicator Component (V6 M6 F11)
// Shows active users in a project as colored avatar circles.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { fetchPresence } from '../lib/studio-api/collaboration.js';
import type { UserPresence } from '../lib/studio-api/collaboration.js';

interface PresenceIndicatorProps {
	projectId: string;
	/** Max avatars to show before "+N more" overflow. Default: 5 */
	maxVisible?: number;
	/** Polling interval in ms. Default: 10000 */
	pollInterval?: number;
	className?: string;
}

const REFRESH_MS = 10_000;
const MAX_VISIBLE = 5;

// ---------------------------------------------------------------------------
// Avatar — single colored circle with tooltip
// ---------------------------------------------------------------------------

interface AvatarProps {
	presence: UserPresence;
}

function Avatar({ presence }: AvatarProps) {
	const [showTooltip, setShowTooltip] = useState(false);
	const initial = presence.displayName.charAt(0).toUpperCase();

	// "Active now" = seen within last 35s (heartbeat is 30s)
	const isActive = Date.now() - presence.lastSeen < 35_000;

	return (
		<div
			className="relative flex-shrink-0"
			onMouseEnter={() => setShowTooltip(true)}
			onMouseLeave={() => setShowTooltip(false)}
		>
			{/* Avatar circle */}
			<div
				className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white select-none cursor-default"
				style={{
					backgroundColor: `${presence.color}22`,
					border: `2px solid ${presence.color}`,
				}}
				aria-label={presence.displayName}
			>
				{initial}
			</div>

			{/* Active pulse dot */}
			{isActive && (
				<span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-[#0a0a0a] animate-pulse" />
			)}

			{/* Tooltip */}
			{showTooltip && (
				<div
					className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
					role="tooltip"
				>
					<div className="bg-[#1a1a1a] border border-[#262626] rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg">
						<p className="font-medium text-white">{presence.displayName}</p>
						{presence.activeTab && (
							<p className="text-neutral-400 mt-0.5">Viewing: {presence.activeTab}</p>
						)}
						{!isActive && (
							<p className="text-neutral-500 mt-0.5">
								Last seen {formatLastSeen(presence.lastSeen)}
							</p>
						)}
					</div>
					{/* Tooltip arrow */}
					<div className="w-2 h-2 bg-[#1a1a1a] border-b border-r border-[#262626] rotate-45 mx-auto -mt-1" />
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Overflow badge — "+N more"
// ---------------------------------------------------------------------------

interface OverflowBadgeProps {
	count: number;
	users: UserPresence[];
}

function OverflowBadge({ count, users }: OverflowBadgeProps) {
	const [showTooltip, setShowTooltip] = useState(false);

	return (
		<div
			className="relative flex-shrink-0"
			onMouseEnter={() => setShowTooltip(true)}
			onMouseLeave={() => setShowTooltip(false)}
		>
			<div
				className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold
					bg-[#1a1a1a] border-2 border-[#262626] text-neutral-400 cursor-default select-none"
			>
				+{count}
			</div>

			{showTooltip && (
				<div
					className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
					role="tooltip"
				>
					<div className="bg-[#1a1a1a] border border-[#262626] rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg">
						<p className="font-medium text-white mb-1">{count} more</p>
						{users.map((u) => (
							<p key={u.userId} className="text-neutral-400">
								{u.displayName}
							</p>
						))}
					</div>
					<div className="w-2 h-2 bg-[#1a1a1a] border-b border-r border-[#262626] rotate-45 mx-auto -mt-1" />
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// PresenceIndicator
// ---------------------------------------------------------------------------

export function PresenceIndicator({
	projectId,
	maxVisible = MAX_VISIBLE,
	pollInterval = REFRESH_MS,
	className = '',
}: PresenceIndicatorProps) {
	const [users, setUsers] = useState<UserPresence[]>([]);
	const [error, setError] = useState(false);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const load = async () => {
		if (!projectId) return;
		try {
			const list = await fetchPresence(projectId);
			setUsers(list);
			setError(false);
		} catch {
			setError(true);
		}
	};

	useEffect(() => {
		if (!projectId) return;
		load();
		intervalRef.current = setInterval(load, pollInterval);
		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId, pollInterval]);

	if (error || users.length === 0) {
		return (
			<div className={`flex items-center gap-1.5 ${className}`}>
				<span className="text-xs text-neutral-600">No active users</span>
			</div>
		);
	}

	const visible = users.slice(0, maxVisible);
	const overflow = users.slice(maxVisible);

	return (
		<div
			className={`flex items-center gap-1 ${className}`}
			aria-label={`${users.length} active user${users.length !== 1 ? 's' : ''}`}
		>
			{visible.map((u) => (
				<Avatar key={u.userId} presence={u} />
			))}
			{overflow.length > 0 && (
				<OverflowBadge count={overflow.length} users={overflow} />
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLastSeen(ts: number): string {
	const diffMs = Date.now() - ts;
	const diffS = Math.floor(diffMs / 1000);
	if (diffS < 60) return `${diffS}s ago`;
	const diffM = Math.floor(diffS / 60);
	if (diffM < 60) return `${diffM}m ago`;
	return `${Math.floor(diffM / 60)}h ago`;
}
