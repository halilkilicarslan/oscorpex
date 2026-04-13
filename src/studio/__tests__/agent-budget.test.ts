// ---------------------------------------------------------------------------
// Oscorpex — Agent Budget Tests (Faz 3.2)
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import {
	createPhase,
	createPlan,
	createProject,
	createProjectAgent,
	createTask,
	getAgentCostSummary,
	getProjectCostSummary,
	getProjectSettingsMap,
	recordTokenUsage,
	setProjectSettings,
	updatePlanStatus,
} from "../db.js";
import { execute } from "../pg.js";
import { taskEngine } from "../task-engine.js";

// DB bağlantısı ve token_usage tablosu yoksa testleri atla
const hasDb = await (async () => {
	try {
		await execute("SELECT 1 FROM token_usage LIMIT 0");
		return true;
	} catch {
		return false;
	}
})();

describe.skipIf(!hasDb)("Agent Budget (Faz 3.2)", () => {
	beforeAll(async () => {
		await execute("DELETE FROM token_usage");
		await execute("DELETE FROM project_settings");
		await execute("DELETE FROM tasks");
		await execute("DELETE FROM phases");
		await execute("DELETE FROM project_plans");
		await execute("DELETE FROM project_agents");
		await execute("DELETE FROM projects");
	});

	// ---- getAgentCostSummary ------------------------------------------------

	describe("getAgentCostSummary", () => {
		it("should return zero summary when no usage recorded", async () => {
			const project = await createProject({ name: "Budget Test", description: "", techStack: [], repoPath: "" });
			const agent = await createProjectAgent({
				projectId: project.id,
				name: "Coder",
				role: "developer",
				avatar: "🧑‍💻",
				personality: "focused",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "You are a developer.",
			});

			const summary = await getAgentCostSummary(project.id, agent.id);
			expect(summary.totalCostUsd).toBe(0);
			expect(summary.totalTokens).toBe(0);
			expect(summary.taskCount).toBe(0);
		});

		it("should aggregate token usage for a specific agent", async () => {
			const project = await createProject({ name: "Budget Agg Test", description: "", techStack: [], repoPath: "" });
			const agentA = await createProjectAgent({
				projectId: project.id,
				name: "Alpha",
				role: "developer",
				avatar: "🅰️",
				personality: "fast",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "Alpha agent.",
			});
			const agentB = await createProjectAgent({
				projectId: project.id,
				name: "Beta",
				role: "reviewer",
				avatar: "🅱️",
				personality: "thorough",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "Beta agent.",
			});

			// Agent A: two usage records
			await recordTokenUsage({
				projectId: project.id,
				taskId: "task-001",
				agentId: agentA.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150,
				costUsd: 0.003,
			});
			await recordTokenUsage({
				projectId: project.id,
				taskId: "task-002",
				agentId: agentA.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 200,
				outputTokens: 100,
				totalTokens: 300,
				costUsd: 0.006,
			});

			// Agent B: one usage record (should NOT affect Agent A summary)
			await recordTokenUsage({
				projectId: project.id,
				taskId: "task-003",
				agentId: agentB.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 500,
				outputTokens: 200,
				totalTokens: 700,
				costUsd: 0.05,
			});

			const summaryA = await getAgentCostSummary(project.id, agentA.id);
			expect(summaryA.totalInputTokens).toBe(300);
			expect(summaryA.totalOutputTokens).toBe(150);
			expect(summaryA.totalTokens).toBe(450);
			expect(summaryA.totalCostUsd).toBeCloseTo(0.009, 6);
			expect(summaryA.taskCount).toBe(2);

			// Agent B should only see its own records
			const summaryB = await getAgentCostSummary(project.id, agentB.id);
			expect(summaryB.totalTokens).toBe(700);
			expect(summaryB.taskCount).toBe(1);
		});

		it("should not cross-contaminate between projects", async () => {
			const p1 = await createProject({ name: "Project 1", description: "", techStack: [], repoPath: "" });
			const p2 = await createProject({ name: "Project 2", description: "", techStack: [], repoPath: "" });
			const agent1 = await createProjectAgent({
				projectId: p1.id,
				name: "Dev1",
				role: "developer",
				avatar: "👩‍💻",
				personality: "",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "",
			});
			const agent2 = await createProjectAgent({
				projectId: p2.id,
				name: "Dev2",
				role: "developer",
				avatar: "👩‍💻",
				personality: "",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "",
			});

			await recordTokenUsage({
				projectId: p1.id,
				taskId: "x-task-1",
				agentId: agent1.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150,
				costUsd: 0.002,
			});

			// p2 agent summary should be zero even though agent1 has usage in p1
			const s = await getAgentCostSummary(p2.id, agent2.id);
			expect(s.totalCostUsd).toBe(0);
		});
	});

	// ---- checkProjectBudget with agentId ------------------------------------

	describe("checkProjectBudget — agent-level budget via startTask", () => {
		async function setupWithBudget(agentMaxCostUsd: number) {
			const project = await createProject({ name: "Budget Agent Test", description: "", techStack: [], repoPath: "" });
			const agent = await createProjectAgent({
				projectId: project.id,
				name: "BudgetCoder",
				role: "developer",
				avatar: "💰",
				personality: "",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "",
			});

			// Enable budget with no project-level limit but agent-level limit set
			await setProjectSettings(project.id, "budget", {
				enabled: "true",
				maxCostUsd: "999", // high project limit so only agent limit triggers
				agent_max_cost_usd: String(agentMaxCostUsd),
			});

			const plan = await createPlan(project.id);
			await updatePlanStatus(plan.id, "approved");
			const phase = await createPhase({ planId: plan.id, name: "Phase 1", order: 1, dependsOn: [] });
			const task = await createTask({
				phaseId: phase.id,
				title: "Implement feature",
				description: "Write code",
				assignedAgent: agent.id,
				complexity: "S",
				dependsOn: [],
				branch: "feat/test",
			});

			// Link task to agent via assignedAgentId — update directly
			await execute("UPDATE tasks SET assigned_agent_id = $1 WHERE id = $2", [agent.id, task.id]);

			return { project, agent, task };
		}

		it("should block task start when agent budget is exceeded", async () => {
			const { project, agent, task } = await setupWithBudget(0.001);

			// Record usage that exceeds the per-agent limit
			await recordTokenUsage({
				projectId: project.id,
				taskId: "prev-task",
				agentId: agent.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 5000,
				outputTokens: 2000,
				totalTokens: 7000,
				costUsd: 0.05,
			});

			await taskEngine.assignTask(task.id, agent.id);
			const result = await taskEngine.startTask(task.id);

			// Task should be failed due to agent budget exceeded
			expect(result.status).toBe("failed");
			expect(result.error).toMatch(/[Aa]gent budget/);
		});

		it("should allow task start when agent budget is not exceeded", async () => {
			const { agent, task } = await setupWithBudget(100);

			// Minimal usage — well within limit
			await recordTokenUsage({
				projectId: (await createProject({ name: "Under Budget", description: "", techStack: [], repoPath: "" })).id,
				taskId: "unrelated",
				agentId: agent.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 10,
				outputTokens: 5,
				totalTokens: 15,
				costUsd: 0.0001,
			});

			await taskEngine.assignTask(task.id, agent.id);
			const result = await taskEngine.startTask(task.id);

			expect(result.status).toBe("running");
		});
	});

	// ---- budget/status endpoint (logic layer) -------------------------------

	describe("budget/status response structure", () => {
		it("should reflect correct project and agent budget info", async () => {
			const project = await createProject({ name: "Status Test", description: "", techStack: [], repoPath: "" });
			const agent = await createProjectAgent({
				projectId: project.id,
				name: "StatusAgent",
				role: "developer",
				avatar: "📊",
				personality: "",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "",
			});

			await setProjectSettings(project.id, "budget", {
				maxCostUsd: "10",
				agent_max_cost_usd: "2",
			});

			await recordTokenUsage({
				projectId: project.id,
				taskId: "status-task",
				agentId: agent.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 1000,
				outputTokens: 500,
				totalTokens: 1500,
				costUsd: 1.5,
			});

			// Validate via the same db functions the endpoint uses
			const settings = await getProjectSettingsMap(project.id);
			const budgetSettings = settings["budget"] || {};
			const maxCost = budgetSettings["maxCostUsd"] ? Number.parseFloat(budgetSettings["maxCostUsd"]) : null;
			const agentMaxCost = budgetSettings["agent_max_cost_usd"]
				? Number.parseFloat(budgetSettings["agent_max_cost_usd"])
				: null;

			expect(maxCost).toBe(10);
			expect(agentMaxCost).toBe(2);

			const projectCost = await getProjectCostSummary(project.id);
			expect(projectCost.totalCostUsd).toBeCloseTo(1.5, 5);
			expect(maxCost !== null && projectCost.totalCostUsd >= maxCost).toBe(false);

			const agentCost = await getAgentCostSummary(project.id, agent.id);
			expect(agentCost.totalCostUsd).toBeCloseTo(1.5, 5);
			expect(agentMaxCost !== null && agentCost.totalCostUsd >= agentMaxCost!).toBe(false); // 1.5 >= 2 is false
		});

		it("should report agent budget exceeded when cost meets the limit", async () => {
			const project = await createProject({ name: "Exceeded Test", description: "", techStack: [], repoPath: "" });
			const agent = await createProjectAgent({
				projectId: project.id,
				name: "ExpensiveAgent",
				role: "developer",
				avatar: "💸",
				personality: "",
				model: "claude-sonnet-4-6",
				cliTool: "claude",
				skills: [],
				systemPrompt: "",
			});

			await recordTokenUsage({
				projectId: project.id,
				taskId: "big-task",
				agentId: agent.id,
				model: "claude-sonnet-4-6",
				provider: "anthropic",
				inputTokens: 10000,
				outputTokens: 5000,
				totalTokens: 15000,
				costUsd: 3.0,
			});

			const agentMaxCost = 2.0;
			const agentCost = await getAgentCostSummary(project.id, agent.id);
			const budgetExceeded = agentCost.totalCostUsd >= agentMaxCost;

			expect(budgetExceeded).toBe(true);
		});
	});
});
