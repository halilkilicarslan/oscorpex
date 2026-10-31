import { describe, expect, it } from "vitest";

describe("P8: Approval UI pages exist", () => {
	it("ApprovalsPage.tsx exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../apps/console/src/pages/studio/ApprovalsPage.tsx"))).toBe(true);
	});

	it("McpAuditPage.tsx exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../apps/console/src/pages/studio/McpAuditPage.tsx"))).toBe(true);
	});

	it("McpMetricsPage.tsx exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../apps/console/src/pages/studio/McpMetricsPage.tsx"))).toBe(true);
	});

	it("remaining focus:outline-none count reduced", async () => {
		const { execSync } = await import("node:child_process");
		const { join } = await import("node:path");
		const count = execSync("rg -c 'focus:outline-none' apps/console/src 2>/dev/null | awk -F: '{s+=$2}END{print s}'", {
			cwd: join(process.cwd(), "../.."),
			encoding: "utf8",
		}).trim();
		// P7 fixed 40, should be well below 153 original
		expect(Number.parseInt(count || "0")).toBeLessThan(120);
	});
});
