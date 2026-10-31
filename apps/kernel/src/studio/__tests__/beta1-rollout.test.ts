import { describe, expect, it } from "vitest";

describe("Beta-1: Controlled Rollout Infrastructure", () => {
	const docs = [
		"docs/beta/beta1-tenant-selection.md",
		"docs/beta/beta1-feature-flag-matrix.md",
		"docs/beta/beta1-access-model.md",
		"docs/beta/beta1-rollout-checklist.md",
		"docs/beta/beta1-monitoring-ownership.md",
		"docs/beta/beta1-alert-escalation.md",
		"docs/beta/beta1-usage-policy.md",
		"docs/beta/beta1-weekly-review-template.md",
		"docs/beta/beta1-risk-acceptance-log.md",
		"docs/beta/beta1-expansion-criteria.md",
		"docs/reports/BETA1_CONTROLLED_ROLLOUT_REPORT.md",
	];

	for (const doc of docs) {
		it(`${doc} exists`, async () => {
			const { existsSync } = await import("node:fs");
			const { join } = await import("node:path");
			expect(existsSync(join(process.cwd(), `../../${doc}`))).toBe(true);
		});
	}

	it("feature flag matrix covers all critical flags", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/beta/beta1-feature-flag-matrix.md"), "utf8");
		expect(src).toContain("OSCORPEX_ENABLE_HERMES");
		expect(src).toContain("OSCORPEX_ENABLE_GATEWAY");
		expect(src).toContain("OSCORPEX_ENABLE_SCHEDULER");
		expect(src).toContain("OSCORPEX_ENABLE_MCP_WRITE_TOOLS");
	});

	it("rollout checklist covers security verification", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/beta/beta1-rollout-checklist.md"), "utf8");
		expect(src).toContain("preflight");
		expect(src).toContain("tenant isolation");
		expect(src).toContain("rollback");
	});

	it("risk acceptance log exists with mitigations", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/beta/beta1-risk-acceptance-log.md"), "utf8");
		expect(src).toContain("Mitigation");
		expect(src).toContain("Accepted");
	});

	it("beta report contains Go decision", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/reports/BETA1_CONTROLLED_ROLLOUT_REPORT.md"), "utf8");
		expect(src).toContain("GO");
		expect(src).toContain("Beta");
	});
});
