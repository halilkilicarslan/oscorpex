// ---------------------------------------------------------------------------
// Oscorpex — Collaboration Service Tests (V6 M6 F11)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationService } from "../collaboration.js";

describe("CollaborationService", () => {
	let svc: CollaborationService;

	beforeEach(() => {
		svc = new CollaborationService();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -------------------------------------------------------------------------
	// Join
	// -------------------------------------------------------------------------

	it("join adds user to presence", () => {
		const presence = svc.join("proj-1", {
			userId: "user-1",
			displayName: "Alice",
		});

		expect(presence.userId).toBe("user-1");
		expect(presence.displayName).toBe("Alice");
		expect(presence.projectId).toBe("proj-1");
		expect(presence.color).toBeTruthy();
		expect(typeof presence.lastSeen).toBe("number");
	});

	it("join returns existing user on reconnect (updates lastSeen)", async () => {
		const first = svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		const firstSeen = first.lastSeen;

		// Small delay to ensure different timestamp
		await new Promise((r) => setTimeout(r, 5));

		const second = svc.join("proj-1", { userId: "user-1", displayName: "Alice Updated" });

		// Same object reference updated
		expect(second.userId).toBe("user-1");
		expect(second.displayName).toBe("Alice Updated");
		expect(second.lastSeen).toBeGreaterThanOrEqual(firstSeen);

		// Still only one user
		expect(svc.getPresence("proj-1")).toHaveLength(1);
	});

	it("join assigns different colors to different users in same project", () => {
		const p1 = svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		const p2 = svc.join("proj-1", { userId: "user-2", displayName: "Bob" });
		const p3 = svc.join("proj-1", { userId: "user-3", displayName: "Charlie" });

		const colors = [p1.color, p2.color, p3.color];
		const unique = new Set(colors);
		expect(unique.size).toBe(3);
	});

	it("join respects custom color when provided", () => {
		const presence = svc.join("proj-1", {
			userId: "user-1",
			displayName: "Alice",
			color: "#ff0000",
		});
		expect(presence.color).toBe("#ff0000");
	});

	// -------------------------------------------------------------------------
	// Leave
	// -------------------------------------------------------------------------

	it("leave removes user from presence", () => {
		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		const removed = svc.leave("proj-1", "user-1");

		expect(removed).toBe(true);
		expect(svc.getPresence("proj-1")).toHaveLength(0);
	});

	it("leave returns false for unknown user", () => {
		const removed = svc.leave("proj-1", "nonexistent");
		expect(removed).toBe(false);
	});

	it("leave cleans up empty project map", () => {
		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		svc.leave("proj-1", "user-1");

		// Dump should not contain proj-1
		const dump = svc.dump();
		expect(dump["proj-1"]).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// Heartbeat
	// -------------------------------------------------------------------------

	it("heartbeat updates lastSeen", async () => {
		const presence = svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		const before = presence.lastSeen;

		await new Promise((r) => setTimeout(r, 5));

		const found = svc.heartbeat("proj-1", "user-1");
		expect(found).toBe(true);

		const updated = svc.getPresence("proj-1")[0];
		expect(updated.lastSeen).toBeGreaterThan(before);
	});

	it("heartbeat returns false for unknown user", () => {
		const found = svc.heartbeat("proj-1", "ghost");
		expect(found).toBe(false);
	});

	// -------------------------------------------------------------------------
	// UpdatePresence
	// -------------------------------------------------------------------------

	it("updatePresence changes activeTab", () => {
		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		const updated = svc.updatePresence("proj-1", "user-1", { activeTab: "kanban" });

		expect(updated).not.toBeNull();
		expect(updated!.activeTab).toBe("kanban");
	});

	it("updatePresence returns null for unknown user", () => {
		const result = svc.updatePresence("proj-1", "ghost", { activeTab: "tasks" });
		expect(result).toBeNull();
	});

	it("updatePresence returns null for unknown project", () => {
		const result = svc.updatePresence("no-project", "user-1", { activeTab: "tasks" });
		expect(result).toBeNull();
	});

	// -------------------------------------------------------------------------
	// GetPresence
	// -------------------------------------------------------------------------

	it("getPresence returns all users in project", () => {
		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		svc.join("proj-1", { userId: "user-2", displayName: "Bob" });
		svc.join("proj-2", { userId: "user-3", displayName: "Charlie" });

		const list = svc.getPresence("proj-1");
		expect(list).toHaveLength(2);
		expect(list.map((u) => u.userId)).toContain("user-1");
		expect(list.map((u) => u.userId)).toContain("user-2");
	});

	it("getPresence returns empty array for unknown project", () => {
		expect(svc.getPresence("no-project")).toEqual([]);
	});

	// -------------------------------------------------------------------------
	// Multiple projects isolation
	// -------------------------------------------------------------------------

	it("multiple projects are isolated from each other", () => {
		svc.join("proj-A", { userId: "user-1", displayName: "Alice" });
		svc.join("proj-B", { userId: "user-1", displayName: "Alice" });

		svc.leave("proj-A", "user-1");

		expect(svc.getPresence("proj-A")).toHaveLength(0);
		expect(svc.getPresence("proj-B")).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// GetActiveUsers
	// -------------------------------------------------------------------------

	it("getActiveUsers returns all users across projects", () => {
		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		svc.join("proj-2", { userId: "user-2", displayName: "Bob" });

		const all = svc.getActiveUsers();
		expect(all).toHaveLength(2);
	});

	// -------------------------------------------------------------------------
	// Cleanup stale
	// -------------------------------------------------------------------------

	it("cleanupStale removes users not seen within maxAgeMs", async () => {
		vi.useFakeTimers();
		const now = Date.now();
		vi.setSystemTime(now);

		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });

		// Advance time by 70s — beyond the 60s default
		vi.setSystemTime(now + 70_000);

		const removed = svc.cleanupStale(60_000);
		expect(removed).toBe(1);
		expect(svc.getPresence("proj-1")).toHaveLength(0);
	});

	it("cleanupStale keeps fresh users", async () => {
		vi.useFakeTimers();
		const now = Date.now();
		vi.setSystemTime(now);

		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });

		// Advance time by only 30s — within the 60s window
		vi.setSystemTime(now + 30_000);

		const removed = svc.cleanupStale(60_000);
		expect(removed).toBe(0);
		expect(svc.getPresence("proj-1")).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// Stats
	// -------------------------------------------------------------------------

	it("getCollaborationStats returns correct counts", () => {
		svc.join("proj-1", { userId: "user-1", displayName: "Alice" });
		svc.join("proj-1", { userId: "user-2", displayName: "Bob" });
		svc.join("proj-2", { userId: "user-3", displayName: "Charlie" });

		const stats = svc.getCollaborationStats();
		expect(stats.totalActiveUsers).toBe(3);
		expect(stats.projectsWithUsers).toBe(2);
	});

	it("getCollaborationStats returns zeros when no users", () => {
		const stats = svc.getCollaborationStats();
		expect(stats.totalActiveUsers).toBe(0);
		expect(stats.projectsWithUsers).toBe(0);
	});
});
