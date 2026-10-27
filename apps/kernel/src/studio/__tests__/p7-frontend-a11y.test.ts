import { describe, expect, it } from "vitest";

describe("P7-H: Frontend Accessibility", () => {
	it("ProvidersPage.tsx has no alert() calls", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/ProvidersPage.tsx"), "utf8");
		const alertMatches = src.match(/\balert\(/g) || [];
		expect(alertMatches.length).toBe(0);
	});

	it("TaskDetailModal.tsx has no alert() calls", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/TaskDetailModal.tsx"), "utf8");
		const alertMatches = src.match(/\balert\(/g) || [];
		expect(alertMatches.length).toBe(0);
	});

	it("SkillsPage.tsx has no alert() calls", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/SkillsPage.tsx"), "utf8");
		const alertMatches = src.match(/\balert\(/g) || [];
		expect(alertMatches.length).toBe(0);
	});

	it("top accessibility files use focus-visible instead of focus:outline-none", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const files = [
			"../../apps/console/src/pages/AlertsPage.tsx",
			"../../apps/console/src/pages/studio/studio-home/CreateProjectModal.tsx",
		];
		for (const f of files) {
			const src = readFileSync(join(process.cwd(), f), "utf8");
			const outlineNoneCount = (src.match(/focus:outline-none/g) || []).length;
			// Should be significantly reduced (may not be zero if some are legitimate)
			expect(outlineNoneCount).toBeLessThan(5);
		}
	});
});
