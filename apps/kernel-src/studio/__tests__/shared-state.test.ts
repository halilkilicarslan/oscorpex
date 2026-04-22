// ---------------------------------------------------------------------------
// Tests — SharedState: InMemoryStateProvider + RedisStateProvider stub + factory
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryStateProvider, RedisStateProvider, createStateProvider } from "../shared-state.js";

// ---------------------------------------------------------------------------
// InMemoryStateProvider — basic CRUD
// ---------------------------------------------------------------------------

describe("InMemoryStateProvider — get/set/del/has", () => {
	let provider: InMemoryStateProvider;

	beforeEach(() => {
		provider = new InMemoryStateProvider();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns undefined for a missing key", async () => {
		const result = await provider.get("nonexistent");
		expect(result).toBeUndefined();
	});

	it("set and get a string value", async () => {
		await provider.set("greeting", "hello");
		const result = await provider.get("greeting");
		expect(result).toBe("hello");
	});

	it("set and get an object value", async () => {
		const obj = { name: "Oscorpex", version: 6 };
		await provider.set("meta", obj);
		const result = await provider.get("meta");
		expect(result).toEqual(obj);
	});

	it("has() returns true for an existing key", async () => {
		await provider.set("flag", true);
		expect(await provider.has("flag")).toBe(true);
	});

	it("has() returns false for a missing key", async () => {
		expect(await provider.has("missing")).toBe(false);
	});

	it("del() removes a key", async () => {
		await provider.set("temp", 42);
		await provider.del("temp");
		expect(await provider.get("temp")).toBeUndefined();
		expect(await provider.has("temp")).toBe(false);
	});

	it("del() on a non-existent key does not throw", async () => {
		await expect(provider.del("ghost")).resolves.toBeUndefined();
	});

	it("overwriting a key updates the value", async () => {
		await provider.set("counter", 1);
		await provider.set("counter", 2);
		expect(await provider.get("counter")).toBe(2);
	});

	it("size reflects stored entries", async () => {
		expect(provider.size).toBe(0);
		await provider.set("a", 1);
		await provider.set("b", 2);
		expect(provider.size).toBe(2);
		await provider.del("a");
		expect(provider.size).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// InMemoryStateProvider — TTL expiration
// ---------------------------------------------------------------------------

describe("InMemoryStateProvider — TTL expiration", () => {
	let provider: InMemoryStateProvider;

	beforeEach(() => {
		provider = new InMemoryStateProvider();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("value is available before TTL expires", async () => {
		await provider.set("ephemeral", "alive", 5_000);
		vi.advanceTimersByTime(4_000);
		expect(await provider.get("ephemeral")).toBe("alive");
	});

	it("value is gone after TTL expires (via setTimeout eviction)", async () => {
		await provider.set("ephemeral", "alive", 5_000);
		vi.advanceTimersByTime(6_000);
		expect(await provider.get("ephemeral")).toBeUndefined();
	});

	it("has() returns false after TTL expires", async () => {
		await provider.set("short", "value", 1_000);
		vi.advanceTimersByTime(2_000);
		expect(await provider.has("short")).toBe(false);
	});

	it("overwrite clears previous timer and applies new TTL", async () => {
		await provider.set("key", "v1", 2_000);
		// Overwrite with longer TTL before expiry
		await provider.set("key", "v2", 10_000);
		vi.advanceTimersByTime(3_000);
		// Should still be alive under new TTL
		expect(await provider.get("key")).toBe("v2");
	});

	it("set without TTL persists indefinitely", async () => {
		await provider.set("forever", "here");
		vi.advanceTimersByTime(1_000_000);
		expect(await provider.get("forever")).toBe("here");
	});
});

// ---------------------------------------------------------------------------
// InMemoryStateProvider — Pub/Sub
// ---------------------------------------------------------------------------

describe("InMemoryStateProvider — pub/sub", () => {
	let provider: InMemoryStateProvider;

	beforeEach(() => {
		provider = new InMemoryStateProvider();
	});

	it("subscriber receives published message", async () => {
		const handler = vi.fn();
		provider.subscribe("chan1", handler);
		await provider.publish("chan1", { event: "test" });
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0]).toEqual({ event: "test" });
	});

	it("multiple subscribers on same channel all receive the message", async () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		const h3 = vi.fn();
		provider.subscribe("broadcast", h1);
		provider.subscribe("broadcast", h2);
		provider.subscribe("broadcast", h3);
		await provider.publish("broadcast", "hello");
		expect(h1).toHaveBeenCalledOnce();
		expect(h2).toHaveBeenCalledOnce();
		expect(h3).toHaveBeenCalledOnce();
	});

	it("unsubscribe stops handler from receiving messages", async () => {
		const handler = vi.fn();
		const unsub = provider.subscribe("chan2", handler);
		unsub();
		await provider.publish("chan2", "after-unsub");
		expect(handler).not.toHaveBeenCalled();
	});

	it("unsubscribe does not affect other subscribers on same channel", async () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		const unsub1 = provider.subscribe("shared", h1);
		provider.subscribe("shared", h2);
		unsub1();
		await provider.publish("shared", "data");
		expect(h1).not.toHaveBeenCalled();
		expect(h2).toHaveBeenCalledOnce();
	});

	it("subscribers on different channels are isolated", async () => {
		const hA = vi.fn();
		const hB = vi.fn();
		provider.subscribe("channelA", hA);
		provider.subscribe("channelB", hB);
		await provider.publish("channelA", "for-A-only");
		expect(hA).toHaveBeenCalledOnce();
		expect(hB).not.toHaveBeenCalled();
	});

	it("unsubscribe(channel) removes all handlers for that channel", async () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		provider.subscribe("bulk", h1);
		provider.subscribe("bulk", h2);
		provider.unsubscribe("bulk");
		await provider.publish("bulk", "payload");
		expect(h1).not.toHaveBeenCalled();
		expect(h2).not.toHaveBeenCalled();
	});

	it("publish to a channel with no subscribers does not throw", async () => {
		await expect(provider.publish("silent-channel", "ping")).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// InMemoryStateProvider — Locking
// ---------------------------------------------------------------------------

describe("InMemoryStateProvider — distributed locks", () => {
	let provider: InMemoryStateProvider;

	beforeEach(() => {
		provider = new InMemoryStateProvider();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("acquireLock returns true when lock is free", async () => {
		const acquired = await provider.acquireLock("resource-1");
		expect(acquired).toBe(true);
		expect(provider.lockCount).toBe(1);
	});

	it("acquireLock returns false when lock is already held", async () => {
		await provider.acquireLock("resource-2", 10_000);
		const second = await provider.acquireLock("resource-2", 10_000);
		expect(second).toBe(false);
	});

	it("releaseLock allows re-acquisition", async () => {
		await provider.acquireLock("resource-3", 10_000);
		await provider.releaseLock("resource-3");
		expect(provider.lockCount).toBe(0);
		const reacquired = await provider.acquireLock("resource-3");
		expect(reacquired).toBe(true);
	});

	it("lock TTL auto-releases after expiry", async () => {
		await provider.acquireLock("resource-4", 5_000);
		expect(provider.lockCount).toBe(1);
		vi.advanceTimersByTime(6_000);
		expect(provider.lockCount).toBe(0);
		// Should be re-acquirable now
		const acquired = await provider.acquireLock("resource-4");
		expect(acquired).toBe(true);
	});

	it("lock contention — second acquire fails while held", async () => {
		await provider.acquireLock("contested", 30_000);
		const results = await Promise.all([
			provider.acquireLock("contested", 30_000),
			provider.acquireLock("contested", 30_000),
		]);
		// Both should fail (lock still held)
		expect(results.every((r) => r === false)).toBe(true);
	});

	it("different keys do not conflict", async () => {
		const r1 = await provider.acquireLock("key-A");
		const r2 = await provider.acquireLock("key-B");
		expect(r1).toBe(true);
		expect(r2).toBe(true);
		expect(provider.lockCount).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// RedisStateProvider — stub behaviour
// ---------------------------------------------------------------------------

describe("RedisStateProvider — stub throws on use", () => {
	it("constructor logs a warning (does not throw)", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const provider = new RedisStateProvider();
		expect(warnSpy).toHaveBeenCalled();
		expect(warnSpy.mock.calls[0][0]).toContain("RedisStateProvider is a stub");
		warnSpy.mockRestore();
		expect(provider).toBeDefined();
	});

	it("get() throws Redis not configured error", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const provider = new RedisStateProvider();
		await expect(provider.get("key")).rejects.toThrow("Redis not configured");
	});

	it("set() throws Redis not configured error", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const provider = new RedisStateProvider();
		await expect(provider.set("key", "val")).rejects.toThrow("Redis not configured");
	});

	it("acquireLock() throws Redis not configured error", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const provider = new RedisStateProvider();
		await expect(provider.acquireLock("lock")).rejects.toThrow("Redis not configured");
	});
});

// ---------------------------------------------------------------------------
// Factory — createStateProvider
// ---------------------------------------------------------------------------

describe("createStateProvider — factory", () => {
	afterEach(() => {
		process.env.OSCORPEX_STATE_PROVIDER = undefined;
	});

	it("returns InMemoryStateProvider by default (no env var)", () => {
		process.env.OSCORPEX_STATE_PROVIDER = undefined;
		const provider = createStateProvider();
		expect(provider).toBeInstanceOf(InMemoryStateProvider);
	});

	it("returns InMemoryStateProvider when type=memory", () => {
		const provider = createStateProvider("memory");
		expect(provider).toBeInstanceOf(InMemoryStateProvider);
	});

	it("returns RedisStateProvider when type=redis (stub)", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const provider = createStateProvider("redis");
		expect(provider).toBeInstanceOf(RedisStateProvider);
	});

	it("returns InMemoryStateProvider when OSCORPEX_STATE_PROVIDER=memory", () => {
		process.env.OSCORPEX_STATE_PROVIDER = "memory";
		const provider = createStateProvider();
		expect(provider).toBeInstanceOf(InMemoryStateProvider);
	});

	it("returns RedisStateProvider when OSCORPEX_STATE_PROVIDER=redis", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		process.env.OSCORPEX_STATE_PROVIDER = "redis";
		const provider = createStateProvider();
		expect(provider).toBeInstanceOf(RedisStateProvider);
	});

	it("explicit type argument overrides env var", () => {
		process.env.OSCORPEX_STATE_PROVIDER = "redis";
		const provider = createStateProvider("memory");
		expect(provider).toBeInstanceOf(InMemoryStateProvider);
	});
});
