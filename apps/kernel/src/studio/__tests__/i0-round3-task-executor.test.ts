// ---------------------------------------------------------------------------
// I0 round 3 — L1 / N-S2 at the task-executor level (executeTaskInner), with every collaborator mocked except the
// sandbox guard + workspace resolver:
//   * when the sandbox policy cannot be resolved the task FAILS and no provider is ever run (fail closed);
//   * when isolation is unavailable (container/vm) the task fails AND the session already opened by prompt assembly
//     is closed with failSession and an `agent:error` event is emitted.
// ---------------------------------------------------------------------------

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTmp } from "./helpers/i0-fakes.js";

const m = vi.hoisted(() => ({
	repoPath: "",
	policy: undefined as unknown,
	policyError: undefined as Error | undefined,
	failTask: vi.fn(async () => undefined),
	failSession: vi.fn(async (..._args: unknown[]) => undefined),
	completeSession: vi.fn(async () => undefined),
	emit: vi.fn(),
	runProviderTask: vi.fn(async () => {
		throw new Error("provider must not run");
	}),
	dispatch: vi.fn(async () => undefined),
}));

vi.mock("../agent-log-store.js", () => ({ persistAgentLog: vi.fn(async () => undefined) }));
vi.mock("../agent-runtime.js", () => ({ agentRuntime: { getAgentOutput: () => [] } }));
vi.mock("../agent-runtime/index.js", () => ({ failSession: m.failSession, completeSession: m.completeSession }));
vi.mock("../checkpoint/index.js", () => ({ createCheckpoint: vi.fn(async () => undefined) }));
vi.mock("../command-policy.js", () => ({
	enforceCommandPolicy: () => ({ totalChecked: 0, commands: [] }),
	getDefaultPolicy: () => ({ role: "dev" }),
}));
vi.mock("../db.js", () => ({
	claimTask: vi.fn(),
	getAgentConfig: vi.fn(async () => undefined),
	getProject: vi.fn(async () => ({ id: "p1", name: "p1", repoPath: m.repoPath })),
	getTask: vi.fn(async () => undefined),
	recordCommandAuditBatch: vi.fn(),
	releaseTaskClaim: vi.fn(),
	updateTask: vi.fn(),
}));
vi.mock("../event-bus.js", () => ({ eventBus: { emit: m.emit } }));
vi.mock("../preflight-warmup.js", () => ({ markExecutionStarted: () => ({ isColdStart: false }) }));
vi.mock("../repo-dependency-sync.js", () => ({
	syncDeclaredDependencies: () => ({ ranInstall: false, ok: true, missingBefore: [], missingAfter: [] }),
}));
vi.mock("../retry-policy.js", () => ({ MAX_AUTO_RETRIES: 3, evaluateRetry: () => ({ shouldRetry: false }) }));
vi.mock("../sandbox-manager.js", () => ({
	SandboxViolationError: class SandboxViolationError extends Error {},
	resolveTaskPolicy: async () => {
		if (m.policyError) throw m.policyError;
		return m.policy;
	},
	startSandboxSession: async () => ({ id: "sbx-1" }),
	endSandboxSession: async () => undefined,
	enforceToolCheck: async () => undefined,
	enforcePathChecks: async () => undefined,
	enforceOutputSizeCheck: async () => undefined,
}));
vi.mock("../security/tool-policy-enforcer.js", () => ({
	ToolPolicyDeniedError: class ToolPolicyDeniedError extends Error {},
	enforceToolPolicy: vi.fn(),
}));
vi.mock("../task-engine.js", () => ({
	taskEngine: () => ({
		failTask: m.failTask,
		assignTask: vi.fn(),
		startTask: vi.fn(),
	}),
}));
vi.mock("../timeout-policy.js", () => ({
	TIMEOUT_WARNING_THRESHOLD: 0.8,
	resolveTaskTimeoutMs: async () => 1000,
}));
vi.mock("../execution/agent-resolver.js", () => ({
	resolveTaskAgent: async () => ({ id: "a1", role: "developer", name: "a1", cliTool: "claude-code" }),
	resolveTaskModel: async () => ({ routedModel: { model: "m", provider: "claude" } }),
	resolveTaskTools: async () => [],
}));
vi.mock("../execution/execution-gates-runner.js", () => ({ runGoalGate: vi.fn(), runOutputAndTestGates: vi.fn() }));
vi.mock("../execution/prompt-assembler.js", () => ({
	assemblePrompt: async () => ({ blocked: false, prompt: "do it", sessionId: "sess-1", goalId: "goal-1" }),
}));
vi.mock("../execution/provider-task-runner.js", () => ({ runProviderTask: m.runProviderTask }));
vi.mock("../execution/queue-wait.js", () => ({ computeQueueWaitMs: () => 0 }));
vi.mock("../execution/review-task-runner.js", () => ({ executeTaskReview: vi.fn() }));
vi.mock("../execution/special-task-runner.js", () => ({ executeSpecialTask: vi.fn() }));
vi.mock("../execution/task-output-handler.js", () => ({
	buildTaskOutput: vi.fn(),
	recordOutputReceived: vi.fn(),
	runTaskCompletionEffects: vi.fn(),
}));
vi.mock("../execution/task-start-service.js", () => ({
	startTaskForExecution: async (task: unknown) => ({ ...(task as object), status: "running" }),
}));
vi.mock("../execution/task-timeout.js", () => ({ TaskTimeoutError: class TaskTimeoutError extends Error {} }));

import { TaskExecutor } from "../execution/task-executor.js";

let work: string;
const policy = (isolationLevel: string) => ({
	id: "pol",
	projectId: "p1",
	isolationLevel,
	allowedTools: [],
	deniedTools: [],
	filesystemScope: [],
	networkPolicy: "project_only",
	maxExecutionTimeMs: 300_000,
	maxOutputSizeBytes: 10_485_760,
	elevatedCapabilities: [],
	enforcementMode: "off",
});
const task = {
	id: "task-1",
	phaseId: "ph1",
	title: "Implement the thing",
	description: "d",
	assignedAgent: "dev",
	status: "queued",
	complexity: "S",
	dependsOn: [],
	branch: "main",
	retryCount: 0,
	revisionCount: 0,
	requiresApproval: false,
} as never;

async function run() {
	const executor = new TaskExecutor(new Map(), {} as never);
	await executor.executeTaskInner("p1", task, vi.fn(), m.dispatch).catch(() => undefined);
}

beforeAll(() => {
	work = freshTmp("oscx-i0-r3-te-");
	m.repoPath = join(work, "repo");
	mkdirSync(m.repoPath);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));
beforeEach(() => {
	m.policy = undefined;
	m.policyError = undefined;
	for (const f of [m.failTask, m.failSession, m.emit, m.runProviderTask, m.dispatch]) f.mockClear();
});

describe("L1: the task fails closed when the sandbox policy cannot be resolved", () => {
	it("resolveTaskPolicy throws: failTask is called and no provider runs in the source repo", async () => {
		m.policyError = new Error("DB down");
		await run();
		expect(m.runProviderTask).not.toHaveBeenCalled();
		expect(m.failTask).toHaveBeenCalledTimes(1);
	});

	it("workspace isolation with a healthy policy still reaches the provider (regression)", async () => {
		m.policy = policy("workspace");
		await run();
		expect(m.runProviderTask).toHaveBeenCalled();
	});
});

describe("N-S2: an isolation failure closes the already-open session and emits agent:error", () => {
	for (const level of ["container", "vm"]) {
		it(`isolationLevel "${level}"`, async () => {
			m.policy = policy(level);
			await run();
			expect(m.runProviderTask).not.toHaveBeenCalled();
			expect(m.failTask).toHaveBeenCalledTimes(1);
			expect(m.failSession).toHaveBeenCalledTimes(1);
			expect(m.failSession.mock.calls[0]?.[0]).toBe("sess-1");
			const types = m.emit.mock.calls.map((c) => (c[0] as { type: string }).type);
			expect(types).toContain("agent:error");
		});
	}
});
