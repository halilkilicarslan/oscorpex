import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Beta-0.5: UI Page Inventory Verification
//
// These tests run inside the kernel vitest suite (Node / no browser) and verify
// the static shape of the console source: files exist, routes are registered,
// security antipatterns are absent, dark-theme tokens are present, and the
// Playwright spec file is in place.
//
// Paths are relative to apps/kernel (process.cwd()) so we navigate via "../../"
// to reach the monorepo root.
// ---------------------------------------------------------------------------

const REQUIRED_PAGES = [
	"apps/console/src/pages/studio/ApprovalsPage.tsx",
	"apps/console/src/pages/studio/McpAuditPage.tsx",
	"apps/console/src/pages/studio/McpMetricsPage.tsx",
	"apps/console/src/pages/studio/HermesDashboardPage.tsx",
	"apps/console/src/pages/studio/HermesKeysPage.tsx",
	"apps/console/src/pages/studio/MemoryPruningPage.tsx",
] as const;

// ---------------------------------------------------------------------------
// File existence
// ---------------------------------------------------------------------------
describe("Beta-0.5: UI Page Inventory", () => {
	for (const page of REQUIRED_PAGES) {
		it(`${page.split("/").pop()} exists`, async () => {
			const { existsSync } = await import("node:fs");
			const { join } = await import("node:path");
			expect(existsSync(join(process.cwd(), `../../${page}`))).toBe(true);
		});
	}

	// -------------------------------------------------------------------------
	// Routing registration
	// -------------------------------------------------------------------------
	it("main.tsx has lazy import for ApprovalsPage", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("ApprovalsPage");
	});

	it("main.tsx has lazy import for McpAuditPage", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("McpAuditPage");
	});

	it("main.tsx has lazy import for McpMetricsPage", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("McpMetricsPage");
	});

	it("main.tsx has lazy import for HermesDashboardPage", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("HermesDashboardPage");
	});

	it("main.tsx has lazy import for HermesKeysPage", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("HermesKeysPage");
	});

	it("main.tsx has lazy import for MemoryPruningPage", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("MemoryPruningPage");
	});

	it("main.tsx registers /studio/mcp/approvals route", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("/studio/mcp/approvals");
	});

	it("main.tsx registers /studio/mcp/audit route", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("/studio/mcp/audit");
	});

	it("main.tsx registers /studio/hermes route", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const main = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(main).toContain("/studio/hermes");
	});

	// -------------------------------------------------------------------------
	// Security: no window.alert() in new pages
	// -------------------------------------------------------------------------
	it("no window.alert() calls in any required page", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		for (const page of REQUIRED_PAGES) {
			const src = readFileSync(join(process.cwd(), `../../${page}`), "utf8");
			expect(src, `${page} must not use alert()`).not.toMatch(/\balert\s*\(/);
		}
	});

	it("no raw secret patterns in any required page source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const secretPatterns = [
			/sk-[a-zA-Z0-9]{20,}/,
			/ghp_[a-zA-Z0-9]{36,}/,
			/AKIA[A-Z0-9]{16}/,
			/-----BEGIN (RSA|EC|DSA) PRIVATE KEY-----/,
		];
		for (const page of REQUIRED_PAGES) {
			const src = readFileSync(join(process.cwd(), `../../${page}`), "utf8");
			for (const pattern of secretPatterns) {
				expect(src, `${page} must not contain raw secret matching ${pattern}`).not.toMatch(pattern);
			}
		}
	});

	// -------------------------------------------------------------------------
	// Dark theme compliance
	// -------------------------------------------------------------------------
	it("all required pages use dark background #0a0a0a", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		for (const page of REQUIRED_PAGES) {
			const src = readFileSync(join(process.cwd(), `../../${page}`), "utf8");
			expect(src, `${page} must use #0a0a0a dark background`).toContain("#0a0a0a");
		}
	});

	it("at least one required page uses accent colour #22c55e", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		let found = false;
		for (const page of REQUIRED_PAGES) {
			const src = readFileSync(join(process.cwd(), `../../${page}`), "utf8");
			if (src.includes("#22c55e")) found = true;
		}
		expect(found).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Accessibility: focus-visible patterns
	// -------------------------------------------------------------------------
	it("at least one required page uses focus-visible accessible focus pattern", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		let hasAccessibleFocus = false;
		for (const page of REQUIRED_PAGES) {
			const src = readFileSync(join(process.cwd(), `../../${page}`), "utf8");
			if (src.includes("focus-visible") || src.includes("focus:ring")) {
				hasAccessibleFocus = true;
			}
		}
		expect(hasAccessibleFocus).toBe(true);
	});

	it("HermesKeysPage uses focus-visible:ring pattern on inputs", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/HermesKeysPage.tsx"), "utf8");
		expect(src).toContain("focus-visible");
	});

	// -------------------------------------------------------------------------
	// Component shape: no console.log left in new pages
	// -------------------------------------------------------------------------
	it("no stray console.log in required pages", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		for (const page of REQUIRED_PAGES) {
			const src = readFileSync(join(process.cwd(), `../../${page}`), "utf8");
			// console.warn/error are acceptable for error handling; bare console.log is not
			expect(src, `${page} must not contain bare console.log`).not.toMatch(/\bconsole\.log\s*\(/);
		}
	});

	// -------------------------------------------------------------------------
	// TypeScript: no any casts in required pages
	// -------------------------------------------------------------------------
	it("no explicit any type assertions in required pages", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		for (const page of REQUIRED_PAGES) {
			const src = readFileSync(join(process.cwd(), `../../${page}`), "utf8");
			// Disallow `as any` casts (not `// any` comments or type names)
			expect(src, `${page} must not use 'as any'`).not.toMatch(/\bas any\b/);
		}
	});
});

// ---------------------------------------------------------------------------
// Playwright test file existence
// ---------------------------------------------------------------------------
describe("Beta-0.5: Playwright Test File", () => {
	it("e2e test file exists at apps/console/e2e/beta05-ui-dogfooding.spec.ts", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../apps/console/e2e/beta05-ui-dogfooding.spec.ts"))).toBe(true);
	});

	it("Playwright spec imports from @playwright/test", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const spec = readFileSync(join(process.cwd(), "../../apps/console/e2e/beta05-ui-dogfooding.spec.ts"), "utf8");
		expect(spec).toContain("@playwright/test");
	});

	it("Playwright spec covers all 8 agent personas", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const spec = readFileSync(join(process.cwd(), "../../apps/console/e2e/beta05-ui-dogfooding.spec.ts"), "utf8");
		// Agent personas 1–8 must all appear as describe headings
		for (let i = 1; i <= 8; i++) {
			expect(spec, `Spec must include Agent ${i}`).toContain(`Agent ${i}:`);
		}
	});

	it("Playwright spec tests approvals, audit, and metrics pages", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const spec = readFileSync(join(process.cwd(), "../../apps/console/e2e/beta05-ui-dogfooding.spec.ts"), "utf8");
		expect(spec).toContain("/studio/mcp/approvals");
		expect(spec).toContain("/studio/mcp/audit");
		expect(spec).toContain("/studio/mcp/metrics");
	});

	it("Playwright spec tests secret pattern absence", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const spec = readFileSync(join(process.cwd(), "../../apps/console/e2e/beta05-ui-dogfooding.spec.ts"), "utf8");
		// The spec must verify no raw secrets are rendered
		expect(spec).toContain("sk-");
		expect(spec).toContain("ghp_");
	});

	it("Playwright spec tests for no window.alert dialogs", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const spec = readFileSync(join(process.cwd(), "../../apps/console/e2e/beta05-ui-dogfooding.spec.ts"), "utf8");
		expect(spec).toContain("alertCalled");
	});

	it("Playwright spec has page load performance assertions", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const spec = readFileSync(join(process.cwd(), "../../apps/console/e2e/beta05-ui-dogfooding.spec.ts"), "utf8");
		expect(spec).toContain("toBeLessThan(5000)");
	});
});
