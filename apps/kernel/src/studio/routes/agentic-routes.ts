// ---------------------------------------------------------------------------
// Oscorpex — Agentic Routes: Agent sessions, episodes, strategies, protocol, proposals, approvals
// Phase 2 API endpoints for agentic capabilities.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { canAutoApprove, classifyRisk } from "../agent-runtime/agent-constraints.js";
import { formatBehavioralPrompt, loadBehavioralContext } from "../agent-runtime/agent-memory.js";
import { BUILTIN_STRATEGIES } from "../agent-runtime/agent-strategy.js";
import { proposeTask } from "../agent-runtime/task-injection.js";
import { getAgenticMetrics } from "../agentic-metrics.js";
import {
	approveProposal,
	createApprovalRule,
	deleteCapabilityGrant,
	getAgentSession,
	getBestStrategies,
	getCapabilityGrants,
	getDefaultGrantsForRole,
	getFailureEpisodes,
	getProposal,
	getProtocolMessage,
	getRecentEpisodes,
	getStrategiesForRole,
	getTask,
	getTaskMessages,
	getUnreadMessages,
	hasCapability,
	listAgentSessions,
	listApprovalRules,
	listProposals,
	listStrategies,
	markMessageActioned,
	rejectProposal,
	upsertCapabilityGrant,
} from "../db.js";
import { kernel } from "../kernel/index.js";
import { createLogger } from "../logger.js";
import { canonicalizeAgentRole, getBehaviorRoleKey } from "../roles.js";
import type { CapabilityToken, ProposalStatus } from "../types.js";
const log = createLogger("agentic-routes");

export const agenticRoutes = new Hono();

// ---------------------------------------------------------------------------
// Agent Sessions
// ---------------------------------------------------------------------------

agenticRoutes.get("/projects/:projectId/sessions", async (c) => {
	try {
		const sessions = await listAgentSessions(c.req.param("projectId"), undefined, 50);
		return c.json(sessions);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/sessions/:sessionId", async (c) => {
	try {
		const session = await getAgentSession(c.req.param("sessionId"));
		if (!session) return c.json({ error: "Session not found" }, 404);
		return c.json(session);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Episodes (Behavioral Memory)
// ---------------------------------------------------------------------------

agenticRoutes.get("/projects/:projectId/agents/:agentId/episodes", async (c) => {
	try {
		const { projectId, agentId } = c.req.param();
		const taskType = c.req.query("taskType") ?? "ai";
		const limit = Number(c.req.query("limit") ?? "10");
		const episodes = await getRecentEpisodes(projectId, agentId, taskType, limit);
		return c.json(episodes);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/projects/:projectId/agents/:agentId/failures", async (c) => {
	try {
		const { projectId, agentId } = c.req.param();
		const limit = Number(c.req.query("limit") ?? "5");
		const failures = await getFailureEpisodes(projectId, agentId, limit);
		return c.json(failures);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/projects/:projectId/agents/:agentId/behavioral-context", async (c) => {
	try {
		const { projectId, agentId } = c.req.param();
		const role = canonicalizeAgentRole(c.req.query("role") ?? "backend-dev");
		const taskType = c.req.query("taskType") ?? "ai";
		const ctx = await loadBehavioralContext(projectId, agentId, role, taskType);
		return c.json({ context: ctx, formattedPrompt: formatBehavioralPrompt(ctx) });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

agenticRoutes.get("/strategies", async (c) => {
	try {
		const strategies = await listStrategies();
		return c.json({ db: strategies, builtin: BUILTIN_STRATEGIES });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/strategies/:role", async (c) => {
	try {
		const role = canonicalizeAgentRole(c.req.param("role"));
		const taskType = c.req.query("taskType");
		const strategyRole = getBehaviorRoleKey(role);
		const strategies = await getStrategiesForRole(strategyRole, taskType);
		const builtin = BUILTIN_STRATEGIES.filter((s) => s.agentRole === strategyRole);
		return c.json({ db: strategies, builtin });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/projects/:projectId/strategy-patterns", async (c) => {
	try {
		const { projectId } = c.req.param();
		const role = canonicalizeAgentRole(c.req.query("role") ?? "backend-dev");
		const taskType = c.req.query("taskType") ?? "ai";
		const limit = Number(c.req.query("limit") ?? "10");
		const patterns = await getBestStrategies(projectId, getBehaviorRoleKey(role), taskType, limit);
		return c.json(patterns);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Protocol Messages
// ---------------------------------------------------------------------------

agenticRoutes.get("/projects/:projectId/agents/:agentId/messages", async (c) => {
	try {
		const { projectId, agentId } = c.req.param();
		const limit = Number(c.req.query("limit") ?? "20");
		const messages = await getUnreadMessages(projectId, agentId, limit);
		return c.json(messages);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/projects/:projectId/tasks/:taskId/protocol-messages", async (c) => {
	try {
		const messages = await getTaskMessages(c.req.param("projectId"), c.req.param("taskId"));
		return c.json(messages);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Task Proposals
// ---------------------------------------------------------------------------

agenticRoutes.get("/projects/:projectId/proposals", async (c) => {
	try {
		const status = c.req.query("status") as ProposalStatus | undefined;
		const proposals = await listProposals(c.req.param("projectId"), status);
		return c.json(proposals);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/proposals/:proposalId", async (c) => {
	try {
		const proposal = await getProposal(c.req.param("proposalId"));
		if (!proposal) return c.json({ error: "Proposal not found" }, 404);
		return c.json(proposal);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.post("/projects/:projectId/proposals", async (c) => {
	try {
		const body = await c.req.json();
		const result = await proposeTask({
			projectId: c.req.param("projectId"),
			originatingAgentId: body.originatingAgentId,
			proposalType: body.proposalType,
			title: body.title,
			description: body.description,
			severity: body.severity,
			suggestedRole: body.suggestedRole,
			phaseId: body.phaseId,
			complexity: body.complexity,
		});
		return c.json(result, result.autoApproved ? 201 : 200);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.post("/proposals/:proposalId/approve", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { approvedBy?: string };
		const result = await approveProposal(c.req.param("proposalId"), body.approvedBy ?? "human");
		if (!result) return c.json({ error: "Proposal not found" }, 404);
		if (result.taskId) {
			const task = await getTask(result.taskId);
			if (task) {
				const ready = await kernel.getReadyTasks(task.phaseId);
				if (ready.some((candidate) => candidate.id === task.id)) {
					kernel
						// kernel Task is structurally compatible with CoreTask at the boundary
						.executeTask(result.proposal.projectId, task as unknown as import("@oscorpex/core").Task)
						.catch((err) => log.warn("[agentic-routes] Non-blocking operation failed:", err?.message ?? err));
				}
			}
		}
		return c.json(result);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.post("/protocol-messages/:messageId/actioned", async (c) => {
	try {
		const message = await getProtocolMessage(c.req.param("messageId"));
		if (!message) return c.json({ error: "Protocol message not found" }, 404);

		await markMessageActioned(message.id);

		if (message.relatedTaskId) {
			const remaining = await getTaskMessages(message.projectId, message.relatedTaskId);
			const hasOpenBlockers = remaining.some(
				(msg) =>
					msg.id !== message.id &&
					(msg.messageType === "blocker_alert" ||
						msg.messageType === "request_info" ||
						msg.messageType === "dependency_warning") &&
					msg.status !== "actioned" &&
					msg.status !== "dismissed",
			);

			const task = await getTask(message.relatedTaskId);
			if (task && task.status === "blocked" && !hasOpenBlockers) {
				await import("../db.js").then(({ updateTask }) => updateTask(task.id, { status: "queued" }));
				const refreshed = await getTask(task.id);
				if (refreshed) {
					const ready = await kernel.getReadyTasks(refreshed.phaseId);
					if (ready.some((candidate) => candidate.id === refreshed.id)) {
						kernel
							// kernel Task is structurally compatible with CoreTask at the boundary
							.executeTask(message.projectId, refreshed as unknown as import("@oscorpex/core").Task)
							.catch((err) => log.warn("[agentic-routes] Non-blocking operation failed:", err?.message ?? err));
					}
				}
			}
		}

		return c.json({ success: true });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.post("/proposals/:proposalId/reject", async (c) => {
	try {
		const body = await c.req.json();
		const proposal = await rejectProposal(c.req.param("proposalId"), body.reason);
		if (!proposal) return c.json({ error: "Proposal not found" }, 404);
		return c.json(proposal);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Risk Classification (utility endpoint)
// ---------------------------------------------------------------------------

agenticRoutes.post("/classify-risk", async (c) => {
	try {
		const body = await c.req.json();
		const riskLevel = classifyRisk(body);
		const autoApproveResult = body.projectId
			? await canAutoApprove(body.projectId, body)
			: { autoApprove: riskLevel === "low", riskLevel, reason: "No project context" };
		return c.json(autoApproveResult);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Approval Rules
// ---------------------------------------------------------------------------

agenticRoutes.get("/projects/:projectId/approval-rules", async (c) => {
	try {
		const rules = await listApprovalRules(c.req.param("projectId"));
		return c.json(rules);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.post("/projects/:projectId/approval-rules", async (c) => {
	try {
		const body = await c.req.json();
		const rule = await createApprovalRule({
			projectId: c.req.param("projectId"),
			actionType: body.actionType,
			riskLevel: body.riskLevel,
			requiresApproval: body.requiresApproval,
			autoApprove: body.autoApprove,
			maxPerRun: body.maxPerRun,
			description: body.description,
		});
		return c.json(rule, 201);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Capability Grants (Section 14.3)
// ---------------------------------------------------------------------------

agenticRoutes.get("/projects/:projectId/capability-grants", async (c) => {
	try {
		const agentRole = c.req.query("agentRole");
		const grants = await getCapabilityGrants(c.req.param("projectId"), agentRole);
		return c.json(grants);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/projects/:projectId/capability-grants/:agentRole/check/:capability", async (c) => {
	try {
		const { projectId, agentRole, capability } = c.req.param();
		const granted = await hasCapability(projectId, agentRole, capability as CapabilityToken);
		return c.json({ capability, agentRole, granted });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.get("/capability-grants/defaults/:agentRole", async (c) => {
	try {
		const defaults = getDefaultGrantsForRole(c.req.param("agentRole"));
		return c.json({ agentRole: c.req.param("agentRole"), defaults });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.put("/projects/:projectId/capability-grants", async (c) => {
	try {
		const body = await c.req.json();
		const grant = await upsertCapabilityGrant({
			projectId: c.req.param("projectId"),
			agentRole: body.agentRole,
			capability: body.capability,
			granted: body.granted ?? true,
			grantedBy: body.grantedBy ?? "human",
		});
		return c.json(grant);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

agenticRoutes.delete("/projects/:projectId/capability-grants/:agentRole/:capability", async (c) => {
	try {
		const { projectId, agentRole, capability } = c.req.param();
		const deleted = await deleteCapabilityGrant(projectId, agentRole, capability as CapabilityToken);
		if (!deleted) return c.json({ error: "Grant not found" }, 404);
		return c.json({ deleted: true });
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});

// ---------------------------------------------------------------------------
// Observability Metrics (Section 18)
// ---------------------------------------------------------------------------

agenticRoutes.get("/projects/:projectId/agentic-metrics", async (c) => {
	try {
		const metrics = await getAgenticMetrics(c.req.param("projectId"));
		return c.json(metrics);
	} catch (err) {
		return c.json({ error: String(err) }, 500);
	}
});
