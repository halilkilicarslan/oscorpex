import { beforeAll, describe, expect, it } from "vitest";
import {
	createAgentConfig,
	createPhase,
	createPlan,
	createProject,
	createTask,
	deleteAgentConfig,
	deleteProject,
	getLatestPlan,
	getPlan,
	getProject,
	getTask,
	insertChatMessage,
	insertEvent,
	listAgentConfigs,
	listChatMessages,
	listEvents,
	listPresetAgents,
	listProjectTasks,
	listProjects,
	seedPresetAgents,
	updatePlanStatus,
	updateProject,
	updateTask,
} from "../db.js";
import { execute, query } from "../pg.js";

// Use PostgreSQL DB for tests. Tables must already exist (run migrations before tests).
// Reset state between runs by deleting records in beforeAll.

// Skip entire suite if DB tables don't exist (CI without migrations)
let dbReady = false;
try {
	await query("SELECT 1 FROM chat_messages LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available or tables missing */
}

describe.skipIf(!dbReady)("Studio DB", () => {
	beforeAll(async () => {
		// Clean up tables so tests start with a known empty state
		await execute("DELETE FROM chat_messages");
		await execute("DELETE FROM events");
		await execute("DELETE FROM tasks");
		await execute("DELETE FROM phases");
		await execute("DELETE FROM project_plans");
		await execute("DELETE FROM project_agents");
		await execute("DELETE FROM projects");
		await execute("DELETE FROM agent_configs");
	});

	// ---- Projects -----------------------------------------------------------

	describe("Projects", () => {
		it("should create and retrieve a project", async () => {
			const project = await createProject({
				name: "Test App",
				description: "A test project",
				techStack: ["React", "Node.js"],
				repoPath: "/tmp/test-app",
			});

			expect(project.id).toBeTruthy();
			expect(project.name).toBe("Test App");
			expect(project.status).toBe("planning");
			expect(project.techStack).toEqual(["React", "Node.js"]);

			const fetched = await getProject(project.id);
			expect(fetched).toBeDefined();
			expect(fetched!.name).toBe("Test App");
		});

		it("should list projects", async () => {
			const projects = await listProjects();
			expect(projects.length).toBeGreaterThan(0);
		});

		it("should update a project", async () => {
			const project = await createProject({
				name: "Update Test",
				description: "",
				techStack: [],
				repoPath: "",
			});
			const updated = await updateProject(project.id, { status: "running", techStack: ["Vue"] });
			expect(updated!.status).toBe("running");
			expect(updated!.techStack).toEqual(["Vue"]);
		});

		it("should delete a project", async () => {
			const project = await createProject({ name: "Delete Me", description: "", techStack: [], repoPath: "" });
			expect(await deleteProject(project.id)).toBe(true);
			expect(await getProject(project.id)).toBeUndefined();
		});
	});

	// ---- Plans & Phases & Tasks ---------------------------------------------

	describe("Plans, Phases, Tasks", () => {
		it("should create a full plan hierarchy", async () => {
			const project = await createProject({ name: "Plan Test", description: "", techStack: [], repoPath: "" });
			const plan = await createPlan(project.id);

			expect(plan.version).toBe(1);
			expect(plan.status).toBe("draft");

			const phase = await createPhase({ planId: plan.id, name: "Foundation", order: 1, dependsOn: [] });
			expect(phase.status).toBe("pending");

			const task = await createTask({
				phaseId: phase.id,
				title: "Setup project",
				description: "Initialize the project",
				assignedAgent: "agent-1",
				complexity: "S",
				dependsOn: [],
				branch: "feat/setup",
			});
			expect(task.status).toBe("queued");
			expect(task.retryCount).toBe(0);

			// Retrieve full plan with phases and tasks
			const fullPlan = await getPlan(plan.id);
			expect(fullPlan!.phases).toHaveLength(1);
			expect(fullPlan!.phases[0].tasks).toHaveLength(1);
			expect(fullPlan!.phases[0].tasks[0].title).toBe("Setup project");
		});

		it("should update task status", async () => {
			const project = await createProject({ name: "Task Test", description: "", techStack: [], repoPath: "" });
			const plan = await createPlan(project.id);
			const phase = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
			const task = await createTask({
				phaseId: phase.id,
				title: "T1",
				description: "",
				assignedAgent: "",
				complexity: "M",
				dependsOn: [],
				branch: "",
			});

			const updated = await updateTask(task.id, { status: "running", startedAt: new Date().toISOString() });
			expect(updated!.status).toBe("running");
			expect(updated!.startedAt).toBeTruthy();
		});

		it("should list project tasks across phases", async () => {
			const project = await createProject({ name: "Multi Phase", description: "", techStack: [], repoPath: "" });
			const plan = await createPlan(project.id);
			const p1 = await createPhase({ planId: plan.id, name: "P1", order: 1, dependsOn: [] });
			const p2 = await createPhase({ planId: plan.id, name: "P2", order: 2, dependsOn: [p1.id] });
			await createTask({
				phaseId: p1.id,
				title: "T1",
				description: "",
				assignedAgent: "",
				complexity: "S",
				dependsOn: [],
				branch: "",
			});
			await createTask({
				phaseId: p2.id,
				title: "T2",
				description: "",
				assignedAgent: "",
				complexity: "L",
				dependsOn: [],
				branch: "",
			});

			const tasks = await listProjectTasks(project.id);
			expect(tasks).toHaveLength(2);
		});

		it("should get latest plan", async () => {
			const project = await createProject({ name: "Version Test", description: "", techStack: [], repoPath: "" });
			await createPlan(project.id);
			const plan2 = await createPlan(project.id);

			const latest = await getLatestPlan(project.id);
			expect(latest!.version).toBe(2);
			expect(latest!.id).toBe(plan2.id);
		});

		it("should update plan status", async () => {
			const project = await createProject({ name: "Approve Test", description: "", techStack: [], repoPath: "" });
			const plan = await createPlan(project.id);
			await updatePlanStatus(plan.id, "approved");
			const fetched = await getPlan(plan.id);
			expect(fetched!.status).toBe("approved");
		});
	});

	// ---- Agent Configs ------------------------------------------------------

	describe("Agent Configs", () => {
		it("should create and list agent configs", async () => {
			const agent = await createAgentConfig({
				name: "TestBot",
				role: "coder",
				avatar: "🤖",
				gender: "male",
				personality: "Helpful",
				model: "claude-sonnet-4-6",
				cliTool: "claude-code",
				skills: ["typescript"],
				systemPrompt: "You are a test bot.",
				isPreset: false,
			});

			expect(agent.id).toBeTruthy();
			const all = await listAgentConfigs();
			expect(all.some((a) => a.id === agent.id)).toBe(true);
		});

		it("should not delete preset agents", async () => {
			const preset = await createAgentConfig({
				name: "Preset",
				role: "pm",
				avatar: "📋",
				gender: "male",
				personality: "",
				model: "claude-sonnet-4-6",
				cliTool: "none",
				skills: [],
				systemPrompt: "",
				isPreset: true,
			});

			expect(await deleteAgentConfig(preset.id)).toBe(false);
		});

		it("should seed preset agents only once", async () => {
			await seedPresetAgents();
			const presets1 = await listPresetAgents();
			await seedPresetAgents(); // idempotent
			const presets2 = await listPresetAgents();
			expect(presets1.length).toBe(presets2.length);
			expect(presets1.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ---- Events -------------------------------------------------------------

	describe("Events", () => {
		it("should insert and list events", async () => {
			const project = await createProject({ name: "Event Test", description: "", techStack: [], repoPath: "" });
			await insertEvent({ projectId: project.id, type: "task:started", payload: { foo: "bar" } });
			await insertEvent({ projectId: project.id, type: "task:completed", agentId: "a1", taskId: "t1", payload: {} });

			const events = await listEvents(project.id);
			expect(events).toHaveLength(2);
			expect(events.map((e) => e.type)).toContain("task:completed");
		});
	});

	// ---- Chat Messages ------------------------------------------------------

	describe("Chat Messages", () => {
		it("should insert and list chat messages", async () => {
			const project = await createProject({ name: "Chat Test", description: "", techStack: [], repoPath: "" });
			await insertChatMessage({ projectId: project.id, role: "user", content: "Hello PM" });
			await insertChatMessage({ projectId: project.id, role: "assistant", content: "Hi! How can I help?" });

			const messages = await listChatMessages(project.id);
			expect(messages).toHaveLength(2);
			expect(messages[0].role).toBe("user"); // ASC order
			expect(messages[1].role).toBe("assistant");
		});
	});
});
