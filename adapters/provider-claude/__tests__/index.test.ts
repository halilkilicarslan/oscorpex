// ---------------------------------------------------------------------------
// ClaudeCodeAdapter Tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../src/index.js";

describe("ClaudeCodeAdapter", () => {
	it("has correct id", () => {
		const adapter = new ClaudeCodeAdapter();
		expect(adapter.id).toBe("claude-code");
	});

	it("reports correct capabilities", () => {
		const adapter = new ClaudeCodeAdapter();
		const caps = adapter.capabilities();
		expect(caps.supportsCancel).toBe(true);
		expect(caps.supportsToolRestriction).toBe(true);
		expect(caps.supportedModels).toContain("sonnet");
		expect(caps.supportedModels).toContain("opus");
		expect(caps.supportedModels).toContain("haiku");
	});

	it("isAvailable returns false without legacy", async () => {
		const adapter = new ClaudeCodeAdapter();
		expect(await adapter.isAvailable()).toBe(false);
	});

	it("isAvailable delegates to legacy", async () => {
		const legacy = { isAvailable: () => Promise.resolve(true) };
		const adapter = new ClaudeCodeAdapter(legacy);
		expect(await adapter.isAvailable()).toBe(true);
	});

	it("health returns false when unavailable", async () => {
		const adapter = new ClaudeCodeAdapter();
		expect(await adapter.health()).toEqual({ healthy: false });
	});

	it("cancel is no-op", async () => {
		const adapter = new ClaudeCodeAdapter();
		await expect(adapter.cancel()).resolves.toBeUndefined();
	});
});
