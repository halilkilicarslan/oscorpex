// ---------------------------------------------------------------------------
// F3-d — boot must start its timers and background work outside any explicit tenant/system scope.
// Every boot phase is mocked: nothing real (migrations, HTTP server, timers, agents) runs here.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

const phases = vi.hoisted(() => ({
	dbPhase: vi.fn(async () => {}),
	authConfigPhase: vi.fn(),
	enginePhase: vi.fn(async () => {}),
	providerStatePhase: vi.fn(async () => {}),
	websocketPhase: vi.fn(),
	webhookPhase: vi.fn(),
	containerPoolPhase: vi.fn(),
	recoveryPhase: vi.fn(async () => {}),
	pipelinePhase: vi.fn(async () => {}),
	providerRegistryPhase: vi.fn(async () => {}),
	replayPhase: vi.fn(),
	httpPhase: vi.fn(() => ({ app: {}, server: {} })),
}));

vi.mock("../../boot-phases/db-phase.js", () => ({ dbPhase: phases.dbPhase }));
vi.mock("../../boot-phases/auth-config-phase.js", () => ({ authConfigPhase: phases.authConfigPhase }));
vi.mock("../../boot-phases/engine-phase.js", () => ({ enginePhase: phases.enginePhase }));
vi.mock("../../boot-phases/provider-state-phase.js", () => ({ providerStatePhase: phases.providerStatePhase }));
vi.mock("../../boot-phases/websocket-phase.js", () => ({ websocketPhase: phases.websocketPhase }));
vi.mock("../../boot-phases/webhook-phase.js", () => ({ webhookPhase: phases.webhookPhase }));
vi.mock("../../boot-phases/container-pool-phase.js", () => ({ containerPoolPhase: phases.containerPoolPhase }));
vi.mock("../../boot-phases/recovery-phase.js", () => ({ recoveryPhase: phases.recoveryPhase }));
vi.mock("../../boot-phases/pipeline-phase.js", () => ({ pipelinePhase: phases.pipelinePhase }));
vi.mock("../../boot-phases/provider-registry-phase.js", () => ({
	providerRegistryPhase: phases.providerRegistryPhase,
}));
vi.mock("../../boot-phases/replay-phase.js", () => ({ replayPhase: phases.replayPhase }));
vi.mock("../../boot-phases/http-phase.js", () => ({ httpPhase: phases.httpPhase }));
vi.mock("../composition/index.js", () => ({
	registerEventBridges: vi.fn(),
	registerNotificationBridge: vi.fn(),
	registerPluginBridge: vi.fn(),
	registerSeeders: vi.fn(async () => {}),
	registerWebhookBridge: vi.fn(),
}));
vi.mock("../graph-coordinator.js", () => ({ registerGraphSplitBridge: vi.fn() }));
vi.mock("../service-registry.js", () => ({ registerService: vi.fn() }));
vi.mock("../execution-engine.js", () => ({ executionEngine: () => ({}) }));
vi.mock("../task-engine.js", () => ({ taskEngine: () => ({}) }));
vi.mock("../pipeline-engine.js", () => ({ pipelineEngine: () => ({}) }));

import { bootKernel } from "../../boot.js";
import { TenantScopeError, runAsSystem, runInTenant, runOutsideScope } from "../tenancy/tenant-scope.js";
import { TENANT_A } from "./helpers/tenancy.js";

beforeEach(() => {
	for (const fn of Object.values(phases)) fn.mockClear();
});

describe("F3-d - boot scope assertion", () => {
	it("throws TenantScopeError, before any phase runs, inside an explicit tenant scope", async () => {
		await runOutsideScope(() =>
			runInTenant(TENANT_A, async () => {
				await expect(bootKernel({ port: 0 })).rejects.toBeInstanceOf(TenantScopeError);
			}),
		);
		expect(phases.dbPhase).not.toHaveBeenCalled();
		expect(phases.httpPhase).not.toHaveBeenCalled();
	});

	it("throws TenantScopeError inside an explicit system scope too", async () => {
		await runOutsideScope(() =>
			runAsSystem("f3d-boot-test", async () => {
				await expect(bootKernel({ port: 0 })).rejects.toBeInstanceOf(TenantScopeError);
			}),
		);
		expect(phases.dbPhase).not.toHaveBeenCalled();
	});

	it("boots from no scope", async () => {
		await runOutsideScope(async () => {
			await expect(bootKernel({ port: 0 })).resolves.toMatchObject({ port: 0 });
		});
		expect(phases.dbPhase).toHaveBeenCalledTimes(1);
		expect(phases.httpPhase).toHaveBeenCalledTimes(1);
	});

	it("boots from the implicit default test scope", async () => {
		await expect(bootKernel({ port: 0 })).resolves.toMatchObject({ port: 0 });
		expect(phases.dbPhase).toHaveBeenCalledTimes(1);
	});
});
