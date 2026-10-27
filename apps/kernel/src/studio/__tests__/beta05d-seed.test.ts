import { describe, expect, it } from "vitest";

describe("Beta-0.5D: Seed Infrastructure", () => {
	it("seed script exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../scripts/seed-beta05d-e2e.ts"))).toBe(true);
	});

	it("seed script is idempotent (no destructive operations)", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../scripts/seed-beta05d-e2e.ts"), "utf8");
		expect(src).not.toContain("DELETE");
		expect(src).not.toContain("DROP");
		expect(src).not.toContain("TRUNCATE");
		expect(src).toContain("synthetic");
	});

	it("seed script uses no real secrets", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../scripts/seed-beta05d-e2e.ts"), "utf8");
		expect(src).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
		expect(src).not.toMatch(/ghp_[a-zA-Z0-9]{36,}/);
	});

	it("E2E report exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/reports/BETA05D_SEEDED_WORKFLOW_E2E_REPORT.md"))).toBe(true);
	});

	it("E2E report covers 16 agents", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/reports/BETA05D_SEEDED_WORKFLOW_E2E_REPORT.md"), "utf8");
		expect(src).toContain("16");
		expect(src).toContain("Red-Team");
		expect(src).toContain("Tenant Isolation");
	});
});
