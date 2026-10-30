// ---------------------------------------------------------------------------
// F3-c final fix round — graph-coordinator split propagation, emit chain recovery, transient events vs. hanging
// DB writes, and scope errors from boot-time bridges reaching the bus counters.
// Strict-scope file: hooks and tests run outside the implicit scope (helpers/strict-scope.ts).
//
// Choices:
//  - The task/event DB layer is mocked (db.js): graph tests need no task rows, and insertEvent is controllable.
//    Project -> tenant resolution still uses the real DB (running-project fixtures).
//  - "task:cancelled" is not in the event schema yet; the test emits it through an untyped bus handle.
//    A cancelled/deleted child clears the whole split entry (all child ids), so nothing leaks.
//  - registerGraphSplitBridge() is called in beforeAll if exported; its existence is asserted separately.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const loggers = vi.hoisted(() => new Map<string, Record<string, ReturnType<typeof vi.fn>>>());
const hooks = vi.hoisted(() => ({
	tasks: new Map<string, { id: string; status: string }>(),
	updates: [] as Array<{ id: string; status?: string }>,
	insertEvent: null as null | ((data: Record<string, unknown>) => Promise<unknown>),
	trackError: null as unknown,
}));

vi.mock("../logger.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../logger.js")>();
	return {
		...orig,
		createLogger: (name: string) => {
			let l = loggers.get(name);
			if (!l) {
				const self: Record<string, unknown> = {};
				for (const k of ["info", "warn", "error", "debug", "trace", "fatal"]) self[k] = vi.fn();
				self.child = () => self;
				l = self as Record<string, ReturnType<typeof vi.fn>>;
				loggers.set(name, l);
			}
			return l;
		},
	};
});

vi.mock("../db.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../db.js")>();
	let seq = 0;
	return {
		...orig,
		getTask: vi.fn(async (id: string) => hooks.tasks.get(id)),
		updateTask: vi.fn(async (id: string, patch: { status?: string }) => {
			hooks.updates.push({ id, status: patch.status });
			const t = hooks.tasks.get(id);
			if (t && patch.status) t.status = patch.status;
			return t;
		}),
		createTask: vi.fn(async () => {
			const id = `f3c-final-child-${++seq}-${randomUUID().slice(0, 6)}`;
			hooks.tasks.set(id, { id, status: "queued" });
			return { id, phaseId: "p", branch: "main" };
		}),
		recordGraphMutation: vi.fn(async () => ({ id: randomUUID() })),
		insertEvent: vi.fn(async (data: Record<string, unknown>) => {
			if (hooks.insertEvent) return hooks.insertEvent(data);
			return { id: randomUUID(), ...data, timestamp: new Date().toISOString() };
		}),
		isDuplicateEvent: vi.fn(async () => {
			if (hooks.trackError) throw hooks.trackError;
			return false;
		}),
	};
});

vi.mock("../checkpoint/index.js", () => ({ createCheckpoint: vi.fn(async () => ({})) }));

vi.mock("../replay-store.js", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../replay-store.js")>();
	return {
		...orig,
		createCheckpointSnapshot: vi.fn(async () => {
			if (hooks.trackError) throw hooks.trackError;
		}),
	};
});

import { replayPhase } from "../../boot-phases/replay-phase.js";
import { initContextSession } from "../context-session.js";
import { eventBus, getEventBusCounters, resetEventBusCounters } from "../event-bus.js";
import * as graph from "../graph-coordinator.js";
import { pgListener } from "../pg-listener.js";
import { TenantScopeError, runInTenant } from "../tenancy/tenant-scope.js";
import { cleanupRunningProjects, seedRunningProjects } from "./helpers/background-fixtures.js";
import * as strictScope from "./helpers/strict-scope.js";
import { TENANT_A, TENANT_B, seedTestTenants } from "./helpers/tenancy.js";

strictScope.useStrictScopeForFile();

type Ev = { projectId: string; type: string; taskId?: string; tenantId?: string; payload?: unknown };
const bus = eventBus as unknown as {
	emit(data: Record<string, unknown>): void;
	emitTransient(data: Record<string, unknown>): void;
	onProject(projectId: string, h: (e: Ev) => unknown): () => void;
};

function setStatus(id: string, status: string): void {
	const t = hooks.tasks.get(id);
	if (t) t.status = status;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let A: { projectId: string };
let B: { projectId: string };
const offs: Array<() => void> = [];

function emitIn(tenant: string, data: Record<string, unknown>): Promise<void> {
	return runInTenant(tenant, async () => {
		bus.emit(data);
	});
}

beforeAll(async () => {
	await seedTestTenants();
	await cleanupRunningProjects();
	const fx = await seedRunningProjects();
	A = fx.A;
	B = fx.B;
	vi.spyOn(pgListener, "notify").mockResolvedValue(undefined as never);
	const register = (graph as Record<string, unknown>).registerGraphSplitBridge;
	if (typeof register === "function") (register as () => void)();
	initContextSession(eventBus as never);
	replayPhase();
});

afterAll(() => {
	for (const off of offs) off();
	vi.restoreAllMocks();
});

beforeEach(() => {
	hooks.tasks.clear();
	hooks.updates.length = 0;
	hooks.insertEvent = null;
	hooks.trackError = null;
	resetEventBusCounters();
});

// ---------------------------------------------------------------------------
describe("F3-c final — graph-coordinator split propagation", () => {
	async function openSplit(): Promise<{ parent: string; children: string[] }> {
		const parent = `f3c-final-parent-${randomUUID().slice(0, 6)}`;
		hooks.tasks.set(parent, { id: parent, status: "queued" });
		const res = await runInTenant(TENANT_A, () =>
			graph.splitTask(
				{ projectId: A.projectId, pipelineRunId: "run" },
				{
					parentTaskId: parent,
					children: [1, 2, 3].map((n) => ({ title: `c${n}`, description: "d", assignedAgent: "backend-dev" })),
				},
			),
		);
		const children = res.detail.childIds as string[];
		hooks.updates.length = 0;
		return { parent, children };
	}

	const parentUpdates = (parent: string) => hooks.updates.filter((u) => u.id === parent);
	const complete = (id: string, projectId = A.projectId, tenant = TENANT_A, type = "task:completed") =>
		emitIn(tenant, { projectId, type, taskId: id, payload: {} });

	it("exports registerGraphSplitBridge() (registration is explicit, not at module load)", () => {
		expect(typeof (graph as Record<string, unknown>).registerGraphSplitBridge).toBe("function");
	});

	it("all children done -> parent becomes done", async () => {
		const { parent, children } = await openSplit();
		for (const c of children) setStatus(c, "done");
		await complete(children[0]);
		await vi.waitFor(() => expect(parentUpdates(parent)).toEqual([{ id: parent, status: "done" }]));
	});

	it("any child failed -> parent becomes failed", async () => {
		const { parent, children } = await openSplit();
		setStatus(children[0], "done");
		setStatus(children[1], "failed");
		await complete(children[1], A.projectId, TENANT_A, "task:failed");
		await vi.waitFor(() => expect(parentUpdates(parent)).toEqual([{ id: parent, status: "failed" }]));
	});

	it("partial completion changes nothing", async () => {
		const { parent, children } = await openSplit();
		setStatus(children[0], "done");
		await complete(children[0]);
		await sleep(150);
		expect(parentUpdates(parent)).toEqual([]);
	});

	it("after resolution the split entry is gone: later events do not touch the parent again", async () => {
		const { parent, children } = await openSplit();
		for (const c of children) setStatus(c, "done");
		await complete(children[0]);
		await vi.waitFor(() => expect(parentUpdates(parent)).toHaveLength(1));
		await complete(children[1]);
		await complete(children[2]);
		await sleep(150);
		expect(parentUpdates(parent)).toHaveLength(1);
	});

	it("an event for a child id carrying another project's id does not affect the split", async () => {
		const { parent, children } = await openSplit();
		for (const c of children) setStatus(c, "done");
		await complete(children[0], B.projectId, TENANT_B);
		await sleep(150);
		expect(parentUpdates(parent)).toEqual([]);
	});

	it("a cancelled child clears the split entry so it does not leak", async () => {
		const { parent, children } = await openSplit();
		await complete(children[0], A.projectId, TENANT_A, "task:cancelled");
		await sleep(100);
		for (const c of children) setStatus(c, "done");
		await complete(children[1]);
		await complete(children[0]);
		await sleep(150);
		expect(parentUpdates(parent)).toEqual([]);
	});

	it("importing graph-coordinator for the first time inside runInTenant does not throw", async () => {
		vi.resetModules();
		// A fresh module graph has its own tenant-scope instance: enter the scope through that one.
		const freshScope = await import("../tenancy/tenant-scope.js");
		await expect(
			freshScope.runInTenant(TENANT_A, async () => {
				await import("../graph-coordinator.js");
			}),
		).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
describe("F3-c final — scope errors from boot-time bridges reach the bus counters", () => {
	it("a TenantScopeError in the context-session handler increments scopeErrors", async () => {
		hooks.trackError = new TenantScopeError("context-session: no scope");
		await emitIn(TENANT_A, { projectId: A.projectId, type: "task:completed", taskId: "t-ctx", payload: {} });
		await vi.waitFor(() => expect(getEventBusCounters().scopeErrors).toBeGreaterThan(0));
	});

	it("a TenantScopeError in the replay-phase pipeline:stage_completed handler increments scopeErrors", async () => {
		hooks.trackError = new TenantScopeError("replay: no scope");
		await emitIn(TENANT_A, {
			projectId: A.projectId,
			type: "pipeline:stage_completed",
			payload: { stageIndex: 1 },
		});
		await vi.waitFor(() => expect(getEventBusCounters().scopeErrors).toBeGreaterThan(0));
	});

	it("a TenantScopeError in the replay-phase pipeline:completed handler increments scopeErrors", async () => {
		hooks.trackError = new TenantScopeError("replay: no scope");
		await emitIn(TENANT_A, { projectId: A.projectId, type: "pipeline:completed", payload: {} });
		await vi.waitFor(() => expect(getEventBusCounters().scopeErrors).toBeGreaterThan(0));
	});
});

// ---------------------------------------------------------------------------
describe("F3-c final — emit chain resilience", () => {
	it("a rejected insertEvent does not block the next emit for the same project", async () => {
		const received: Ev[] = [];
		offs.push(bus.onProject(A.projectId, (e) => void received.push(e)));
		let calls = 0;
		hooks.insertEvent = async (data) => {
			calls++;
			if (calls === 1) throw new Error("db write failed");
			return { id: randomUUID(), ...data, timestamp: new Date().toISOString() };
		};
		const marker = `chain-${randomUUID().slice(0, 6)}`;
		await emitIn(TENANT_A, { projectId: A.projectId, type: "agent:output", payload: { marker: "first" } });
		await emitIn(TENANT_A, { projectId: A.projectId, type: "agent:output", payload: { marker } });
		await vi.waitFor(() =>
			expect(received.some((e) => (e.payload as { marker?: string })?.marker === marker)).toBe(true),
		);
		expect(calls).toBe(2);
	});

	// Keep last: leaves a hanging write for project B until released.
	it("emitTransient is delivered promptly while an insertEvent for the same project hangs", async () => {
		const received: Ev[] = [];
		offs.push(bus.onProject(B.projectId, (e) => void received.push(e)));
		let release: (v: unknown) => void = () => {};
		hooks.insertEvent = (data) =>
			new Promise((resolve) => {
				release = () => resolve({ id: randomUUID(), ...data, timestamp: new Date().toISOString() });
			});
		try {
			await emitIn(TENANT_B, { projectId: B.projectId, type: "task:completed", payload: { hang: true } });
			await sleep(50);
			const marker = `transient-${randomUUID().slice(0, 6)}`;
			await runInTenant(TENANT_B, async () => {
				bus.emitTransient({ projectId: B.projectId, type: "agent:output", payload: { marker } });
			});
			await vi.waitFor(
				() => expect(received.some((e) => (e.payload as { marker?: string })?.marker === marker)).toBe(true),
				{ timeout: 200, interval: 10 },
			);
		} finally {
			release(undefined);
		}
	});
});
