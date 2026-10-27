import { describe, expect, it } from "vitest";

describe("RC1 Soak Execution Infrastructure", () => {
	it("rc1-soak-runner.sh exists and is executable", async () => {
		const { statSync } = await import("node:fs");
		const { join } = await import("node:path");
		const stat = statSync(join(process.cwd(), "../../scripts/rc1-soak-runner.sh"));
		expect(stat.mode & 0o100).toBeGreaterThan(0);
	});

	it("daily report template exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/rc1-soak-daily-report-template.md"))).toBe(true);
	});

	it("final soak report exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/reports/RC1_SOAK_FINAL_REPORT.md"))).toBe(true);
	});

	it("soak report contains Go/No-Go assessment", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/reports/RC1_SOAK_FINAL_REPORT.md"), "utf8");
		expect(src).toContain("Go / No-Go");
		expect(src).toContain("GO for Beta");
	});

	it("soak report covers all sprint suites", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/reports/RC1_SOAK_FINAL_REPORT.md"), "utf8");
		for (const s of ["P0", "P5", "P10", "P13", "RC1"]) {
			expect(src).toContain(s);
		}
	});
});
