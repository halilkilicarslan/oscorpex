import { describe, expect, it } from "vitest";

describe("RC1-A: Staging environment", () => {
	it("staging-environment-definition.md exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/staging-environment-definition.md"))).toBe(true);
	});
});

describe("RC1-B: Full regression script", () => {
	it("run-full-regression.sh exists and is executable", async () => {
		const { statSync } = await import("node:fs");
		const { join } = await import("node:path");
		const stat = statSync(join(process.cwd(), "../../scripts/run-full-regression.sh"));
		expect(stat.mode & 0o100).toBeGreaterThan(0);
	});
});

describe("RC1-G: Tenant isolation smoke", () => {
	it("tenant-isolation-smoke.sh exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../scripts/tenant-isolation-smoke.sh"))).toBe(true);
	});
});

describe("RC1-O: Security review checklist", () => {
	it("rc1-security-review-checklist.md exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/rc1-security-review-checklist.md"))).toBe(true);
	});
	it("checklist covers P0-P13 protections", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/rc1-security-review-checklist.md"), "utf8");
		expect(src).toContain("RCE");
		expect(src).toContain("RLS");
		expect(src).toContain("Hermes");
		expect(src).toContain("Gateway");
		expect(src).toContain("Checkpoint");
	});
});

describe("RC1-H+I: Drill checklists", () => {
	it("backup-restore-drill exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/backup-restore-drill-checklist.md"))).toBe(true);
	});
	it("rollback-drill exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/rollback-drill-checklist.md"))).toBe(true);
	});
});
