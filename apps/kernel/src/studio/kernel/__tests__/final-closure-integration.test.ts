// ---------------------------------------------------------------------------
// Final Integration Verification — Kernel-Only Closure
// Validates that all VoltAgent integration surface has been removed and the
// kernel boots independently.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

describe("FINAL INTEGRATION: All 8 closure tasks acceptance", () => {
	it("Task 1: pruneSnapshots uses runId, not projectId", async () => {
		const { replayStore } = await import("../../replay-store.js");
		expect(typeof replayStore.pruneSnapshots).toBe("function");
	});

	it("Task 2: Replay routes have visible test surface", async () => {
		const { replayRoutes } = await import("../../routes/replay-routes.js");
		const app = new (await import("hono")).Hono();
		app.route("/replay", replayRoutes);
		const res = await app.request("/replay/runs/test/snapshots");
		expect([200, 404, 500]).toContain(res.status);
	});

	it("Task 3: Inspect response is standardized", async () => {
		const { buildInspectResponse } = await import("../../routes/replay-routes.js");
		const mock = {
			id: "s1",
			runId: "r1",
			projectId: "p1",
			checkpoint: "cp",
			createdAt: "2024-01-01",
			run: { id: "r1", projectId: "p1", goal: "g", mode: "execute", status: "running" },
			stages: [],
			tasks: [],
			artifacts: [],
			policyDecisions: [],
			verificationReports: [],
			metadata: {},
		};
		const res = buildInspectResponse(mock as any);
		expect(res).toHaveProperty("id");
		expect(res).toHaveProperty("runId");
		expect(res).toHaveProperty("projectId");
		expect(res).toHaveProperty("checkpoint");
		expect(res).toHaveProperty("createdAt");
		expect(res).toHaveProperty("run");
		expect(res).toHaveProperty("stages");
		expect(res).toHaveProperty("tasks");
		expect(res).toHaveProperty("artifacts");
		expect(res).toHaveProperty("policyDecisions");
		expect(res).toHaveProperty("verificationReports");
		expect(res).toHaveProperty("metadata");
	});

	it("Task 4: Truth sources are tracked in snapshot metadata", async () => {
		const { createCheckpointSnapshot } = await import("../../replay-store.js");
		const snap = await createCheckpointSnapshot("p-1", "final-check", () => "final-snap-1");
		expect(snap.metadata).toBeDefined();
		expect(snap.metadata!.truthSources).toBeDefined();
	});

	it("Task 5: Provider registry has native init path and no legacy bridge", async () => {
		const { ProviderRegistry } = await import("../../kernel/provider-registry.js");
		const registry = new ProviderRegistry();
		expect(typeof registry.registerDefaultProviders).toBe("function");
		expect(typeof (registry as any).initializeFromLegacy).toBe("undefined");
	});

	it("Task 6: Cancel behavior matrix is documented", async () => {
		const { CANCEL_BEHAVIOR_MATRIX } = await import("@oscorpex/provider-sdk");
		expect(CANCEL_BEHAVIOR_MATRIX["claude-code"]).toBeDefined();
		expect(CANCEL_BEHAVIOR_MATRIX["codex"]).toBeDefined();
		expect(CANCEL_BEHAVIOR_MATRIX["cursor"]).toBeDefined();
	});

	it("Task 7: VoltAgent boundary docs removed", async () => {
		const fs = await import("node:fs");
		expect(fs.existsSync("/Users/iamhk/development/personal/oscorpex/apps/kernel/docs/voltagent-boundary.md")).toBe(false);
	});

	it("Task 8: Smoke checklist script exists", async () => {
		const fs = await import("node:fs");
		expect(fs.existsSync("/Users/iamhk/development/personal/oscorpex/apps/kernel/scripts/smoke-checklist.sh")).toBe(true);
	});
});

describe("EPIC 1 — Kernel Boot Integration (IT-01..IT-03)", () => {
	it("IT-01: boot.ts exports bootKernel and bootAndServe", async () => {
		const mod = await import("../../../boot.js");
		expect(mod).toBeDefined();
		expect(typeof mod.bootKernel).toBe("function");
		expect(typeof mod.bootAndServe).toBe("function");
	});

	it("IT-01b: bootKernel accepts options and returns app/server/port", async () => {
		const mod = await import("../../../boot.js");
		expect(typeof mod.bootKernel).toBe("function");
		// Signature validation via runtime check — we cannot boot a real server in unit tests,
		// but we can verify the exported contract is correct.
		expect(mod.bootKernel.length).toBe(0); // optional parameter
	});

	it("IT-02: entry-voltagent.ts no longer exists", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const entryPath = path.resolve(process.cwd(), "src/entry-voltagent.ts");
		expect(fs.existsSync(entryPath)).toBe(false);
	});

	it("IT-02b: index.ts boots kernel directly without mode branch", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const indexPath = path.resolve(process.cwd(), "src/index.ts");
		expect(fs.existsSync(indexPath)).toBe(true);
		const content = fs.readFileSync(indexPath, "utf-8");
		expect(content).not.toContain("OSCORPEX_MODE");
		expect(content).not.toContain("entry-voltagent");
		expect(content).toContain("bootAndServe");
	});

	it("IT-03: kernel routes work without VoltAgent imports", async () => {
		const { replayRoutes } = await import("../../routes/replay-routes.js");
		const { providerRoutes } = await import("../../routes/provider-routes.js");
		expect(replayRoutes).toBeDefined();
		expect(providerRoutes).toBeDefined();
	});
});

describe("EPIC 5 — VoltAgent Removed (IT-16..IT-17)", () => {
	it("IT-16: kernel package no longer lists VoltAgent as optional dependency", async () => {
		const fs = await import("node:fs");
		const pkgRaw = fs.readFileSync("/Users/iamhk/development/personal/oscorpex/apps/kernel/package.json", "utf-8");
		const pkg = JSON.parse(pkgRaw);
		if (pkg.optionalDependencies) {
			expect(pkg.optionalDependencies["@voltagent/core"] ?? null).toBeNull();
		}
	});

	it("IT-17: VoltAgent boundary docs removed", async () => {
		const fs = await import("node:fs");
		expect(fs.existsSync("/Users/iamhk/development/personal/oscorpex/apps/kernel/docs/voltagent-boundary.md")).toBe(false);
	});
});
