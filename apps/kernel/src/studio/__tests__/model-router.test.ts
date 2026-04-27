// ---------------------------------------------------------------------------
// Tests — Cost-Aware Model Router (TASK 11)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { resolveModel, getDefaultRoutingConfig } from "../model-router.js";

function makeTask(overrides: Record<string, unknown> = {}): import("../types.js").Task {
	return {
		id: "t-1",
		phaseId: "p-1",
		title: "Test",
		description: "",
		assignedAgent: "coder",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "feat/x",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	} as import("../types.js").Task;
}

describe("resolveModel cost awareness", () => {
	it("keeps S-tier anthropic as haiku (already cheapest)", async () => {
		const result = await resolveModel(makeTask({ complexity: "S" }), {
			projectId: "p1",
			cliTool: "claude-code",
		});
		expect(result.model).toBe("claude-haiku-4-5-20251001");
		expect(result.decisionReason).toContain("default");
	});

	it("preserves quality for S-tier when prior failures exist", async () => {
		const result = await resolveModel(makeTask({ complexity: "S" }), {
			projectId: "p1",
			priorFailures: 1,
			cliTool: "claude-code",
		});
		expect(result.model).toBe("claude-sonnet-4-6");
		expect(result.decisionReason).toContain("quality_preserve");
	});

	it("does not downgrade L-tier tasks", async () => {
		const result = await resolveModel(makeTask({ complexity: "L" }), {
			projectId: "p1",
			cliTool: "claude-code",
		});
		expect(result.model).toBe("claude-sonnet-4-6");
		expect(result.decisionReason).toContain("quality_first");
	});

	it("downgrades M-tier codex to gpt-4o-mini when no failures", async () => {
		const result = await resolveModel(makeTask({ complexity: "M" }), {
			projectId: "p1",
			cliTool: "codex",
		});
		expect(result.model).toBe("gpt-4o-mini");
		expect(result.decisionReason).toContain("cost_optimize");
	});

	it("preserves codex quality with prior failures (tier bumped to L)", async () => {
		const result = await resolveModel(makeTask({ complexity: "M" }), {
			projectId: "p1",
			priorFailures: 1,
			cliTool: "codex",
		});
		// priorFailures bumps tier M → L, so model is o3
		expect(result.model).toBe("o3");
		expect(result.decisionReason).toContain("quality_preserve");
	});

	it("keeps S-tier cursor as cursor-small (already cheapest)", async () => {
		const result = await resolveModel(makeTask({ complexity: "S" }), {
			projectId: "p1",
			cliTool: "cursor",
		});
		expect(result.model).toBe("cursor-small");
		expect(result.decisionReason).toContain("default");
	});

	it("preserves XL-tier cursor as cursor-large", async () => {
		const result = await resolveModel(makeTask({ complexity: "XL" }), {
			projectId: "p1",
			cliTool: "cursor",
		});
		expect(result.model).toBe("cursor-large");
		expect(result.decisionReason).toContain("quality_first");
	});
});

describe("getDefaultRoutingConfig", () => {
	it("returns expected defaults", () => {
		const config = getDefaultRoutingConfig();
		expect(config.S).toBe("claude-haiku-4-5-20251001");
		expect(config.XL).toBe("claude-opus-4-6");
	});
});
