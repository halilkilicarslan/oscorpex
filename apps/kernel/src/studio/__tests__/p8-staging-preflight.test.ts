import { describe, expect, it } from "vitest";

describe("P8-G: Staging validation script", () => {
	it("validate-staging.sh exists and is executable", async () => {
		const { statSync } = await import("node:fs");
		const { join } = await import("node:path");
		const stat = statSync(join(process.cwd(), "../../scripts/validate-staging.sh"));
		expect(stat.isFile()).toBe(true);
		// Check executable bit (owner)
		expect(stat.mode & 0o100).toBeGreaterThan(0);
	});
});

describe("P8-H: Production preflight script", () => {
	it("production-preflight.sh exists and is executable", async () => {
		const { statSync } = await import("node:fs");
		const { join } = await import("node:path");
		const stat = statSync(join(process.cwd(), "../../scripts/production-preflight.sh"));
		expect(stat.isFile()).toBe(true);
		expect(stat.mode & 0o100).toBeGreaterThan(0);
	});

	it("preflight checks for JWT secret, DEV_NO_AUTH, terminal exec", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../scripts/production-preflight.sh"), "utf8");
		expect(src).toContain("OSCORPEX_JWT_SECRET");
		expect(src).toContain("OSCORPEX_DEV_NO_AUTH");
		expect(src).toContain("OSCORPEX_ENABLE_TERMINAL_EXEC");
		expect(src).toContain("FORCE ROW LEVEL SECURITY");
	});
});

describe("P8-J: Git commit workflow design", () => {
	it("design document exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/architecture/git-commit-workflow-p9-plan.md"))).toBe(true);
	});

	it("design document covers required sections", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/architecture/git-commit-workflow-p9-plan.md"), "utf8");
		expect(src).toContain("Threat Model");
		expect(src).toContain("Required Checkpoint");
		expect(src).toContain("Secret Scan");
		expect(src).toContain("Rollback Strategy");
	});
});
