// ---------------------------------------------------------------------------
// Memory Provider Mode Tests (S3-01 ~ S3-02)
// Verifies recovery and verification modes produce meaningful prompts.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";
import { createProject, createPlan, createPhase, createTask, execute } from "../../db.js";
import { memoryProvider } from "../memory-adapter.js";
import { randomUUID } from "node:crypto";

async function setTaskStatus(taskId: string, status: string, error?: string, output?: string): Promise<void> {
	await execute("UPDATE tasks SET status = $1, error = $2, output = $3 WHERE id = $4", [
		status,
		error ?? null,
		output ?? null,
		taskId,
	]);
}

describe("KernelMemoryProvider — recovery mode", () => {
	it("includes error and retry context", async () => {
		const project = await createProject({ name: "RecoveryTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "Failing task", description: "should fix auth", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await setTaskStatus(task.id, "failed", "TypeError: Cannot read property 'token' of undefined");

		const packet = await memoryProvider.buildContextPacket({
			projectId: project.id,
			taskId: task.id,
			mode: "recovery",
			maxTokens: 10_000,
		});

		expect(packet.text).toContain("recovering from a previous execution failure");
		expect(packet.text).toContain("Failing task");
		expect(packet.text).toContain("TypeError");
		expect(packet.tokenEstimate).toBeGreaterThan(0);
	});

	it("includes previous output when available", async () => {
		const project = await createProject({ name: "RecoveryOutTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "Out task", description: "desc", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await setTaskStatus(
			task.id,
			"failed",
			"SyntaxError",
			JSON.stringify({ filesCreated: ["src/a.ts"], filesModified: [], logs: ["line 1", "line 2"] }),
		);

		const packet = await memoryProvider.buildContextPacket({
			projectId: project.id,
			taskId: task.id,
			mode: "recovery",
		});

		expect(packet.text).toContain("src/a.ts");
		expect(packet.text).toContain("Previous Output");
	});
});

describe("KernelMemoryProvider — verification mode", () => {
	it("includes changed files and test results", async () => {
		const project = await createProject({ name: "VerifyTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "Verify task", description: "implement auth with acceptance criteria: user can login", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await setTaskStatus(
			task.id,
			"done",
			undefined,
			JSON.stringify({
				filesCreated: ["src/auth.ts"],
				filesModified: ["src/index.ts"],
				logs: [],
				testResults: { passed: 5, failed: 0, total: 5 },
			}),
		);

		const packet = await memoryProvider.buildContextPacket({
			projectId: project.id,
			taskId: task.id,
			mode: "verification",
		});

		expect(packet.text).toContain("verifying execution results");
		expect(packet.text).toContain("src/auth.ts");
		expect(packet.text).toContain("Test Results");
		expect(packet.text).toContain("Passed: 5");
		expect(packet.text).toContain("acceptance criteria");
	});

	it("includes verification results from DB", async () => {
		const project = await createProject({ name: "VerifyDBTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });
		const plan = await createPlan(project.id);
		const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
		const task = await createTask({ phaseId: phase.id, title: "V task", description: "desc", assignedAgent: "a1", complexity: "S", dependsOn: [], branch: "main" });
		await setTaskStatus(task.id, "done", undefined, JSON.stringify({ filesCreated: [], filesModified: [], logs: [] }));
		await execute(
			`INSERT INTO verification_results (id, task_id, verification_type, status, details, created_at)
			 VALUES ($1, $2, $3, $4, $5, now())`,
			[randomUUID(), task.id, "files_exist", "passed", JSON.stringify([{ file: "src/x.ts" }])],
		);

		const packet = await memoryProvider.buildContextPacket({
			projectId: project.id,
			taskId: task.id,
			mode: "verification",
		});

		expect(packet.text).toContain("Verification Results");
		expect(packet.text).toContain("files_exist: passed");
	});
});

describe("KernelMemoryProvider — existing modes still work", () => {
	it("planner mode produces a prompt", async () => {
		const project = await createProject({ name: "PlannerTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });

		const packet = await memoryProvider.buildContextPacket({
			projectId: project.id,
			mode: "planner",
			maxTokens: 10_000,
		});

		expect(packet.text.length).toBeGreaterThan(0);
		expect(packet.mode).toBe("planner");
	});

	it("execution mode requires taskId", async () => {
		const project = await createProject({ name: "ExecTest", description: "test", techStack: ["node"], repoPath: "/tmp/test" });

		await expect(
			memoryProvider.buildContextPacket({ projectId: project.id, mode: "execution" }),
		).rejects.toThrow("taskId is required");
	});
});