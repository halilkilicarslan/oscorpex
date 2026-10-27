import { describe, expect, it } from "vitest";

describe("RC1-D+E+F: Soak configurations", () => {
	it("soak-test-configurations.md exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/soak-test-configurations.md"))).toBe(true);
	});
});

describe("RC1-J: Observability review", () => {
	it("observability-review-rc1.md exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/observability-review-rc1.md"))).toBe(true);
	});
});

describe("RC1-K: Alert thresholds", () => {
	it("alert-thresholds-rc1.md exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/alert-thresholds-rc1.md"))).toBe(true);
	});
	it("defines severity levels", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/alert-thresholds-rc1.md"), "utf8");
		expect(src).toContain("P0");
		expect(src).toContain("P1");
		expect(src).toContain("RLS");
		expect(src).toContain("Secret");
	});
});

describe("RC1-L+M: Reviews", () => {
	it("secret-redaction-review exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/secret-redaction-review-rc1.md"))).toBe(true);
	});
	it("prompt-injection-review exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/prompt-injection-review-rc1.md"))).toBe(true);
	});
});

describe("RC1-N: Incident response tabletop", () => {
	it("tabletop document exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/incident-response-tabletop-rc1.md"))).toBe(true);
	});
});

describe("RC1-P: Release candidate report", () => {
	it("RC1_RELEASE_CANDIDATE_REPORT.md exists in docs/reports", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/reports/RC1_RELEASE_CANDIDATE_REPORT.md"))).toBe(true);
	});
	it("report covers P0-P13 inventory", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/reports/RC1_RELEASE_CANDIDATE_REPORT.md"), "utf8");
		expect(src).toContain("P0");
		expect(src).toContain("P13");
		expect(src).toContain("Go/No-Go");
	});
});
