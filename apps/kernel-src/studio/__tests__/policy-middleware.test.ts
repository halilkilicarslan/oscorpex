import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetGuard, capabilityGuard } from "../middleware/policy-middleware.js";

vi.mock("../db.js", () => ({
	getProjectSettingsMap: vi.fn(),
	getProjectCostSummary: vi.fn(),
}));

import { getProjectCostSummary, getProjectSettingsMap } from "../db.js";
const mockSettingsMap = vi.mocked(getProjectSettingsMap);
const mockCostSummary = vi.mocked(getProjectCostSummary);

function createApp() {
	const app = new Hono();
	app.use("/projects/:id/execute", budgetGuard());
	app.post("/projects/:id/execute", (c) => c.json({ ok: true }));
	app.use("/projects/:id/info", capabilityGuard());
	app.get("/projects/:id/info", (c) => c.json({ projectId: (c as any).get("projectId") }));
	return app;
}

describe("Policy Middleware (Faz 3.3)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("budgetGuard", () => {
		it("should allow when budget not configured", async () => {
			mockSettingsMap.mockResolvedValue({});
			const res = await createApp().request("/projects/p1/execute", { method: "POST" });
			expect(res.status).toBe(200);
		});

		it("should allow when budget disabled", async () => {
			mockSettingsMap.mockResolvedValue({ budget: { enabled: "false", maxCostUsd: "10" } });
			const res = await createApp().request("/projects/p1/execute", { method: "POST" });
			expect(res.status).toBe(200);
		});

		it("should allow when under budget", async () => {
			mockSettingsMap.mockResolvedValue({ budget: { enabled: "true", maxCostUsd: "10" } });
			mockCostSummary.mockResolvedValue({
				totalCostUsd: 5,
				totalInputTokens: 1000,
				totalOutputTokens: 500,
				totalTokens: 1500,
				taskCount: 3,
				totalCacheCreationTokens: 0,
				totalCacheReadTokens: 0,
			});
			const res = await createApp().request("/projects/p1/execute", { method: "POST" });
			expect(res.status).toBe(200);
		});

		it("should return 403 when budget exceeded", async () => {
			mockSettingsMap.mockResolvedValue({ budget: { enabled: "true", maxCostUsd: "5" } });
			mockCostSummary.mockResolvedValue({
				totalCostUsd: 7.5,
				totalInputTokens: 5000,
				totalOutputTokens: 2000,
				totalTokens: 7000,
				taskCount: 10,
				totalCacheCreationTokens: 0,
				totalCacheReadTokens: 0,
			});
			const res = await createApp().request("/projects/p1/execute", { method: "POST" });
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error).toBe("Budget limit exceeded");
		});

		it("should allow on DB error (non-blocking)", async () => {
			mockSettingsMap.mockRejectedValue(new Error("DB down"));
			const res = await createApp().request("/projects/p1/execute", { method: "POST" });
			expect(res.status).toBe(200);
		});
	});

	describe("capabilityGuard", () => {
		it("should pass through and set projectId", async () => {
			const res = await createApp().request("/projects/p123/info");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.projectId).toBe("p123");
		});
	});
});
