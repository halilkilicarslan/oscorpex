import { describe, expect, it } from "vitest";
import { PROMPT_LIMITS, capText, enforcePromptBudget, estimateTokens } from "../prompt-budget.js";

describe("prompt-budget", () => {
	describe("capText", () => {
		it("returns text unchanged when under limit", () => {
			expect(capText("short", 100)).toBe("short");
		});

		it("truncates with marker when over limit", () => {
			const result = capText("a".repeat(200), 50);
			expect(result.length).toBeLessThanOrEqual(50);
			expect(result.endsWith("[truncated]")).toBe(true);
		});

		it("handles empty string", () => {
			expect(capText("", 100)).toBe("");
		});
	});

	describe("estimateTokens", () => {
		it("estimates ~4 chars per token", () => {
			expect(estimateTokens(400)).toBe(100);
			expect(estimateTokens(0)).toBe(0);
		});
	});

	describe("enforcePromptBudget", () => {
		it("passes prompt through when under limit", () => {
			const { prompt, report } = enforcePromptBudget("hello", { projectId: "p1" });
			expect(prompt).toBe("hello");
			expect(report.truncated).toBe(false);
			expect(report.overLimit).toBe(false);
		});

		it("truncates when over totalPrompt limit", () => {
			const huge = "x".repeat(PROMPT_LIMITS.totalPrompt + 10_000);
			const { prompt, report } = enforcePromptBudget(huge, { projectId: "p1" });
			expect(prompt.length).toBeLessThanOrEqual(PROMPT_LIMITS.totalPrompt);
			expect(report.truncated).toBe(true);
			expect(report.overLimit).toBe(true);
		});

		it("warns but does not truncate near threshold", () => {
			const near = "x".repeat(Math.floor(PROMPT_LIMITS.totalPrompt * 0.8));
			const { prompt, report } = enforcePromptBudget(near, { projectId: "p1" });
			expect(prompt).toBe(near);
			expect(report.truncated).toBe(false);
			expect(report.warn).toBe(true);
		});
	});
});
