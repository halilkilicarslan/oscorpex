// ---------------------------------------------------------------------------
// Oscorpex — useCollaboration Hook (V6 M6 F11)
// Manages presence lifecycle: join on mount, heartbeat, leave on unmount.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import {
	fetchPresence,
	joinProject,
	leaveProject,
	sendHeartbeat,
	updatePresence,
} from '../lib/studio-api/collaboration.js';
import type { UserPresence, JoinRequest } from '../lib/studio-api/collaboration.js';

export interface CollaborationUser {
	userId: string;
	displayName: string;
	avatar?: string;
	activeTab?: string;
}

export interface UseCollaborationReturn {
	presenceList: UserPresence[];
	isJoined: boolean;
	myPresence: UserPresence | null;
	join: () => Promise<void>;
	leave: () => Promise<void>;
	updateTab: (activeTab: string) => Promise<void>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const REFRESH_INTERVAL_MS = 10_000;

export function useCollaboration(projectId: string, user: CollaborationUser): UseCollaborationReturn {
	const [presenceList, setPresenceList] = useState<UserPresence[]>([]);
	const [isJoined, setIsJoined] = useState(false);
	const [myPresence, setMyPresence] = useState<UserPresence | null>(null);

	const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const joinedRef = useRef(false);

	// ---------------------------------------------------------------------------
	// Fetch presence list
	// ---------------------------------------------------------------------------

	const refreshPresence = useCallback(async () => {
		if (!projectId) return;
		try {
			const list = await fetchPresence(projectId);
			setPresenceList(list);
		} catch {
			// Silently ignore refresh errors — stale data is acceptable
		}
	}, [projectId]);

	// ---------------------------------------------------------------------------
	// Join
	// ---------------------------------------------------------------------------

	const join = useCallback(async () => {
		if (joinedRef.current || !projectId || !user.userId) return;
		try {
			const data: JoinRequest = {
				projectId,
				userId: user.userId,
				displayName: user.displayName,
				avatar: user.avatar,
				activeTab: user.activeTab,
			};
			const result = await joinProject(data);
			setMyPresence(result.presence);
			setIsJoined(true);
			joinedRef.current = true;

			// Optimistic update — add self to list
			setPresenceList((prev) => {
				const without = prev.filter((p) => p.userId !== user.userId);
				return [...without, result.presence];
			});
		} catch (err) {
			console.warn('[useCollaboration] join failed:', err);
		}
	}, [projectId, user]);

	// ---------------------------------------------------------------------------
	// Leave
	// ---------------------------------------------------------------------------

	const leave = useCallback(async () => {
		if (!joinedRef.current || !projectId || !user.userId) return;
		try {
			await leaveProject({ projectId, userId: user.userId });
		} catch {
			// Best-effort
		} finally {
			setIsJoined(false);
			setMyPresence(null);
			joinedRef.current = false;
			// Optimistic update — remove self from list
			setPresenceList((prev) => prev.filter((p) => p.userId !== user.userId));
		}
	}, [projectId, user.userId]);

	// ---------------------------------------------------------------------------
	// Update active tab
	// ---------------------------------------------------------------------------

	const updateTab = useCallback(
		async (activeTab: string) => {
			if (!joinedRef.current || !projectId || !user.userId) return;
			try {
				const result = await updatePresence({ projectId, userId: user.userId, activeTab });
				setMyPresence(result.presence);
				// Optimistic update
				setPresenceList((prev) => prev.map((p) => (p.userId === user.userId ? result.presence : p)));
			} catch (err) {
				console.warn('[useCollaboration] updateTab failed:', err);
			}
		},
		[projectId, user.userId],
	);

	// ---------------------------------------------------------------------------
	// Heartbeat loop
	// ---------------------------------------------------------------------------

	const startHeartbeat = useCallback(() => {
		if (heartbeatRef.current) clearInterval(heartbeatRef.current);
		heartbeatRef.current = setInterval(async () => {
			if (!joinedRef.current) return;
			try {
				const result = await sendHeartbeat({ projectId, userId: user.userId });
				if (result.rejoin) {
					// Session expired — re-join
					joinedRef.current = false;
					setIsJoined(false);
					await join();
				}
			} catch {
				// Silently ignore heartbeat errors
			}
		}, HEARTBEAT_INTERVAL_MS);
	}, [projectId, user.userId, join]);

	// ---------------------------------------------------------------------------
	// Presence refresh loop
	// ---------------------------------------------------------------------------

	const startRefresh = useCallback(() => {
		if (refreshRef.current) clearInterval(refreshRef.current);
		refreshRef.current = setInterval(refreshPresence, REFRESH_INTERVAL_MS);
	}, [refreshPresence]);

	// ---------------------------------------------------------------------------
	// Lifecycle: mount → join + start loops; unmount → leave + stop loops
	// ---------------------------------------------------------------------------

	useEffect(() => {
		if (!projectId || !user.userId) return;

		join().then(() => {
			refreshPresence();
			startHeartbeat();
			startRefresh();
		});

		return () => {
			// Stop intervals
			if (heartbeatRef.current) clearInterval(heartbeatRef.current);
			if (refreshRef.current) clearInterval(refreshRef.current);
			// Leave — fire and forget (cleanup must be sync-safe)
			if (joinedRef.current) {
				leaveProject({ projectId, userId: user.userId }).catch(() => {});
				joinedRef.current = false;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId, user.userId]);

	return { presenceList, isJoined, myPresence, join, leave, updateTab };
}
