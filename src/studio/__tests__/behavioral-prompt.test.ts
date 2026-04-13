import { describe, expect, it } from "vitest";
import { BEHAVIORAL_PRINCIPLES, composeSystemPrompt } from "../behavioral-prompt.js";

describe("behavioral-prompt", () => {
	it("exposes a non-empty principles block", () => {
		expect(BEHAVIORAL_PRINCIPLES.length).toBeGreaterThan(0);
		expect(BEHAVIORAL_PRINCIPLES).toContain("Engineering Principles (shared)");
	});

	it("prepends principles to a role prompt", () => {
		const role = "You are Zahir, a tech-lead.";
		const composed = composeSystemPrompt(role);
		expect(composed.startsWith(BEHAVIORAL_PRINCIPLES)).toBe(true);
		expect(composed).toContain(role);
	});

	it("is idempotent — does not double-prepend when principles already embedded", () => {
		const role = "You are Olivia.";
		const once = composeSystemPrompt(role);
		const twice = composeSystemPrompt(once);
		expect(once).toBe(twice);
	});

	it("PM_SYSTEM_PROMPT embeds the shared principles", async () => {
		const { PM_SYSTEM_PROMPT } = await import("../pm-agent.js");
		expect(PM_SYSTEM_PROMPT).toContain("Engineering Principles (shared)");
		expect(PM_SYSTEM_PROMPT).toContain("AI Planner");
	});
});
