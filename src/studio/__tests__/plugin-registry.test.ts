import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getPlugins,
	notifyPlugins,
	type Plugin,
	registerPlugin,
	unregisterPlugin,
} from "../plugin-registry.js";

beforeEach(() => {
	// Clear registry between tests
	for (const plugin of getPlugins()) {
		unregisterPlugin(plugin.name);
	}
});

describe("plugin-registry", () => {
	it("starts empty", () => {
		expect(getPlugins()).toEqual([]);
	});

	it("registers a plugin", () => {
		const plugin: Plugin = { name: "p1", version: "1.0", hooks: {} };
		registerPlugin(plugin);
		expect(getPlugins()).toHaveLength(1);
		expect(getPlugins()[0].name).toBe("p1");
	});

	it("overwrites on duplicate registration", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		registerPlugin({ name: "p1", version: "1.0", hooks: {} });
		registerPlugin({ name: "p1", version: "2.0", hooks: {} });
		expect(getPlugins()).toHaveLength(1);
		expect(getPlugins()[0].version).toBe("2.0");
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already registered"));
		warnSpy.mockRestore();
	});

	it("unregisters by name", () => {
		registerPlugin({ name: "p1", version: "1.0", hooks: {} });
		registerPlugin({ name: "p2", version: "1.0", hooks: {} });
		unregisterPlugin("p1");
		expect(getPlugins()).toHaveLength(1);
		expect(getPlugins()[0].name).toBe("p2");
	});

	it("notifies all plugins with matching hook", async () => {
		const onTaskComplete = vi.fn();
		registerPlugin({ name: "p1", version: "1.0", hooks: { onTaskComplete } });
		registerPlugin({ name: "p2", version: "1.0", hooks: { onTaskComplete } });
		registerPlugin({ name: "p3", version: "1.0", hooks: {} });

		await notifyPlugins("onTaskComplete", { projectId: "p", taskId: "t", agentId: "a" });

		expect(onTaskComplete).toHaveBeenCalledTimes(2);
		expect(onTaskComplete).toHaveBeenCalledWith({ projectId: "p", taskId: "t", agentId: "a" });
	});

	it("isolates plugin errors — one failing plugin does not stop others", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const goodHook = vi.fn();
		registerPlugin({
			name: "bad",
			version: "1",
			hooks: { onTaskComplete: async () => { throw new Error("boom"); } },
		});
		registerPlugin({ name: "good", version: "1", hooks: { onTaskComplete: goodHook } });

		await notifyPlugins("onTaskComplete", { projectId: "p", taskId: "t", agentId: "a" });

		expect(goodHook).toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("bad"), expect.any(Error));
		errorSpy.mockRestore();
	});

	it("ignores plugins without the requested hook", async () => {
		const onPipelineComplete = vi.fn();
		registerPlugin({ name: "p1", version: "1", hooks: { onPipelineComplete } });

		await notifyPlugins("onTaskComplete", { projectId: "p", taskId: "t", agentId: "a" });

		expect(onPipelineComplete).not.toHaveBeenCalled();
	});
});
