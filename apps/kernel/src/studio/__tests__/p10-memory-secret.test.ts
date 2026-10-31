import { describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("P10-I: Memory Pruning Planner", () => {
	it("returns read-only report with no deletions", async () => {
		const { memoryPruningPlanner } = await import("../scheduler/jobs/memory-pruning-planner.js");
		const result = await memoryPruningPlanner({ jobId: "test", startedAt: new Date().toISOString() });
		expect(result.status).toBe("completed");
		const output = result.output as Record<string, unknown>;
		expect(output.note).toContain("no memories deleted");
	});

	it("returns empty candidates array by default", async () => {
		const { memoryPruningPlanner } = await import("../scheduler/jobs/memory-pruning-planner.js");
		const result = await memoryPruningPlanner({ jobId: "test-2", startedAt: new Date().toISOString() });
		const output = result.output as Record<string, unknown>;
		expect(output.type).toBe("memory-pruning-plan");
		expect(Array.isArray(output.candidates)).toBe(true);
		expect(output.candidateCount).toBe(0);
	});

	it("echoes jobId in result", async () => {
		const { memoryPruningPlanner } = await import("../scheduler/jobs/memory-pruning-planner.js");
		const result = await memoryPruningPlanner({ jobId: "echo-test", startedAt: new Date().toISOString() });
		expect(result.jobId).toBe("echo-test");
	});
});

describe("P10-J: Secret Guard Expansion", () => {
	it("secret-guard.ts has expanded patterns", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/mcp-bridge/secret-guard.ts"), "utf8");
		// Check for new patterns
		expect(src).toContain("github_pat_");
		expect(src).toContain("glpat-");
		expect(src).toContain("sk_live_");
		expect(src).toContain("AIza");
	});

	it("detects Stripe live key", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets(`STRIPE_KEY=${"sk_" + "live_"}abcdefghijklmnopqrstuvwx`).safe).toBe(false);
	});

	it("detects GitLab PAT", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("token: glpat-abcdefghijklmnopqrstuvwx").safe).toBe(false);
	});

	it("detects GitHub fine-grained PAT", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("auth: github_pat_abcdefghijklmnopqrstuvwxyz1234567890").safe).toBe(false);
	});

	it("detects Google API key", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("key=AIzaSyA1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q").safe).toBe(false);
	});

	it("detects Stripe test key", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets(`STRIPE_TEST=${"sk_" + "test_"}abcdefghijklmnopqrstuvwx`).safe).toBe(false);
	});

	it("detects Redis URL with password", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("REDIS_URL=redis://user:supersecret@localhost:6379").safe).toBe(false);
	});

	it("detects SendGrid API key", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		// SG. + 22 chars + . + 43 chars
		expect(checkForSecrets("SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmn").safe).toBe(
			false,
		);
	});

	it("allows safe content through", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("Hello, world! This is a normal log message.").safe).toBe(true);
	});

	it("redacts secrets in audit output", async () => {
		const { redactForAudit } = await import("../mcp-bridge/secret-guard.js");
		const redacted = redactForAudit("token=glpat-abcdefghijklmnopqrstuvwx");
		expect(redacted).toContain("[REDACTED]");
		expect(redacted).not.toContain("glpat-");
	});
});

describe("P10-L: Hermes/Gateway Risk Assessment", () => {
	it("document exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/architecture/hermes-gateway-risk-assessment.md"))).toBe(true);
	});

	it("document covers required sections", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/architecture/hermes-gateway-risk-assessment.md"), "utf8");
		expect(src).toContain("Threat Model");
		expect(src).toContain("No-Go");
		expect(src).toContain("Tenant Isolation");
	});

	it("document contains Hermes-specific risk section", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/architecture/hermes-gateway-risk-assessment.md"), "utf8");
		expect(src).toContain("Hermes-Specific");
		expect(src).toContain("Rate Limiting");
		expect(src).toContain("Approval Requirements");
	});
});

describe("P10-M: Production Telemetry", () => {
	it("document exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/production-telemetry-review.md"))).toBe(true);
	});

	it("document covers health check endpoints", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "../../docs/production/production-telemetry-review.md"), "utf8");
		expect(src).toContain("/health");
		expect(src).toContain("Alert");
		expect(src).toContain("Capacity Planning");
	});
});
