// ---------------------------------------------------------------------------
// Oscorpex — Context Session Tests (v4.0 Faz 3)
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildResumeSnapshot, formatResumeSnapshot, initContextSession, trackEvent } from "../context-session.js";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
	insertContextEvent: vi.fn().mockResolvedValue(undefined),
	getContextEvents: vi.fn().mockResolvedValue([]),
	isDuplicateEvent: vi.fn().mockResolvedValue(false),
	countSessionEvents: vi.fn().mockResolvedValue(0),
	evictLowPriorityEvents: vi.fn().mockResolvedValue(5),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: {
		on: vi.fn(),
		emit: vi.fn(),
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// trackEvent
// ---------------------------------------------------------------------------

describe("trackEvent", () => {
	let insertContextEvent: ReturnType<typeof vi.fn>;
	let isDuplicateEvent: ReturnType<typeof vi.fn>;
	let countSessionEvents: ReturnType<typeof vi.fn>;
	let evictLowPriorityEvents: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const db = await import("../db.js");
		insertContextEvent = db.insertContextEvent as ReturnType<typeof vi.fn>;
		isDuplicateEvent = db.isDuplicateEvent as ReturnType<typeof vi.fn>;
		countSessionEvents = db.countSessionEvents as ReturnType<typeof vi.fn>;
		evictLowPriorityEvents = db.evictLowPriorityEvents as ReturnType<typeof vi.fn>;

		// Reset to defaults after clearAllMocks
		isDuplicateEvent.mockResolvedValue(false);
		countSessionEvents.mockResolvedValue(0);
		insertContextEvent.mockResolvedValue(undefined);
		evictLowPriorityEvents.mockResolvedValue(5);
	});

	it("should insert a context event", async () => {
		await trackEvent("p1", "t1", "a1", "task:completed", '{"title":"Auth"}');

		expect(insertContextEvent).toHaveBeenCalledTimes(1);
		const input = insertContextEvent.mock.calls[0][0];
		expect(input.projectId).toBe("p1");
		expect(input.taskId).toBe("t1");
		expect(input.sessionKey).toBe("p1:t1");
		expect(input.type).toBe("task:completed");
		expect(input.category).toBe("task");
		expect(input.priority).toBe(1);
	});

	it("should use projectId as sessionKey when no taskId", async () => {
		await trackEvent("p1", undefined, undefined, "pipeline:completed", "{}");

		const input = insertContextEvent.mock.calls[0][0];
		expect(input.sessionKey).toBe("p1");
	});

	it("should skip duplicate events", async () => {
		isDuplicateEvent.mockResolvedValue(true);

		await trackEvent("p1", "t1", "a1", "task:completed", '{"title":"Auth"}');

		expect(insertContextEvent).not.toHaveBeenCalled();
	});

	it("should evict low-priority events when over limit", async () => {
		countSessionEvents.mockResolvedValue(500);

		await trackEvent("p1", "t1", "a1", "task:completed", '{"title":"Auth"}');

		expect(evictLowPriorityEvents).toHaveBeenCalledWith("p1:t1", 490);
		expect(insertContextEvent).toHaveBeenCalled();
	});

	it("should assign default priority 3 for unknown event types", async () => {
		await trackEvent("p1", "t1", undefined, "custom:event", "data");

		const input = insertContextEvent.mock.calls[0][0];
		expect(input.priority).toBe(3);
		expect(input.category).toBe("task");
	});
});

// ---------------------------------------------------------------------------
// initContextSession
// ---------------------------------------------------------------------------

describe("initContextSession", () => {
	it("should register listeners for all bridge events", async () => {
		const { eventBus } = await import("../event-bus.js");
		const on = eventBus.on as ReturnType<typeof vi.fn>;

		initContextSession(eventBus as any);

		const registeredEvents = on.mock.calls.map((c: any[]) => c[0]);
		expect(registeredEvents).toContain("task:completed");
		expect(registeredEvents).toContain("task:failed");
		expect(registeredEvents).toContain("pipeline:completed");
		expect(registeredEvents).toContain("review:approved");
		expect(registeredEvents).toContain("review:rejected");
		expect(registeredEvents.length).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// buildResumeSnapshot
// ---------------------------------------------------------------------------

describe("buildResumeSnapshot", () => {
	let getContextEvents: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const db = await import("../db.js");
		getContextEvents = db.getContextEvents as ReturnType<typeof vi.fn>;
	});

	it("should return empty snapshot when no events", async () => {
		getContextEvents.mockResolvedValue([]);

		const snapshot = await buildResumeSnapshot("p1:t1");

		expect(snapshot.eventCount).toBe(0);
		expect(snapshot.completedSteps).toEqual([]);
		expect(snapshot.errors).toEqual([]);
		expect(snapshot.filesTracked).toEqual([]);
	});

	it("should extract completed steps from task events", async () => {
		getContextEvents.mockResolvedValue([
			{
				id: 1,
				session_key: "p1:t1",
				type: "task:completed",
				category: "task",
				priority: 1,
				data: '{"title":"Setup DB"}',
				created_at: "2026-04-17T00:00:00Z",
			},
			{
				id: 2,
				session_key: "p1:t1",
				type: "task:completed",
				category: "task",
				priority: 1,
				data: '{"title":"Create API"}',
				created_at: "2026-04-17T00:01:00Z",
			},
		]);

		const snapshot = await buildResumeSnapshot("p1:t1");

		expect(snapshot.completedSteps).toContain("Setup DB");
		expect(snapshot.completedSteps).toContain("Create API");
		expect(snapshot.eventCount).toBe(2);
	});

	it("should extract errors from error events", async () => {
		getContextEvents.mockResolvedValue([
			{
				id: 1,
				session_key: "p1:t1",
				type: "task:failed",
				category: "error",
				priority: 1,
				data: '{"error":"TypeError: x is undefined"}',
				created_at: "2026-04-17T00:00:00Z",
			},
		]);

		const snapshot = await buildResumeSnapshot("p1:t1");

		expect(snapshot.errors.length).toBe(1);
		expect(snapshot.errors[0]).toContain("TypeError");
	});

	it("should extract decisions from decision events", async () => {
		getContextEvents.mockResolvedValue([
			{
				id: 1,
				session_key: "p1:t1",
				type: "review:approved",
				category: "decision",
				priority: 2,
				data: '{"title":"Auth module review"}',
				created_at: "2026-04-17T00:00:00Z",
			},
		]);

		const snapshot = await buildResumeSnapshot("p1:t1");

		expect(snapshot.decisions.length).toBe(1);
		expect(snapshot.decisions[0]).toContain("Auth module review");
	});

	it("should track file operations", async () => {
		getContextEvents.mockResolvedValue([
			{
				id: 1,
				session_key: "p1:t1",
				type: "file_write",
				category: "file",
				priority: 2,
				data: '{"path":"src/auth.ts"}',
				created_at: "2026-04-17T00:00:00Z",
			},
			{
				id: 2,
				session_key: "p1:t1",
				type: "file_write",
				category: "file",
				priority: 2,
				data: '{"path":"src/auth.ts"}',
				created_at: "2026-04-17T00:01:00Z",
			},
		]);

		const snapshot = await buildResumeSnapshot("p1:t1");

		expect(snapshot.filesTracked.length).toBe(1);
		expect(snapshot.filesTracked[0].path).toBe("src/auth.ts");
		expect(snapshot.filesTracked[0].ops).toContain("file_write×2");
	});
});

// ---------------------------------------------------------------------------
// formatResumeSnapshot
// ---------------------------------------------------------------------------

describe("formatResumeSnapshot", () => {
	it("should format a full snapshot as markdown", () => {
		const formatted = formatResumeSnapshot({
			filesTracked: [{ path: "src/auth.ts", ops: "file_write×3" }],
			errors: ["[task:failed] TypeError: x is undefined"],
			completedSteps: ["Setup DB", "Create API"],
			decisions: ["[review:approved] Auth review"],
			eventCount: 15,
		});

		expect(formatted).toContain("## Previous Session Context");
		expect(formatted).toContain("### Completed Steps");
		expect(formatted).toContain("Setup DB");
		expect(formatted).toContain("### Files Tracked");
		expect(formatted).toContain("`src/auth.ts`");
		expect(formatted).toContain("### Previous Errors");
		expect(formatted).toContain("TypeError");
		expect(formatted).toContain("### Decisions Made");
		expect(formatted).toContain("15 events tracked");
	});

	it("should handle empty snapshot gracefully", () => {
		const formatted = formatResumeSnapshot({
			filesTracked: [],
			errors: [],
			completedSteps: [],
			decisions: [],
			eventCount: 0,
		});

		expect(formatted).toContain("## Previous Session Context");
		expect(formatted).toContain("0 events tracked");
		expect(formatted).not.toContain("### Completed Steps");
	});
});
