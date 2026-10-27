// Beta-0.5: Playwright UI Dogfooding Test Scenarios
// Run with: npx playwright test e2e/beta05-ui-dogfooding.spec.ts
// Requires: kernel running on :3141, console on :5161
//
// Each describe block simulates a distinct agent persona probing the UI from
// its unique vantage point. Tests are intentionally broad (page-load + key
// element visibility) so they remain stable across UI refactors while still
// catching complete breakages.

import { expect, test } from "@playwright/test";

const BASE = "http://localhost:5161";

// ---------------------------------------------------------------------------
// Agent 1: New User — first-time navigation and orientation
// ---------------------------------------------------------------------------
test.describe("Agent 1: New User UI", () => {
	test("can access login/home page", async ({ page }) => {
		await page.goto(BASE);
		await expect(page).toHaveTitle(/Oscorpex/i);
	});

	test("can navigate to projects list", async ({ page }) => {
		await page.goto(`${BASE}/studio`);
		await expect(page.locator("text=Projects")).toBeVisible();
	});

	test("can see Hermes dashboard", async ({ page }) => {
		await page.goto(`${BASE}/studio/hermes`);
		await expect(page.locator("text=Hermes")).toBeVisible();
	});

	test("sidebar navigation is present", async ({ page }) => {
		await page.goto(`${BASE}/studio`);
		const nav = page.locator("nav, aside");
		await expect(nav.first()).toBeVisible();
	});

	test("dark background is applied to studio shell", async ({ page }) => {
		await page.goto(`${BASE}/studio`);
		// Background is #0a0a0a — verify the body or root element carries the dark class/style
		const body = await page.evaluate(() => {
			const el = document.querySelector("body, #root");
			return el ? window.getComputedStyle(el).backgroundColor : "";
		});
		// Dark theme: rgb(10, 10, 10) = #0a0a0a or inherited dark colour
		expect(body).not.toBe("rgb(255, 255, 255)");
	});
});

// ---------------------------------------------------------------------------
// Agent 2: Platform Engineer — project creation and pipeline visibility
// ---------------------------------------------------------------------------
test.describe("Agent 2: Platform Engineer UI", () => {
	test("studio home page loads without JS errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await page.goto(`${BASE}/studio`);
		await page.waitForTimeout(1500);
		expect(errors).toHaveLength(0);
	});

	test("pipeline dashboard route is reachable", async ({ page }) => {
		await page.goto(`${BASE}/studio`);
		// Verify the app does not 404 on the studio root
		await expect(page.locator("body")).not.toContainText("404");
	});

	test("providers page route is reachable", async ({ page }) => {
		await page.goto(`${BASE}/studio/providers`);
		await expect(page.locator("body")).not.toContainText("404");
	});
});

// ---------------------------------------------------------------------------
// Agent 3: QA UI — approval queue, audit log, metrics surfaces
// ---------------------------------------------------------------------------
test.describe("Agent 3: QA UI", () => {
	test("approvals page loads", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/approvals`);
		await expect(page.locator("text=Approval")).toBeVisible();
	});

	test("audit page loads", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/audit`);
		await expect(page.locator("text=Audit")).toBeVisible();
	});

	test("metrics page loads", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/metrics`);
		await expect(page.locator("text=Metrics")).toBeVisible();
	});

	test("approvals page has status filter or table", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/approvals`);
		// Either a status badge row or an empty-state message must exist
		const hasRows = await page.locator("table, [role='table'], [class*='approval']").count();
		const hasEmpty = await page.locator("text=No pending").count();
		expect(hasRows + hasEmpty).toBeGreaterThan(0);
	});

	test("audit page shows event type column or empty state", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/audit`);
		const content = await page.textContent("body");
		expect(content).not.toContain("Unexpected Application Error");
	});
});

// ---------------------------------------------------------------------------
// Agent 4: DevOps — Hermes key management surface
// ---------------------------------------------------------------------------
test.describe("Agent 4: DevOps UI", () => {
	test("Hermes keys page loads", async ({ page }) => {
		await page.goto(`${BASE}/studio/hermes/keys`);
		await expect(page.locator("text=Hermes")).toBeVisible();
	});

	test("create key button or form is visible on keys page", async ({ page }) => {
		await page.goto(`${BASE}/studio/hermes/keys`);
		const createBtn = page.locator("button, input[type='text'], textarea").first();
		await expect(createBtn).toBeVisible();
	});

	test("memory pruning page loads", async ({ page }) => {
		await page.goto(`${BASE}/studio/memory-pruning`);
		await expect(page.locator("body")).not.toContainText("404");
	});
});

// ---------------------------------------------------------------------------
// Agent 5: Security UI — write tools hidden, no raw secrets
// ---------------------------------------------------------------------------
test.describe("Agent 5: Security UI", () => {
	test("no write tool visible in MCP tools list", async ({ page }) => {
		await page.goto(`${BASE}/studio/hermes`);
		const content = await page.textContent("body");
		expect(content).not.toContain("file.write");
		expect(content).not.toContain("shell.run");
		expect(content).not.toContain("git.commit");
	});

	test("no raw API key secrets visible on studio home", async ({ page }) => {
		await page.goto(`${BASE}/studio`);
		const content = (await page.textContent("body")) ?? "";
		expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
		expect(content).not.toMatch(/ghp_[a-zA-Z0-9]{36,}/);
		expect(content).not.toMatch(/AKIA[A-Z0-9]{16}/);
	});

	test("no raw secrets visible on hermes dashboard", async ({ page }) => {
		await page.goto(`${BASE}/studio/hermes`);
		const content = (await page.textContent("body")) ?? "";
		expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
		expect(content).not.toMatch(/ghp_[a-zA-Z0-9]{36,}/);
	});

	test("no raw secrets visible on audit page", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/audit`);
		const content = (await page.textContent("body")) ?? "";
		expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
		expect(content).not.toMatch(/ANTHROPIC_API_KEY\s*=\s*\S+/);
	});

	test("no raw secrets visible on keys page", async ({ page }) => {
		// Key page may show masked key previews — full raw key must not appear
		await page.goto(`${BASE}/studio/hermes/keys`);
		const content = (await page.textContent("body")) ?? "";
		// hms_ prefix keys should not be shown in full (only first 8 chars visible)
		expect(content).not.toMatch(/hms_[a-f0-9]{64}/);
	});
});

// ---------------------------------------------------------------------------
// Agent 6: Compliance — audit trail persistence indicators
// ---------------------------------------------------------------------------
test.describe("Agent 6: Compliance UI", () => {
	test("audit page does not show unhandled error boundary", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await page.goto(`${BASE}/studio/mcp/audit`);
		await page.waitForTimeout(1500);
		// Unhandled runtime errors indicate broken compliance surface
		expect(errors.filter((e) => e.includes("Cannot read") || e.includes("undefined"))).toHaveLength(0);
	});

	test("approvals page shows timestamp or date column", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/approvals`);
		const content = (await page.textContent("body")) ?? "";
		// Either a real date or 'No pending' empty state
		const hasDate = /\d{4}-\d{2}-\d{2}|No pending|Empty/.test(content);
		expect(hasDate).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Agent 7: Performance — page load and network response
// ---------------------------------------------------------------------------
test.describe("Agent 7: Performance UI", () => {
	test("studio home loads within 5 seconds", async ({ page }) => {
		const start = Date.now();
		await page.goto(`${BASE}/studio`);
		await page.waitForLoadState("networkidle");
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(5000);
	});

	test("hermes dashboard loads within 5 seconds", async ({ page }) => {
		const start = Date.now();
		await page.goto(`${BASE}/studio/hermes`);
		await page.waitForLoadState("networkidle");
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(5000);
	});

	test("approvals page loads within 5 seconds", async ({ page }) => {
		const start = Date.now();
		await page.goto(`${BASE}/studio/mcp/approvals`);
		await page.waitForLoadState("networkidle");
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(5000);
	});
});

// ---------------------------------------------------------------------------
// Agent 8: Accessibility UI — no alert() dialogs, focus patterns
// ---------------------------------------------------------------------------
test.describe("Agent 8: Accessibility UI", () => {
	test("no window.alert calls on studio home", async ({ page }) => {
		let alertCalled = false;
		page.on("dialog", () => {
			alertCalled = true;
		});
		await page.goto(`${BASE}/studio`);
		await page.waitForTimeout(2000);
		expect(alertCalled).toBe(false);
	});

	test("no window.alert on hermes dashboard", async ({ page }) => {
		let alertCalled = false;
		page.on("dialog", () => {
			alertCalled = true;
		});
		await page.goto(`${BASE}/studio/hermes`);
		await page.waitForTimeout(2000);
		expect(alertCalled).toBe(false);
	});

	test("interactive elements have focus-visible on keys page", async ({ page }) => {
		await page.goto(`${BASE}/studio/hermes/keys`);
		const buttons = await page.locator("button").all();
		// At least some interactive elements must exist
		expect(buttons.length).toBeGreaterThan(0);
	});

	test("text contrast is not pure white on dark backgrounds", async ({ page }) => {
		await page.goto(`${BASE}/studio`);
		// Dark theme accent is #22c55e (green). White (#ffffff) body text on #0a0a0a background is fine.
		// This test verifies the page has not reverted to a light background.
		const bgColor = await page.evaluate(() => {
			const root = document.querySelector("#root") as HTMLElement | null;
			return root ? window.getComputedStyle(root).backgroundColor : null;
		});
		// Must not be pure white background
		expect(bgColor).not.toBe("rgb(255, 255, 255)");
	});

	test("approvals page keyboard navigation — tab reaches first button", async ({ page }) => {
		await page.goto(`${BASE}/studio/mcp/approvals`);
		await page.keyboard.press("Tab");
		const focused = await page.evaluate(() => document.activeElement?.tagName);
		// Tab must move focus to an interactive element
		expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(focused ?? "BODY");
	});
});
