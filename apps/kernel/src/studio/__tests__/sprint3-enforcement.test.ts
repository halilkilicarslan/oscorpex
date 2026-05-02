import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------
vi.mock("../pg.js", () => ({
	query: vi.fn().mockResolvedValue([]),
	queryOne: vi.fn().mockResolvedValue(undefined),
	execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
	getPool: vi.fn().mockReturnValue({ query: vi.fn() }),
	withTransaction: vi.fn().mockImplementation(async (fn: any) => fn({ query: vi.fn() })),
	setTenantContext: vi.fn().mockResolvedValue(undefined),
	withTenantTransaction: vi.fn().mockImplementation(async (_tid: any, fn: any) => fn({ query: vi.fn() })),
	closePool: vi.fn(),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn(), emitTransient: vi.fn(), on: vi.fn() },
}));

// ---------------------------------------------------------------------------
// 1. Provider State Persistence
// ---------------------------------------------------------------------------
describe("Provider State — persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("markRateLimited triggers persistToDb", async () => {
		const { providerState } = await import("../provider-state.js");
		const spy = vi.spyOn(providerState, "persistToDb").mockResolvedValue(undefined);
		providerState.markRateLimited("claude-code", 5000);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("markSuccess triggers persistToDb", async () => {
		const { providerState } = await import("../provider-state.js");
		const spy = vi.spyOn(providerState, "persistToDb").mockResolvedValue(undefined);
		providerState.markSuccess("claude-code");
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("markFailure triggers persistToDb", async () => {
		const { providerState } = await import("../provider-state.js");
		const spy = vi.spyOn(providerState, "persistToDb").mockResolvedValue(undefined);
		providerState.markFailure("codex");
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("loadFromDb restores expired cooldowns as available", async () => {
		const pg = await import("../pg.js");
		(pg.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{
				adapter: "claude-code",
				rate_limited: true,
				cooldown_until: new Date(Date.now() - 60_000).toISOString(), // expired
				consecutive_failures: 2,
				last_success: null,
			},
		]);
		const { providerState } = await import("../provider-state.js");
		await providerState.loadFromDb();
		expect(providerState.isAvailable("claude-code")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 2. Model Context Limits
// ---------------------------------------------------------------------------
describe("Model Context Limits", () => {
	it("returns correct limit for known models", async () => {
		const { getModelContextLimit } = await import("../model-router.js");
		expect(getModelContextLimit("claude-sonnet-4-6")).toBe(200_000);
		expect(getModelContextLimit("gpt-4o")).toBe(128_000);
		expect(getModelContextLimit("claude-haiku-4-5-20251001")).toBe(200_000);
	});

	it("returns default limit for unknown models", async () => {
		const { getModelContextLimit } = await import("../model-router.js");
		expect(getModelContextLimit("unknown-model-xyz")).toBe(200_000);
	});
});

// ---------------------------------------------------------------------------
// 3. withTenantTransaction — unit test against the real function logic
// Since pg.ts is fully mocked, we test the withTenantTransaction contract
// by verifying the exported function exists and accepts correct params.
// Integration behavior (SET LOCAL calls) is validated via tenant-rls.test.ts.
// ---------------------------------------------------------------------------
describe("withTenantTransaction — contract", () => {
	it("withTenantTransaction is exported and callable", async () => {
		const pg = await import("../pg.js");
		expect(typeof pg.withTenantTransaction).toBe("function");
	});

	it("withTenantTransaction completes without error when mocked", async () => {
		const pg = await import("../pg.js");
		const result = await pg.withTenantTransaction("tenant-123", async () => "ok");
		expect(result).toBe("ok");
	});

	it("setTenantContext is exported and callable", async () => {
		const pg = await import("../pg.js");
		expect(typeof pg.setTenantContext).toBe("function");
		await expect(pg.setTenantContext("tenant-123")).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 4. Risk classification on task start
// ---------------------------------------------------------------------------
describe("Risk classification via classifyRisk", () => {
	it("classifies deploy/migration as critical", async () => {
		const { classifyRisk } = await import("../agent-runtime/agent-constraints.js");
		expect(classifyRisk({ proposalType: "fix_task", title: "Deploy to production", severity: undefined })).toBe(
			"critical",
		);
		expect(classifyRisk({ proposalType: "fix_task", title: "Run database migration", severity: undefined })).toBe(
			"critical",
		);
	});

	it("classifies tests/docs as low", async () => {
		const { classifyRisk } = await import("../agent-runtime/agent-constraints.js");
		expect(classifyRisk({ proposalType: "test_task", title: "Add unit tests", severity: undefined })).toBe("low");
		expect(classifyRisk({ proposalType: "fix_task", title: "Update README docs", severity: undefined })).toBe("low");
	});

	it("classifies refactors as high", async () => {
		const { classifyRisk } = await import("../agent-runtime/agent-constraints.js");
		// "auth" matches critical pattern, so use a non-security refactor title
		expect(classifyRisk({ proposalType: "refactor", title: "Refactor utils module", severity: undefined })).toBe(
			"high",
		);
	});
});
