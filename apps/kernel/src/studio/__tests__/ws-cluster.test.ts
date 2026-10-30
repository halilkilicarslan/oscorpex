// ---------------------------------------------------------------------------
// Tests — WsCluster: WebSocket cluster coordination
// Uses InMemoryStateProvider directly (no real Redis/DB needed).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryStateProvider } from "../shared-state.js";
import { WsCluster } from "../ws-cluster.js";

// Helper to create isolated WsCluster + provider pairs for each test
function makeCluster(instanceId?: string): { cluster: WsCluster; provider: InMemoryStateProvider } {
	const provider = new InMemoryStateProvider();
	const cluster = new WsCluster(provider, instanceId ?? `instance-${Math.random().toString(36).slice(2)}`);
	return { cluster, provider };
}

// ---------------------------------------------------------------------------
// Instance registration
// ---------------------------------------------------------------------------

describe("WsCluster — instance registration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(async () => {
		vi.useRealTimers();
	});

	it("registerInstance marks cluster as registered", async () => {
		const { cluster } = makeCluster("inst-001");
		expect(cluster.isRegistered).toBe(false);
		await cluster.registerInstance();
		expect(cluster.isRegistered).toBe(true);
	});

	it("registerInstance stores instance info in shared state", async () => {
		const { cluster, provider } = makeCluster("inst-002");
		await cluster.registerInstance();
		const info = await provider.get("cluster:instance:inst-002");
		expect(info).toMatchObject({
			instanceId: "inst-002",
		});
	});

	it("registerInstance adds instanceId to the instance list", async () => {
		const { cluster, provider } = makeCluster("inst-003");
		await cluster.registerInstance();
		const list = (await provider.get("cluster:instances")) as string[];
		expect(Array.isArray(list)).toBe(true);
		expect(list).toContain("inst-003");
	});

	it("registering multiple instances populates the list", async () => {
		const provider = new InMemoryStateProvider();
		const c1 = new WsCluster(provider, "node-A");
		const c2 = new WsCluster(provider, "node-B");
		const c3 = new WsCluster(provider, "node-C");

		await c1.registerInstance();
		await c2.registerInstance();
		await c3.registerInstance();

		const list = (await provider.get("cluster:instances")) as string[];
		expect(list).toContain("node-A");
		expect(list).toContain("node-B");
		expect(list).toContain("node-C");
	});

	it("getActiveInstances returns registered instance", async () => {
		const { cluster } = makeCluster("inst-004");
		await cluster.registerInstance();
		const active = await cluster.getActiveInstances();
		expect(active.length).toBeGreaterThanOrEqual(1);
		const found = active.find((i) => i.instanceId === "inst-004");
		expect(found).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

describe("WsCluster — heartbeat", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("heartbeat() updates lastHeartbeat timestamp", async () => {
		const { cluster, provider } = makeCluster("hb-001");
		await cluster.registerInstance();

		const before = (await provider.get("cluster:instance:hb-001")) as { lastHeartbeat: string };
		const tsBefore = before.lastHeartbeat;

		// Advance time and send a heartbeat
		vi.advanceTimersByTime(5_000);
		await cluster.heartbeat();

		const after = (await provider.get("cluster:instance:hb-001")) as { lastHeartbeat: string };
		// Timestamp must be updated (or equal if same ms — just check it exists)
		expect(after.lastHeartbeat).toBeDefined();
		// In fake timer context, the new timestamp will be > original if time was advanced
		expect(new Date(after.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(new Date(tsBefore).getTime());
	});

	it("stale instance is pruned from getActiveInstances", async () => {
		const provider = new InMemoryStateProvider();
		const staleCluster = new WsCluster(provider, "stale-node");
		const liveCluster = new WsCluster(provider, "live-node");

		await staleCluster.registerInstance();
		await liveCluster.registerInstance();

		// Manually set a very old lastHeartbeat for the stale instance
		const staleInfo = {
			instanceId: "stale-node",
			startedAt: new Date(Date.now() - 200_000).toISOString(),
			lastHeartbeat: new Date(Date.now() - 200_000).toISOString(), // 200s ago — well past 90s threshold
		};
		await provider.set("cluster:instance:stale-node", staleInfo);

		// Live node heartbeats now
		await liveCluster.heartbeat();

		const active = await liveCluster.getActiveInstances();
		const staleFound = active.find((i) => i.instanceId === "stale-node");
		const liveFound = active.find((i) => i.instanceId === "live-node");

		expect(staleFound).toBeUndefined();
		expect(liveFound).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Deregister
// ---------------------------------------------------------------------------

describe("WsCluster — deregister", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("deregisterInstance marks cluster as not registered", async () => {
		const { cluster } = makeCluster("dereg-001");
		await cluster.registerInstance();
		expect(cluster.isRegistered).toBe(true);
		await cluster.deregisterInstance();
		expect(cluster.isRegistered).toBe(false);
	});

	it("deregisterInstance removes instance from shared state", async () => {
		const { cluster, provider } = makeCluster("dereg-002");
		await cluster.registerInstance();
		await cluster.deregisterInstance();
		const info = await provider.get("cluster:instance:dereg-002");
		expect(info).toBeUndefined();
	});

	it("deregisterInstance removes instanceId from the list", async () => {
		const { cluster, provider } = makeCluster("dereg-003");
		await cluster.registerInstance();
		await cluster.deregisterInstance();
		const list = (await provider.get("cluster:instances")) as string[];
		expect(list).not.toContain("dereg-003");
	});
});

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

describe("WsCluster — accessors", () => {
	it("currentInstanceId returns the assigned instanceId", () => {
		const { cluster } = makeCluster("accessor-id-test");
		expect(cluster.currentInstanceId).toBe("accessor-id-test");
	});

	it("staleThresholdMs is 90000", () => {
		const { cluster } = makeCluster();
		expect(cluster.staleThresholdMs).toBe(90_000);
	});

	it("heartbeatIntervalMs is 30000", () => {
		const { cluster } = makeCluster();
		expect(cluster.heartbeatIntervalMs).toBe(30_000);
	});
});
