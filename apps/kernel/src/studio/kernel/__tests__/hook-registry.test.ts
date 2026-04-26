// ---------------------------------------------------------------------------
// Kernel Hook Registry Tests (S1-01)
// Verifies idempotent registration, priority ordering, and runHooks behavior.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { hookRegistry, runHooks } from "../hook-registry.js";

describe("InMemoryHookRegistry", () => {
	beforeEach(() => {
		hookRegistry.clear();
	});

	it("registers a hook and retrieves it", () => {
		const hook = vi.fn().mockResolvedValue({ proceed: true });
		hookRegistry.register({ id: "hook-1", phase: "before_task_start", priority: 0, hook });

		const hooks = hookRegistry.getHooks("before_task_start");
		expect(hooks).toHaveLength(1);
		expect(hooks[0]!.id).toBe("hook-1");
	});

	it("sorts hooks by priority", () => {
		const h1 = vi.fn().mockResolvedValue({ proceed: true });
		const h2 = vi.fn().mockResolvedValue({ proceed: true });
		const h3 = vi.fn().mockResolvedValue({ proceed: true });

		hookRegistry.register({ id: "mid", phase: "before_task_start", priority: 5, hook: h2 });
		hookRegistry.register({ id: "low", phase: "before_task_start", priority: 10, hook: h3 });
		hookRegistry.register({ id: "high", phase: "before_task_start", priority: 1, hook: h1 });

		const hooks = hookRegistry.getHooks("before_task_start");
		expect(hooks.map((h) => h.id)).toEqual(["high", "mid", "low"]);
	});

	it("is idempotent — same id replaces previous registration", () => {
		const first = vi.fn().mockResolvedValue({ proceed: true });
		const second = vi.fn().mockResolvedValue({ proceed: true });

		hookRegistry.register({ id: "same-id", phase: "before_task_start", priority: 0, hook: first });
		hookRegistry.register({ id: "same-id", phase: "before_task_start", priority: 0, hook: second });

		const hooks = hookRegistry.getHooks("before_task_start");
		expect(hooks).toHaveLength(1);
		expect(hooks[0]!.hook).toBe(second);
	});

	it("is idempotent across phases — same id in different phases creates two entries", () => {
		const hook = vi.fn().mockResolvedValue({ proceed: true });

		hookRegistry.register({ id: "same-id", phase: "before_task_start", priority: 0, hook });
		hookRegistry.register({ id: "same-id", phase: "after_task_complete", priority: 0, hook });

		expect(hookRegistry.getHooks("before_task_start")).toHaveLength(1);
		expect(hookRegistry.getHooks("after_task_complete")).toHaveLength(1);
	});

	it("unregisters a hook by id", () => {
		const hook = vi.fn().mockResolvedValue({ proceed: true });
		hookRegistry.register({ id: "to-remove", phase: "before_task_start", priority: 0, hook });

		hookRegistry.unregister("to-remove");

		expect(hookRegistry.getHooks("before_task_start")).toHaveLength(0);
	});

	it("clear removes all hooks", () => {
		hookRegistry.register({ id: "a", phase: "before_task_start", priority: 0, hook: vi.fn() });
		hookRegistry.register({ id: "b", phase: "after_task_complete", priority: 0, hook: vi.fn() });

		hookRegistry.clear();

		expect(hookRegistry.getHooks("before_task_start")).toHaveLength(0);
		expect(hookRegistry.getHooks("after_task_complete")).toHaveLength(0);
	});
});

describe("runHooks", () => {
	beforeEach(() => {
		hookRegistry.clear();
	});

	it("returns true when all hooks proceed", async () => {
		const hook = vi.fn().mockResolvedValue({ proceed: true });
		hookRegistry.register({ id: "h1", phase: "before_task_start", priority: 0, hook });

		const ctx = { projectId: "p1", runId: "r1", taskId: "t1" };
		const result = await runHooks("before_task_start", ctx);

		expect(result).toBe(true);
		expect(hook).toHaveBeenCalledWith(ctx);
	});

	it("returns false when a hook rejects", async () => {
		const allow = vi.fn().mockResolvedValue({ proceed: true });
		const block = vi.fn().mockResolvedValue({ proceed: false });

		hookRegistry.register({ id: "allow", phase: "before_task_start", priority: 0, hook: allow });
		hookRegistry.register({ id: "block", phase: "before_task_start", priority: 1, hook: block });

		const ctx = { projectId: "p1", runId: "r1", taskId: "t1" };
		const result = await runHooks("before_task_start", ctx);

		expect(result).toBe(false);
		expect(block).toHaveBeenCalled();
		// allow should have been called because it has lower priority
		expect(allow).toHaveBeenCalled();
	});

	it("applies modifiedContext from hooks", async () => {
		const modify = vi.fn().mockResolvedValue({ proceed: true, modifiedContext: { extra: "data" } });
		hookRegistry.register({ id: "mod", phase: "before_task_start", priority: 0, hook: modify });

		const ctx: any = { projectId: "p1", runId: "r1", taskId: "t1" };
		await runHooks("before_task_start", ctx);

		expect(ctx.extra).toBe("data");
	});

	it("continues on hook error (non-blocking)", async () => {
		const bad = vi.fn().mockRejectedValue(new Error("boom"));
		const good = vi.fn().mockResolvedValue({ proceed: true });

		hookRegistry.register({ id: "bad", phase: "before_task_start", priority: 0, hook: bad });
		hookRegistry.register({ id: "good", phase: "before_task_start", priority: 1, hook: good });

		const ctx = { projectId: "p1", runId: "r1", taskId: "t1" };
		const result = await runHooks("before_task_start", ctx);

		expect(result).toBe(true);
		expect(good).toHaveBeenCalled();
	});

	it("does not double-register idempotent hooks (KB-04 regression)", async () => {
		const hook = vi.fn().mockResolvedValue({ proceed: true });

		// Simulate registerTaskHook being called twice for the same hook id
		hookRegistry.register({ id: "pipeline-hook", phase: "before_task_start", priority: 0, hook });
		hookRegistry.register({ id: "pipeline-hook", phase: "before_task_start", priority: 0, hook });
		hookRegistry.register({ id: "pipeline-hook", phase: "before_task_start", priority: 0, hook });

		const hooks = hookRegistry.getHooks("before_task_start");
		expect(hooks).toHaveLength(1);

		// Ensure it still runs correctly
		const ctx = { projectId: "p1", runId: "r1", taskId: "t1" };
		const result = await runHooks("before_task_start", ctx);
		expect(result).toBe(true);
		expect(hook).toHaveBeenCalledTimes(1);
	});
});

describe("EPIC 4 — Hook & Lifecycle Integration (IT-14..IT-15)", () => {
	beforeEach(() => {
		hookRegistry.clear();
	});

	it("IT-14: multiple registrations with same id do not create duplicates", () => {
		const hook = vi.fn().mockResolvedValue({ proceed: true });
		hookRegistry.register({ id: "dup-hook", phase: "before_task_start", priority: 0, hook });
		hookRegistry.register({ id: "dup-hook", phase: "before_task_start", priority: 0, hook });
		hookRegistry.register({ id: "dup-hook", phase: "before_task_start", priority: 0, hook });

		const hooks = hookRegistry.getHooks("before_task_start");
		const count = hooks.filter((h) => h.id === "dup-hook").length;
		expect(count).toBe(1);
	});

	it("IT-15: before_task_start hook can block task execution", async () => {
		const blocker = vi.fn().mockResolvedValue({ proceed: false });
		hookRegistry.register({ id: "blocker", phase: "before_task_start", priority: 0, hook: blocker });

		const ctx = { projectId: "p1", runId: "r1", taskId: "t1" };
		const result = await runHooks("before_task_start", ctx);

		expect(result).toBe(false);
		expect(blocker).toHaveBeenCalledWith(ctx);
	});
});