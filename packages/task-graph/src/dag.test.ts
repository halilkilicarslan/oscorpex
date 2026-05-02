import { describe, expect, it } from "vitest";
import { buildDAGStages, buildDAGWaves, findDevAgentId, findReviewerAgentId } from "./index.js";
import type { DependencyEdge, GraphAgent, PlanPhase } from "./types.js";

const agents: GraphAgent[] = [
	{ id: "backend", name: "Backend Dev", role: "backend-dev", skills: [] },
	{ id: "frontend", name: "Frontend Dev", role: "frontend-dev", skills: [] },
	{ id: "qa", name: "QA", role: "qa-engineer", skills: [] },
];

describe("@oscorpex/task-graph DAG scheduling", () => {
	it("builds waves from blocking dependencies and ignores non-blocking edges", () => {
		const deps: DependencyEdge[] = [
			{ fromAgentId: "backend", toAgentId: "qa", type: "review" },
			{ fromAgentId: "frontend", toAgentId: "qa", type: "notification" },
		];

		expect(buildDAGWaves(agents, deps)).toEqual([["backend", "frontend"], ["qa"]]);
	});

	it("keeps paired agents in the same wave", () => {
		const deps: DependencyEdge[] = [
			{ fromAgentId: "backend", toAgentId: "qa", type: "workflow" },
			{ fromAgentId: "backend", toAgentId: "frontend", type: "pair" },
		];

		expect(buildDAGWaves(agents, deps)).toEqual([["backend", "frontend"], ["qa"]]);
	});

	it("finds review edge participants", () => {
		const deps: DependencyEdge[] = [{ fromAgentId: "backend", toAgentId: "qa", type: "review" }];

		expect(findReviewerAgentId("backend", deps)).toBe("qa");
		expect(findDevAgentId("qa", deps)).toBe("backend");
	});

	it("assigns planned tasks to DAG stages by agent role and keeps review tasks with their target", () => {
		const deps: DependencyEdge[] = [{ fromAgentId: "backend", toAgentId: "qa", type: "review" }];
		const phases: PlanPhase[] = [
			{
				id: "phase-1",
				order: 1,
				name: "Foundation",
				status: "pending",
				tasks: [
					{
						id: "task-1",
						title: "Build API",
						status: "pending",
						assignedAgent: "backend",
						complexity: "M",
						description: "",
						dependsOn: [],
						phaseId: "phase-1",
					},
					{
						id: "review-1",
						title: "Code Review: Build API",
						status: "pending",
						assignedAgent: "qa",
						complexity: "S",
						description: "",
						dependsOn: ["task-1"],
						phaseId: "phase-1",
					},
				],
			},
		];

		const stages = buildDAGStages(agents, deps, phases);

		expect(stages).toHaveLength(2);
		expect(stages[0]?.tasks.map((task) => task.id)).toEqual(["task-1", "review-1"]);
		expect(stages[1]?.agents.map((agent) => agent.id)).toEqual(["qa"]);
	});
});
