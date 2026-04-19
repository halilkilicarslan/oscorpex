// ---------------------------------------------------------------------------
// Oscorpex — Collaboration Service (V6 M6 F11)
// In-memory presence tracking for multi-user real-time collaboration.
// ---------------------------------------------------------------------------

export interface UserPresence {
	userId: string;
	displayName: string;
	avatar?: string;
	projectId: string;
	activeTab?: string;
	lastSeen: number; // Unix timestamp ms
	color: string;
}

// ---------------------------------------------------------------------------
// Color palette — auto-assigned on join, unique per project
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
	"#22c55e", // green
	"#3b82f6", // blue
	"#f59e0b", // amber
	"#ec4899", // pink
	"#8b5cf6", // violet
	"#06b6d4", // cyan
	"#f97316", // orange
	"#ef4444", // red
	"#10b981", // emerald
	"#a855f7", // purple
	"#eab308", // yellow
	"#14b8a6", // teal
];

const DEFAULT_STALE_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// CollaborationService
// ---------------------------------------------------------------------------

export class CollaborationService {
	// projectId → userId → UserPresence
	private readonly _presence = new Map<string, Map<string, UserPresence>>();

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private _getOrCreateProject(projectId: string): Map<string, UserPresence> {
		let project = this._presence.get(projectId);
		if (!project) {
			project = new Map();
			this._presence.set(projectId, project);
		}
		return project;
	}

	/** Pick next available color for the project (round-robin by user count) */
	private _assignColor(projectId: string): string {
		const project = this._presence.get(projectId);
		const usedColors = new Set(project ? [...project.values()].map((u) => u.color) : []);
		// Find first unused color in palette
		for (const color of COLOR_PALETTE) {
			if (!usedColors.has(color)) return color;
		}
		// All colors used — cycle by current user count
		const idx = (project?.size ?? 0) % COLOR_PALETTE.length;
		return COLOR_PALETTE[idx];
	}

	// ---------------------------------------------------------------------------
	// Core API
	// ---------------------------------------------------------------------------

	/**
	 * Join a project — adds user presence.
	 * If user is already present (reconnect), updates lastSeen and returns existing entry.
	 */
	join(
		projectId: string,
		user: Omit<UserPresence, "projectId" | "lastSeen" | "color"> & { color?: string },
	): UserPresence {
		const project = this._getOrCreateProject(projectId);

		// If already present, refresh lastSeen
		const existing = project.get(user.userId);
		if (existing) {
			existing.lastSeen = Date.now();
			if (user.activeTab !== undefined) existing.activeTab = user.activeTab;
			if (user.displayName) existing.displayName = user.displayName;
			if (user.avatar !== undefined) existing.avatar = user.avatar;
			return existing;
		}

		const presence: UserPresence = {
			userId: user.userId,
			displayName: user.displayName,
			avatar: user.avatar,
			projectId,
			activeTab: user.activeTab,
			lastSeen: Date.now(),
			color: user.color ?? this._assignColor(projectId),
		};

		project.set(user.userId, presence);
		return presence;
	}

	/**
	 * Leave a project — removes user presence.
	 * Returns true if user was present, false otherwise.
	 */
	leave(projectId: string, userId: string): boolean {
		const project = this._presence.get(projectId);
		if (!project) return false;

		const removed = project.delete(userId);

		// Clean up empty project map
		if (project.size === 0) {
			this._presence.delete(projectId);
		}

		return removed;
	}

	/**
	 * Update presence data for a user (tab, cursor, etc.)
	 * Also refreshes lastSeen.
	 */
	updatePresence(
		projectId: string,
		userId: string,
		data: Partial<Pick<UserPresence, "activeTab" | "avatar" | "displayName">>,
	): UserPresence | null {
		const project = this._presence.get(projectId);
		if (!project) return null;

		const presence = project.get(userId);
		if (!presence) return null;

		if (data.activeTab !== undefined) presence.activeTab = data.activeTab;
		if (data.avatar !== undefined) presence.avatar = data.avatar;
		if (data.displayName !== undefined) presence.displayName = data.displayName;
		presence.lastSeen = Date.now();

		return presence;
	}

	/**
	 * Get all users present in a project.
	 */
	getPresence(projectId: string): UserPresence[] {
		const project = this._presence.get(projectId);
		if (!project) return [];
		return [...project.values()];
	}

	/**
	 * Get all active users across all projects.
	 */
	getActiveUsers(): UserPresence[] {
		const users: UserPresence[] = [];
		for (const project of this._presence.values()) {
			users.push(...project.values());
		}
		return users;
	}

	/**
	 * Heartbeat — update lastSeen for a user.
	 * Returns false if the user is not currently tracked (caller should re-join).
	 */
	heartbeat(projectId: string, userId: string): boolean {
		const project = this._presence.get(projectId);
		if (!project) return false;

		const presence = project.get(userId);
		if (!presence) return false;

		presence.lastSeen = Date.now();
		return true;
	}

	/**
	 * Remove users not seen within maxAgeMs (default 60s).
	 * Returns the number of stale entries removed.
	 */
	cleanupStale(maxAgeMs: number = DEFAULT_STALE_MS): number {
		const cutoff = Date.now() - maxAgeMs;
		let removed = 0;

		for (const [projectId, project] of this._presence.entries()) {
			for (const [userId, presence] of project.entries()) {
				if (presence.lastSeen < cutoff) {
					project.delete(userId);
					removed++;
				}
			}
			// Clean up empty project map
			if (project.size === 0) {
				this._presence.delete(projectId);
			}
		}

		return removed;
	}

	/**
	 * Collaboration stats — counts across all projects.
	 */
	getCollaborationStats(): CollaborationStats {
		let totalUsers = 0;
		let projectsWithUsers = 0;

		for (const project of this._presence.values()) {
			if (project.size > 0) {
				totalUsers += project.size;
				projectsWithUsers++;
			}
		}

		return { totalActiveUsers: totalUsers, projectsWithUsers };
	}

	/**
	 * Debug helper — dump current presence state.
	 */
	dump(): Record<string, UserPresence[]> {
		const out: Record<string, UserPresence[]> = {};
		for (const [projectId, project] of this._presence.entries()) {
			out[projectId] = [...project.values()];
		}
		return out;
	}
}

export interface CollaborationStats {
	totalActiveUsers: number;
	projectsWithUsers: number;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const collaboration = new CollaborationService();

// ---------------------------------------------------------------------------
// Auto-cleanup every 30s to evict stale presence entries
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_MS = 30_000;

setInterval(() => {
	const removed = collaboration.cleanupStale();
	if (removed > 0) {
		console.log(`[collaboration] Cleaned up ${removed} stale presence entries`);
	}
}, CLEANUP_INTERVAL_MS).unref();
