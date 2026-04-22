// ---------------------------------------------------------------------------
// Oscorpex — Graph Routes: Dynamic coordination graph, goals, replanning
// Phase 3 API endpoints for dynamic platform capabilities.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { listGraphMutations } from "../db.js";
import {
	insertNode,
	splitTask,
	addEdge,
	removeEdge,
	deferBranch,
	mergeIntoPhase,
	getMutationHistory,
	approveGraphMutationRequest,
	rejectGraphMutationRequest,
} from "../graph-coordinator.js";
import {
	createGoal,
	getGoal,
	getGoalForTask,
	listGoals,
	activateGoal,
	evaluateGoal,
	failGoal,
} from "../goal-engine.js";
import {
	evaluateReplan,
	getReplanEvent,
	listReplanEvents,
	approveReplanEvent,
	rejectReplanEvent,
} from "../adaptive-replanner.js";
import {
	getLearningPatterns,
	getGlobalPatterns,
	extractPatternsFromEpisodes,
	promoteToGlobal,
} from "../cross-project-learning.js";
import { canonicalizeAgentRole, getBehaviorRoleKey } from "../roles.js";
import { createLogger } from "../logger.js";
const log = createLogger("graph-routes");

export const graphRoutes = new Hono();

// ---------------------------------------------------------------------------
// Graph Mutations
// ---------------------------------------------------------------------------

graphRoutes.get("/projects/:projectId/graph-mutations", async (c) => {
	try {
		const pipelineRunId = c.req.query("pipelineRunId");
		const mutations = await listGraphMutations(c.req.param("projectId"), pipelineRunId);
		return c.json(mutations);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.get("/projects/:projectId/graph-mutations/:runId/history", async (c) => {
	try {
		const history = await getMutationHistory(c.req.param("projectId"), c.req.param("runId"));
		return c.json(history);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/graph/insert-node", async (c) => {
	try {
		const body = await c.req.json();
		const result = await insertNode(
			{ projectId: c.req.param("projectId"), pipelineRunId: body.pipelineRunId, causedByAgentId: body.agentId },
			{ phaseId: body.phaseId, title: body.title, description: body.description, assignedAgent: body.assignedAgent, complexity: body.complexity, dependsOn: body.dependsOn },
		);
		return c.json(result, 201);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/graph/split-task", async (c) => {
	try {
		const body = await c.req.json();
		const result = await splitTask(
			{ projectId: c.req.param("projectId"), pipelineRunId: body.pipelineRunId, causedByAgentId: body.agentId },
			{ parentTaskId: body.parentTaskId, children: body.children },
		);
		return c.json(result, 201);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/graph/add-edge", async (c) => {
	try {
		const body = await c.req.json();
		const result = await addEdge(
			{ projectId: c.req.param("projectId"), pipelineRunId: body.pipelineRunId, causedByAgentId: body.agentId },
			{ fromTaskId: body.fromTaskId, toTaskId: body.toTaskId },
		);
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/graph/remove-edge", async (c) => {
	try {
		const body = await c.req.json();
		const result = await removeEdge(
			{ projectId: c.req.param("projectId"), pipelineRunId: body.pipelineRunId, causedByAgentId: body.agentId },
			{ fromTaskId: body.fromTaskId, toTaskId: body.toTaskId },
		);
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/graph/defer-branch", async (c) => {
	try {
		const body = await c.req.json();
		const result = await deferBranch(
			{ projectId: c.req.param("projectId"), pipelineRunId: body.pipelineRunId, causedByAgentId: body.agentId },
			{ phaseId: body.phaseId, reason: body.reason },
		);
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/graph/merge-into-phase", async (c) => {
	try {
		const body = await c.req.json();
		const result = await mergeIntoPhase(
			{ projectId: c.req.param("projectId"), pipelineRunId: body.pipelineRunId, causedByAgentId: body.agentId },
			{ sourcePhaseId: body.sourcePhaseId, targetPhaseId: body.targetPhaseId, tasks: body.tasks },
		);
		return c.json(result, 201);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/graph-mutations/:mutationId/approve", async (c) => {
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await approveGraphMutationRequest(c.req.param("mutationId"), body.approvedBy ?? "human");
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/graph-mutations/:mutationId/reject", async (c) => {
	try {
		const body = await c.req.json().catch(() => ({}));
		const result = await rejectGraphMutationRequest(c.req.param("mutationId"), body.reason ?? "Rejected by human");
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

graphRoutes.get("/projects/:projectId/goals", async (c) => {
	try {
		const status = c.req.query("status");
		const goals = await listGoals(c.req.param("projectId"), status as any);
		return c.json(goals);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.get("/goals/:goalId", async (c) => {
	try {
		const goal = await getGoal(c.req.param("goalId"));
		if (!goal) return c.json({ error: "Goal not found" }, 404);
		return c.json(goal);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.get("/tasks/:taskId/goal", async (c) => {
	try {
		const goal = await getGoalForTask(c.req.param("taskId"));
		if (!goal) return c.json({ error: "No goal for this task" }, 404);
		return c.json(goal);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/goals", async (c) => {
	try {
		const body = await c.req.json();
		const goal = await createGoal({
			projectId: c.req.param("projectId"),
			taskId: body.taskId,
			definition: body.definition,
		});
		return c.json(goal, 201);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/goals/:goalId/activate", async (c) => {
	try {
		const goal = await activateGoal(c.req.param("goalId"));
		return c.json(goal);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/goals/:goalId/evaluate", async (c) => {
	try {
		const body = await c.req.json();
		const goal = await evaluateGoal(c.req.param("goalId"), body.results);
		return c.json(goal);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/goals/:goalId/fail", async (c) => {
	try {
		const body = await c.req.json();
		const goal = await failGoal(c.req.param("goalId"), body.reason);
		return c.json(goal);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Adaptive Replanning
// ---------------------------------------------------------------------------

graphRoutes.get("/projects/:projectId/replan-events", async (c) => {
	try {
		const limit = Number(c.req.query("limit") ?? "20");
		const events = await listReplanEvents(c.req.param("projectId"), limit);
		return c.json(events);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/projects/:projectId/replan", async (c) => {
	try {
		const body = await c.req.json();
		const result = await evaluateReplan({
			projectId: c.req.param("projectId"),
			trigger: body.trigger ?? "manual",
			phaseId: body.phaseId,
			metadata: body.metadata,
		});
		if (!result) return c.json({ message: "No replan needed" }, 200);
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.get("/replan-events/:eventId", async (c) => {
	try {
		const event = await getReplanEvent(c.req.param("eventId"));
		if (!event) return c.json({ error: "Replan event not found" }, 404);
		return c.json(event);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/replan-events/:eventId/approve", async (c) => {
	try {
		const body = await c.req.json().catch(() => ({}));
		const event = await approveReplanEvent(c.req.param("eventId"), body.approvedBy ?? "human");
		return c.json(event);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/replan-events/:eventId/reject", async (c) => {
	try {
		const body = await c.req.json().catch(() => ({}));
		const event = await rejectReplanEvent(c.req.param("eventId"), body.reason ?? "Rejected by human");
		return c.json(event);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Cross-Project Learning
// ---------------------------------------------------------------------------

graphRoutes.get("/learning/patterns", async (c) => {
	try {
		const taskType = c.req.query("taskType") ?? "ai";
		const agentRole = canonicalizeAgentRole(c.req.query("agentRole") ?? "backend-dev");
		const tenantId = c.req.query("tenantId");
		const patterns = await getLearningPatterns(taskType, getBehaviorRoleKey(agentRole), tenantId);
		return c.json(patterns);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.get("/learning/global", async (c) => {
	try {
		const learningType = c.req.query("type") ?? "strategy_success";
		const limit = Number(c.req.query("limit") ?? "20");
		const patterns = await getGlobalPatterns(learningType as any, limit);
		return c.json(patterns);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/learning/extract/:tenantId", async (c) => {
	try {
		const count = await extractPatternsFromEpisodes(c.req.param("tenantId"));
		return c.json({ patternsCreated: count });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

graphRoutes.post("/learning/promote/:patternId", async (c) => {
	try {
		const result = await promoteToGlobal(c.req.param("patternId"));
		if (!result) return c.json({ error: "Pattern not found" }, 404);
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});
