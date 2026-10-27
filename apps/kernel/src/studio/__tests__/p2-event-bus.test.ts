// ---------------------------------------------------------------------------
// P2-2: Event Bus — Behavior-based unit tests (DB-independent)
// Tests: on/emit, handler error isolation, dedup TTL, emitTransient, off/unsubscribe
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// All vi.mock() calls must be at the top level, before any dynamic imports.
vi.mock("../db.js", () => ({
	insertEvent: vi.fn(),
	getEvent: vi.fn(),
}));

vi.mock("../pg-listener.js", () => ({
	pgListener: {
		notify: vi.fn(async () => {}),
		start: vi.fn(async () => {}),
		onNotification: vi.fn(),
	},
}));

vi.mock("../correlation-context.js", () => ({
	getCorrelationIds: vi.fn(() => ({ correlationId: "test-corr-id", causationId: undefined })),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// Dynamic import AFTER mocks so the module picks up mocked dependencies.
const { eventBus } = await import("../event-bus.js");
const { insertEvent } = await import("../db.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEventData(overrides?: Partial<{ projectId: string; type: string }>) {
	return {
		projectId: overrides?.projectId ?? "proj-test",
		type: (overrides?.type ?? "agent:output") as any,
		agentId: "agent-1",
		taskId: "task-1",
		payload: { output: "hello" },
	};
}

function makePersistedEvent(id: string, data: ReturnType<typeof makeEventData>) {
	return { id, ...data, timestamp: new Date().toISOString(), correlationId: "test-corr-id" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P2-2: Event Bus — on() / emit()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("on() registers a type handler that is called when emit() resolves", async () => {
		const handler = vi.fn();
		const data = makeEventData({ type: "task:completed" });
		const persisted = makePersistedEvent("evt-on-1", data);
		vi.mocked(insertEvent).mockResolvedValueOnce(persisted as any);

		const unsub = eventBus.on("task:completed" as any, handler);

		eventBus.emit(data);
		// emit is fire-and-forget — flush microtasks
		await new Promise((r) => setImmediate(r));

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(persisted);

		unsub();
	});

	it("onProject() registers a project handler that is called when emit() resolves", async () => {
		const handler = vi.fn();
		const data = makeEventData({ projectId: "proj-x", type: "agent:output" });
		const persisted = makePersistedEvent("evt-proj-1", data);
		vi.mocked(insertEvent).mockResolvedValueOnce(persisted as any);

		const unsub = eventBus.onProject("proj-x", handler);

		eventBus.emit(data);
		await new Promise((r) => setImmediate(r));

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(persisted);

		unsub();
	});

	it("emit() does not call handlers for a different project", async () => {
		const handlerA = vi.fn();
		const data = makeEventData({ projectId: "proj-y" });
		const persisted = makePersistedEvent("evt-diff-proj", data);
		vi.mocked(insertEvent).mockResolvedValueOnce(persisted as any);

		const unsub = eventBus.onProject("proj-z", handlerA);

		eventBus.emit(data);
		await new Promise((r) => setImmediate(r));

		expect(handlerA).not.toHaveBeenCalled();
		unsub();
	});
});

describe("P2-2: Event Bus — handler error isolation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("a throwing type handler does not prevent the next handler from running", async () => {
		const throwingHandler = vi.fn(() => {
			throw new Error("handler boom");
		});
		const safeHandler = vi.fn();

		const data = makeEventData({ type: "task:failed" });
		const persisted = makePersistedEvent("evt-err-1", data);
		vi.mocked(insertEvent).mockResolvedValueOnce(persisted as any);

		eventBus.on("task:failed" as any, throwingHandler);
		const unsub = eventBus.on("task:failed" as any, safeHandler);

		eventBus.emit(data);
		await new Promise((r) => setImmediate(r));

		expect(throwingHandler).toHaveBeenCalled();
		expect(safeHandler).toHaveBeenCalled();

		// Cleanup
		eventBus.on("task:failed" as any, () => {})(); // trigger removal path
		unsub();
	});

	it("a throwing project handler does not prevent the next project handler from running", async () => {
		const throwingHandler = vi.fn(() => {
			throw new Error("project handler boom");
		});
		const safeHandler = vi.fn();

		const data = makeEventData({ projectId: "proj-err-2" });
		const persisted = makePersistedEvent("evt-err-2", data);
		vi.mocked(insertEvent).mockResolvedValueOnce(persisted as any);

		eventBus.onProject("proj-err-2", throwingHandler);
		const unsub = eventBus.onProject("proj-err-2", safeHandler);

		eventBus.emit(data);
		await new Promise((r) => setImmediate(r));

		expect(throwingHandler).toHaveBeenCalled();
		expect(safeHandler).toHaveBeenCalled();

		unsub();
	});
});

describe("P2-2: Event Bus — dedup (_recentlyEmitted)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("emitAsync() marks the event ID so initPgListener onNotification skips it", async () => {
		const data = makeEventData({ projectId: "proj-dedup" });
		const persisted = makePersistedEvent("evt-dedup-42", data);
		vi.mocked(insertEvent).mockResolvedValueOnce(persisted as any);

		// Capture the notification callback registered by initPgListener
		const { pgListener } = await import("../pg-listener.js");
		let notifCallback: ((p: any) => void) | undefined;
		vi.mocked(pgListener.onNotification).mockImplementationOnce((cb) => {
			notifCallback = cb;
			return () => {}; // Return unsubscribe function
		});

		await eventBus.initPgListener();

		const projectHandler = vi.fn();
		const unsub = eventBus.onProject("proj-dedup", projectHandler);

		// Emit and capture ID
		await eventBus.emitAsync(data);

		// Reset call count after the direct emit triggered the handler
		projectHandler.mockClear();

		// Simulate PG LISTEN/NOTIFY arriving with the same ID — should be suppressed
		if (notifCallback) {
			notifCallback({ id: persisted.id, projectId: data.projectId, type: data.type });
		}
		await new Promise((r) => setImmediate(r));

		// Handler should NOT have been called a second time due to dedup
		expect(projectHandler).not.toHaveBeenCalled();

		unsub();
	});
});

describe("P2-2: Event Bus — emitTransient()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("emitTransient() calls project handlers without persisting to DB", () => {
		const handler = vi.fn();
		const data = makeEventData({ projectId: "proj-transient" });

		const unsub = eventBus.onProject("proj-transient", handler);

		eventBus.emitTransient(data);

		// No DB call
		expect(insertEvent).not.toHaveBeenCalled();
		// Handler called synchronously
		expect(handler).toHaveBeenCalledOnce();
		const received = handler.mock.calls[0][0];
		expect(received.projectId).toBe("proj-transient");
		expect(received.id).toBe(""); // transient events have empty id

		unsub();
	});

	it("emitTransient() calls type handlers without persisting to DB", () => {
		const handler = vi.fn();
		const data = makeEventData({ type: "agent:output" });

		const unsub = eventBus.on("agent:output" as any, handler);

		eventBus.emitTransient(data);

		expect(insertEvent).not.toHaveBeenCalled();
		expect(handler).toHaveBeenCalledOnce();

		unsub();
	});

	it("emitTransient() handler errors do not propagate and remaining handlers still run", () => {
		const throwingHandler = vi.fn(() => {
			throw new Error("transient boom");
		});
		const safeHandler = vi.fn();
		const data = makeEventData({ projectId: "proj-transient-err" });

		eventBus.onProject("proj-transient-err", throwingHandler);
		const unsub = eventBus.onProject("proj-transient-err", safeHandler);

		// Must not throw
		expect(() => eventBus.emitTransient(data)).not.toThrow();
		expect(safeHandler).toHaveBeenCalled();

		unsub();
	});
});

describe("P2-2: Event Bus — off() / unsubscribe", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calling the unsubscribe function returned by on() stops the handler from receiving events", async () => {
		const handler = vi.fn();
		const data = makeEventData({ type: "pipeline:completed" });
		const persisted = makePersistedEvent("evt-unsub-1", data);
		vi.mocked(insertEvent).mockResolvedValue(persisted as any);

		const unsub = eventBus.on("pipeline:completed" as any, handler);
		unsub();

		eventBus.emit(data);
		await new Promise((r) => setImmediate(r));

		expect(handler).not.toHaveBeenCalled();
	});

	it("calling the unsubscribe function returned by onProject() stops the handler", () => {
		const handler = vi.fn();
		const data = makeEventData({ projectId: "proj-unsub" });

		const unsub = eventBus.onProject("proj-unsub", handler);
		unsub();

		eventBus.emitTransient(data);
		expect(handler).not.toHaveBeenCalled();
	});

	it("unsubscribing one handler does not affect other registered handlers for the same project", () => {
		const handlerA = vi.fn();
		const handlerB = vi.fn();
		const data = makeEventData({ projectId: "proj-multi-unsub" });

		const unsubA = eventBus.onProject("proj-multi-unsub", handlerA);
		eventBus.onProject("proj-multi-unsub", handlerB);

		unsubA();
		eventBus.emitTransient(data);

		expect(handlerA).not.toHaveBeenCalled();
		expect(handlerB).toHaveBeenCalledOnce();
	});
});
