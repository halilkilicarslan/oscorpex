// ---------------------------------------------------------------------------
// Pipeline Engine tests
//  - buildDAGWaves: pure topological sort (Kahn's algorithm)
//  - findReviewerForAgent / findDevForReviewer: DB-backed lookup via review deps
//  - buildPipeline: stage structure from project agents + dependencies
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import {
	createAgentDependency,
	createPhase,
	createPlan,
	createProject,
	createProjectAgent,
	updatePlanStatus,
} from "../db.js";
import { execute } from "../pg.js";
import { pipelineEngine } from "../pipeline-engine.js";
import { buildDAGWaves } from "@oscorpex/task-graph";
import type { AgentDependency, ProjectAgent } from "../types.js";

// ---- Fixture builders ------------------------------------------------------

function makeAgent(id: string, role: string): ProjectAgent {
	return {
		id,
		projectId: "p",
		name: `${role}-${id}`,
		role,
		avatar: "",
		gender: "male",
		personality: "",
		model: "claude-sonnet-4-6",
		cliTool: "claude-code",
		skills: [],
		systemPrompt: "",
		createdAt: new Date().toISOString(),
		color: "#000",
		pipelineOrder: 0,
	};
}

function makeDep(from: string, to: string, type: AgentDependency["type"] = "workflow"): AgentDependency {
	return {
		id: `${from}-${to}-${type}`,
		projectId: "p",
		fromAgentId: from,
		toAgentId: to,
		type,
		createdAt: new Date().toISOString(),
	};
}

// ---- Pure DAG tests --------------------------------------------------------

describe("buildDAGWaves (pure)", () => {
	it("returns single wave when there are no dependencies", () => {
		const agents = [makeAgent("a", "dev"), makeAgent("b", "qa")];
		const waves = buildDAGWaves(agents, []);
		expect(waves).toHaveLength(1);
		expect(waves[0].sort()).toEqual(["a", "b"]);
	});

	it("puts root agents in first wave and dependents in later waves", () => {
		// a → b → c (b depends on a, c depends on b)
		const agents = [makeAgent("a", "pm"), makeAgent("b", "dev"), makeAgent("c", "qa")];
		const deps = [makeDep("a", "b"), makeDep("b", "c")];
		const waves = buildDAGWaves(agents, deps);
		expect(waves).toHaveLength(3);
		expect(waves[0]).toEqual(["a"]);
		expect(waves[1]).toEqual(["b"]);
		expect(waves[2]).toEqual(["c"]);
	});

	it("groups independent siblings in the same wave", () => {
		// a → b, a → c (b and c can run in parallel)
		const agents = [makeAgent("a", "pm"), makeAgent("b", "dev"), makeAgent("c", "dev")];
		const deps = [makeDep("a", "b"), makeDep("a", "c")];
		const waves = buildDAGWaves(agents, deps);
		expect(waves).toHaveLength(2);
		expect(waves[0]).toEqual(["a"]);
		expect(waves[1].sort()).toEqual(["b", "c"]);
	});

	it("ignores hierarchy edges (org-chart only)", () => {
		// hierarchy should NOT create pipeline dependencies
		const agents = [makeAgent("a", "pm"), makeAgent("b", "dev")];
		const deps = [makeDep("a", "b", "hierarchy")];
		const waves = buildDAGWaves(agents, deps);
		expect(waves).toHaveLength(1);
		expect(waves[0].sort()).toEqual(["a", "b"]);
	});

	it("honors review and gate edge types like workflow", () => {
		const agents = [makeAgent("dev", "dev"), makeAgent("rev", "reviewer"), makeAgent("ops", "devops")];
		const deps = [
			makeDep("dev", "rev", "review"), // dev → reviewer
			makeDep("rev", "ops", "gate"), // reviewer gates devops
		];
		const waves = buildDAGWaves(agents, deps);
		expect(waves).toHaveLength(3);
		expect(waves[0]).toEqual(["dev"]);
		expect(waves[1]).toEqual(["rev"]);
		expect(waves[2]).toEqual(["ops"]);
	});

	it("recovers gracefully from cyclic dependencies", () => {
		// a → b → a (cycle)
		const agents = [makeAgent("a", "dev"), makeAgent("b", "dev")];
		const deps = [makeDep("a", "b"), makeDep("b", "a")];
		const waves = buildDAGWaves(agents, deps);
		// All agents still included (graceful fallback)
		const flat = waves.flat().sort();
		expect(flat).toEqual(["a", "b"]);
	});

	it("handles dangling deps (referencing unknown agents)", () => {
		const agents = [makeAgent("a", "dev")];
		const deps = [makeDep("a", "ghost"), makeDep("ghost", "a")];
		const waves = buildDAGWaves(agents, deps);
		expect(waves).toHaveLength(1);
		expect(waves[0]).toEqual(["a"]);
	});
});

// ---- DB-backed tests -------------------------------------------------------

describe("PipelineEngine — DB-backed lookups", () => {
	beforeAll(async () => {
		await execute("DELETE FROM agent_dependencies");
		await execute("DELETE FROM tasks");
		await execute("DELETE FROM phases");
		await execute("DELETE FROM project_plans");
		await execute("DELETE FROM project_agents");
		await execute("DELETE FROM projects WHERE name LIKE 'PE Test%'");
	});

	async function setupProjectWithTeam() {
		const project = await createProject({
			name: "PE Test",
			description: "",
			techStack: [],
			repoPath: "",
		});
		const dev = await createProjectAgent({
			projectId: project.id,
			name: "Dev",
			role: "backend-dev",
			avatar: "",
			personality: "",
			model: "claude-sonnet-4-6",
			cliTool: "claude-code",
			skills: [],
			systemPrompt: "",
			color: "#22c55e",
			pipelineOrder: 1,
		});
		const reviewer = await createProjectAgent({
			projectId: project.id,
			name: "Rev",
			role: "code-reviewer",
			avatar: "",
			personality: "",
			model: "claude-sonnet-4-6",
			cliTool: "claude-code",
			skills: [],
			systemPrompt: "",
			color: "#ef4444",
			pipelineOrder: 2,
		});
		// Review dep: dev (from) → reviewer (to) — "dev's output goes to reviewer"
		await createAgentDependency(project.id, dev.id, reviewer.id, "review");
		return { project, dev, reviewer };
	}

	it("findReviewerForAgent returns the reviewer linked via review dep", async () => {
		const { project, dev, reviewer } = await setupProjectWithTeam();
		const found = await pipelineEngine.findReviewerForAgent(project.id, dev.id);
		expect(found?.id).toBe(reviewer.id);
	});

	it("findReviewerForAgent returns null when no review dep exists", async () => {
		const { project, reviewer } = await setupProjectWithTeam();
		// reviewer has no outgoing review dep
		const found = await pipelineEngine.findReviewerForAgent(project.id, reviewer.id);
		expect(found).toBeNull();
	});

	it("findDevForReviewer returns the dev linked via review dep", async () => {
		const { project, dev, reviewer } = await setupProjectWithTeam();
		const found = await pipelineEngine.findDevForReviewer(project.id, reviewer.id);
		expect(found?.id).toBe(dev.id);
	});

	it("findDevForReviewer returns null for agents with no incoming review dep", async () => {
		const { project, dev } = await setupProjectWithTeam();
		const found = await pipelineEngine.findDevForReviewer(project.id, dev.id);
		expect(found).toBeNull();
	});

	it("buildPipeline produces stages from approved plan + agent DAG", async () => {
		const { project } = await setupProjectWithTeam();
		const plan = await createPlan(project.id);
		await updatePlanStatus(plan.id, "approved");
		await createPhase({
			planId: plan.id,
			name: "Foundation",
			order: 1,
			dependsOn: [],
		});
		const state = await pipelineEngine.buildPipeline(project.id);
		expect(state.projectId).toBe(project.id);
		expect(state.status).toBe("idle");
		expect(state.stages.length).toBeGreaterThan(0);
	});

	it("buildPipeline throws when project is missing", async () => {
		await expect(pipelineEngine.buildPipeline("nonexistent-project-id")).rejects.toThrow();
	});
});
