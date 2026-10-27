import { describe, expect, it } from "vitest";

describe("P13-C+D: Hermes Dashboard", () => {
	it("HermesDashboardPage.tsx exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../apps/console/src/pages/studio/HermesDashboardPage.tsx"))).toBe(true);
	});

	it("HermesDashboardPage imports are correct", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(
			join(process.cwd(), "../../apps/console/src/pages/studio/HermesDashboardPage.tsx"),
			"utf8",
		);
		expect(src).toContain("useEffect");
		expect(src).toContain("useState");
		expect(src).toContain("/api/studio/hermes/tools");
		expect(src).toContain("HermesDashboardPage");
	});

	it("HermesDashboardPage renders stat cards and security posture", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(
			join(process.cwd(), "../../apps/console/src/pages/studio/HermesDashboardPage.tsx"),
			"utf8",
		);
		expect(src).toContain("Read-Only");
		expect(src).toContain("Security Posture");
		expect(src).toContain("Prompt injection detection");
		expect(src).toContain("Tenant isolation enforcement");
		expect(src).toContain("DENIED_WRITE_TOOLS");
	});

	it("HermesDashboardPage uses focus-visible pattern", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(
			join(process.cwd(), "../../apps/console/src/pages/studio/HermesDashboardPage.tsx"),
			"utf8",
		);
		// Page should not use raw :focus — uses focus-visible or no focus override
		expect(src).not.toContain('"focus:ring');
	});
});

describe("P13-H: Hermes Keys UI", () => {
	it("HermesKeysPage.tsx exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../apps/console/src/pages/studio/HermesKeysPage.tsx"))).toBe(true);
	});

	it("HermesKeysPage has create key flow", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/HermesKeysPage.tsx"), "utf8");
		expect(src).toContain("POST");
		expect(src).toContain("/api/studio/hermes/keys");
		expect(src).toContain("Create Key");
		expect(src).toContain("createdKey");
	});

	it("HermesKeysPage shows one-time key warning", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/HermesKeysPage.tsx"), "utf8");
		expect(src).toContain("shown only once");
		expect(src).toContain("SHA-256");
	});

	it("HermesKeysPage has revoke key action", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/HermesKeysPage.tsx"), "utf8");
		expect(src).toContain("DELETE");
		expect(src).toContain("Revoke");
	});

	it("HermesKeysPage uses focus-visible ring pattern", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/pages/studio/HermesKeysPage.tsx"), "utf8");
		expect(src).toContain("focus-visible:ring");
	});
});

describe("P13-I: Incident Response Playbook", () => {
	it("playbook exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/hermes-incident-response-playbook.md"))).toBe(true);
	});

	it("playbook covers API key compromise scenario", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-incident-response-playbook.md"), "utf8");
		expect(src).toContain("API key compromise");
	});

	it("playbook covers Prompt injection scenario", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-incident-response-playbook.md"), "utf8");
		expect(src).toContain("Prompt injection");
	});

	it("playbook covers Cross-tenant scenario", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-incident-response-playbook.md"), "utf8");
		expect(src).toContain("Cross-tenant");
	});

	it("playbook covers all 7 required scenarios", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-incident-response-playbook.md"), "utf8");
		expect(src).toContain("API key compromise");
		expect(src).toContain("Prompt injection");
		expect(src).toContain("Session budget abuse");
		expect(src).toContain("Data exfiltration");
		expect(src).toContain("Cross-tenant access");
		expect(src).toContain("DDoS");
		expect(src).toContain("Secret leaked");
	});

	it("playbook includes post-incident checklist", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-incident-response-playbook.md"), "utf8");
		expect(src).toContain("Post-Incident Checklist");
	});
});

describe("P13-L: Soak Report Template", () => {
	it("template exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/hermes-soak-report-template.md"))).toBe(true);
	});

	it("template includes test metadata section", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-soak-report-template.md"), "utf8");
		expect(src).toContain("Test Metadata");
		expect(src).toContain("Test Duration");
	});

	it("template includes read-only and denied tools sections", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-soak-report-template.md"), "utf8");
		expect(src).toContain("Read-Only Tools");
		expect(src).toContain("Write/Mutating Tools");
	});

	it("template includes prompt injection and session budget sections", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-soak-report-template.md"), "utf8");
		expect(src).toContain("Prompt Injection");
		expect(src).toContain("Session Budget");
	});

	it("template includes rate limiting behaviour section", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-soak-report-template.md"), "utf8");
		expect(src).toContain("Rate Limiting");
	});

	it("template includes sign-off checklist", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/hermes-soak-report-template.md"), "utf8");
		expect(src).toContain("Sign-Off Checklist");
		expect(src).toContain("Approvals");
	});
});

describe("P13-C+D+H: main.tsx routes registered", () => {
	it("HermesDashboardPage is registered in main.tsx", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(src).toContain("HermesDashboardPage");
		expect(src).toContain("/studio/hermes");
	});

	it("HermesKeysPage is registered in main.tsx", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../apps/console/src/main.tsx"), "utf8");
		expect(src).toContain("HermesKeysPage");
		expect(src).toContain("/studio/hermes/keys");
	});
});
