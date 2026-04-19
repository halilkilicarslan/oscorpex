// ---------------------------------------------------------------------------
// Oscorpex — Plugin SDK Tests (M5)
// Tests for the new PluginRegistry class (manifest-driven, timeout-protected)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db module before importing plugin-registry
vi.mock("../db.js", () => ({
	insertPluginExecution: vi.fn().mockResolvedValue(undefined),
	updatePlugin: vi.fn().mockResolvedValue(null),
	registerPlugin: vi.fn().mockResolvedValue({ id: "mock-id", name: "test" }),
	listPlugins: vi.fn().mockResolvedValue([]),
	getPlugin: vi.fn().mockResolvedValue(null),
	deletePlugin: vi.fn().mockResolvedValue(undefined),
}));

import type { PluginHandler, PluginManifest } from "../plugin-registry.js";
import { pluginRegistry } from "../plugin-registry.js";
import type { StudioEvent } from "../types.js";

// We import db mocks after vi.mock to access them in tests
import * as db from "../db.js";

// ---------------------------------------------------------------------------
// Helper: create a mock StudioEvent
// ---------------------------------------------------------------------------
function makeEvent(type = "task:completed", projectId = "proj-1"): StudioEvent {
	return {
		id: "evt-1",
		projectId,
		type: type as StudioEvent["type"],
		taskId: "task-1",
		agentId: "agent-1",
		payload: { title: "Test task" },
		timestamp: new Date().toISOString(),
	};
}

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		name: "test-plugin",
		version: "1.0.0",
		hooks: [],
		permissions: [],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// Clean up all loaded plugins between tests
	for (const { name } of pluginRegistry.listLoaded()) {
		pluginRegistry.unregister(name);
	}
});

afterEach(() => {
	for (const { name } of pluginRegistry.listLoaded()) {
		pluginRegistry.unregister(name);
	}
});

describe("PluginRegistry — in-memory registration", () => {
	it("registers a plugin in-memory", () => {
		const manifest = makeManifest({ name: "p1" });
		const handler: PluginHandler = vi.fn();
		pluginRegistry.register(manifest, handler);

		const loaded = pluginRegistry.listLoaded();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].name).toBe("p1");
		expect(loaded[0].enabled).toBe(true);
	});

	it("unregisters a plugin by name", () => {
		const manifest = makeManifest({ name: "p1" });
		pluginRegistry.register(manifest, vi.fn());
		pluginRegistry.register(makeManifest({ name: "p2" }), vi.fn());

		pluginRegistry.unregister("p1");

		const loaded = pluginRegistry.listLoaded();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].name).toBe("p2");
	});
});

describe("PluginRegistry — notifyPlugins hook filtering", () => {
	it("delivers event only to plugins subscribed to that hook", async () => {
		const handler1 = vi.fn().mockResolvedValue(undefined);
		const handler2 = vi.fn().mockResolvedValue(undefined);

		pluginRegistry.register(makeManifest({ name: "p1", hooks: ["task:completed"] }), handler1);
		pluginRegistry.register(makeManifest({ name: "p2", hooks: ["task:failed"] }), handler2);

		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));

		expect(handler1).toHaveBeenCalledOnce();
		expect(handler2).not.toHaveBeenCalled();
	});

	it("skips disabled plugins", async () => {
		const handler = vi.fn().mockResolvedValue(undefined);
		pluginRegistry.register(makeManifest({ name: "p1", hooks: ["task:completed"] }), handler);

		// Disable without DB call (mock already returns null)
		const plugin = pluginRegistry.getPlugin("p1");
		if (plugin) plugin.enabled = false;

		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));

		expect(handler).not.toHaveBeenCalled();
	});

	it("catch-all: empty hooks array receives all event types", async () => {
		const handler = vi.fn().mockResolvedValue(undefined);
		pluginRegistry.register(makeManifest({ name: "catch-all", hooks: [] }), handler);

		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));
		await pluginRegistry.notifyPlugins(makeEvent("pipeline:completed"));
		await pluginRegistry.notifyPlugins(makeEvent("sprint:started"));

		expect(handler).toHaveBeenCalledTimes(3);
	});

	it("enforces timeout — slow plugin is rejected after timeout", async () => {
		const slowHandler: PluginHandler = () =>
			new Promise((resolve) => setTimeout(resolve, 10_000));

		pluginRegistry.register(
			makeManifest({ name: "slow", hooks: ["task:completed"], timeout: 50 }),
			slowHandler,
		);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('[plugin-registry] Plugin "slow" failed on task:completed:'),
			expect.stringContaining("timed out after 50ms"),
		);
		errorSpy.mockRestore();
	});

	it("one failing plugin does not prevent others from running", async () => {
		const badHandler: PluginHandler = async () => {
			throw new Error("boom");
		};
		const goodHandler = vi.fn().mockResolvedValue(undefined);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		pluginRegistry.register(makeManifest({ name: "bad", hooks: [] }), badHandler);
		pluginRegistry.register(makeManifest({ name: "good", hooks: [] }), goodHandler);

		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));

		expect(goodHandler).toHaveBeenCalledOnce();
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("logs successful execution to DB (non-blocking)", async () => {
		const handler = vi.fn().mockResolvedValue(undefined);
		pluginRegistry.register(makeManifest({ name: "p1", hooks: ["task:completed"] }), handler);

		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));

		// Allow microtask queue to flush
		await new Promise((r) => setTimeout(r, 10));

		expect(db.insertPluginExecution).toHaveBeenCalledWith(
			expect.objectContaining({
				pluginName: "p1",
				hook: "task:completed",
				success: true,
				error: null,
			}),
		);
	});

	it("logs failed execution to DB with error message", async () => {
		const badHandler: PluginHandler = async () => {
			throw new Error("plugin crash");
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		pluginRegistry.register(makeManifest({ name: "bad", hooks: ["task:completed"] }), badHandler);

		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));

		await new Promise((r) => setTimeout(r, 10));

		expect(db.insertPluginExecution).toHaveBeenCalledWith(
			expect.objectContaining({
				pluginName: "bad",
				hook: "task:completed",
				success: false,
				error: "plugin crash",
			}),
		);
		errorSpy.mockRestore();
	});
});

describe("PluginRegistry — PluginContext logger", () => {
	it("provides functioning logger to plugin handler", async () => {
		const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const handler: PluginHandler = (ctx) => {
			ctx.logger.info("info message");
			ctx.logger.warn("warn message");
			ctx.logger.error("error message");
		};

		pluginRegistry.register(makeManifest({ name: "logger-test", hooks: [] }), handler);
		await pluginRegistry.notifyPlugins(makeEvent("task:completed"));

		expect(infoSpy).toHaveBeenCalledWith("[plugin:logger-test] info message");
		expect(warnSpy).toHaveBeenCalledWith("[plugin:logger-test] warn message");
		expect(errorSpy).toHaveBeenCalledWith("[plugin:logger-test] error message");

		infoSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});
});

describe("PluginRegistry — enable/disable toggle", () => {
	it("enable sets enabled=true in-memory and calls DB", async () => {
		pluginRegistry.register(makeManifest({ name: "p1", hooks: [] }), vi.fn());
		const plugin = pluginRegistry.getPlugin("p1");
		if (plugin) plugin.enabled = false;

		await pluginRegistry.enable("p1");

		expect(pluginRegistry.getPlugin("p1")?.enabled).toBe(true);
		expect(db.updatePlugin).toHaveBeenCalledWith("p1", { enabled: true });
	});

	it("disable sets enabled=false in-memory and calls DB", async () => {
		pluginRegistry.register(makeManifest({ name: "p1", hooks: [] }), vi.fn());

		await pluginRegistry.disable("p1");

		expect(pluginRegistry.getPlugin("p1")?.enabled).toBe(false);
		expect(db.updatePlugin).toHaveBeenCalledWith("p1", { enabled: false });
	});
});

describe("PluginRegistry — listLoaded", () => {
	it("returns correct format for all loaded plugins", () => {
		pluginRegistry.register(makeManifest({ name: "a", hooks: ["task:completed"] }), vi.fn());
		pluginRegistry.register(makeManifest({ name: "b", hooks: [] }), vi.fn());

		const list = pluginRegistry.listLoaded();
		expect(list).toHaveLength(2);
		expect(list.find((p) => p.name === "a")).toMatchObject({
			name: "a",
			hooks: ["task:completed"],
			enabled: true,
		});
		expect(list.find((p) => p.name === "b")).toMatchObject({
			name: "b",
			hooks: [],
			enabled: true,
		});
	});
});
