// ---------------------------------------------------------------------------
// Oscorpex — Proposal Processor
// Parses structured output markers from agent CLI output and routes them
// to task injection, inter-agent protocol, or graph mutation systems.
// Extracted from execution-engine.ts for single-responsibility.
// ---------------------------------------------------------------------------

import type { AgentOutputProposal } from "./legacy/cli-runtime.js";
import { getPipelineRun } from "./db.js";
import { createLogger } from "./logger.js";
import type { Task } from "./types.js";
const log = createLogger("proposal-processor");

// ---------------------------------------------------------------------------
// Process agent proposals from CLI output
// ---------------------------------------------------------------------------

export async function processAgentProposals(
	projectId: string,
	task: Task,
	agent: { id: string; name: string; role: string },
	proposals: AgentOutputProposal[],
): Promise<void> {
	const { proposeTask } = await import("./agent-runtime/task-injection.js");
	const { requestInfo, signalBlocker, handoffArtifact, recordDesignDecision } = await import(
		"./agent-runtime/agent-protocol.js"
	);

	for (const proposal of proposals) {
		if (proposal.type === "task_proposal") {
			await handleTaskProposal(proposal, projectId, task, agent, proposeTask);
		} else if (proposal.type === "agent_message") {
			await handleAgentMessage(proposal, projectId, task, agent, {
				requestInfo,
				signalBlocker,
				handoffArtifact,
				recordDesignDecision,
			});
		} else if (proposal.type === "graph_mutation") {
			await handleGraphMutation(proposal, projectId, agent);
		}
	}
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleTaskProposal(
	proposal: AgentOutputProposal,
	projectId: string,
	task: Task,
	agent: { id: string; name: string; role: string },
	proposeTask: (req: any) => Promise<any>,
): Promise<void> {
	const p = proposal.payload as {
		title?: string;
		description?: string;
		severity?: string;
		suggestedRole?: string;
		proposalType?: string;
	};
	if (!p.title) return;

	try {
		await proposeTask({
			projectId,
			originatingTaskId: task.id,
			originatingAgentId: agent.id,
			proposalType: p.proposalType ?? "fix_task",
			title: p.title,
			description: p.description ?? "",
			severity: p.severity,
			suggestedRole: p.suggestedRole ?? agent.role,
			phaseId: task.phaseId,
		});
		log.info(`[proposal-processor] Task proposal accepted: "${p.title}" from ${agent.name}`);
	} catch (err) {
		log.warn(`[proposal-processor] Task proposal failed: "${p.title}"` + " " + String(err));
	}
}

async function handleAgentMessage(
	proposal: AgentOutputProposal,
	projectId: string,
	task: Task,
	agent: { id: string; name: string; role: string },
	protocol: {
		requestInfo: (...args: any[]) => Promise<any>;
		signalBlocker: (...args: any[]) => Promise<any>;
		handoffArtifact: (...args: any[]) => Promise<any>;
		recordDesignDecision: (...args: any[]) => Promise<any>;
	},
): Promise<void> {
	const m = proposal.payload as {
		targetAgentId?: string;
		messageType?: string;
		content?: string;
	};
	if (!m.content || !m.targetAgentId) return;

	try {
		const msgType = m.messageType ?? "request_info";
		if (msgType === "blocker_alert") {
			await protocol.signalBlocker(projectId, agent.id, m.content, task.id);
		} else if (msgType === "handoff_artifact") {
			await protocol.handoffArtifact(projectId, agent.id, m.targetAgentId, "artifact", m.content, task.id);
		} else if (msgType === "design_decision") {
			await protocol.recordDesignDecision(projectId, agent.id, m.content, m.content, task.id);
		} else {
			await protocol.requestInfo(projectId, agent.id, m.targetAgentId, m.content, m.content, task.id);
		}
		log.info(`[proposal-processor] Agent message sent (${msgType}): ${agent.name} → ${m.targetAgentId ?? "broadcast"}`);
	} catch (err) {
		log.warn("[proposal-processor] Agent message failed:" + " " + String(err));
	}
}

async function handleGraphMutation(
	proposal: AgentOutputProposal,
	projectId: string,
	agent: { id: string; name: string },
): Promise<void> {
	const { proposeGraphMutation } = await import("./graph-coordinator.js");
	const pipelineRun = await getPipelineRun(projectId);
	const payload = proposal.payload as Record<string, unknown>;
	const mutationType = String(payload.mutationType ?? "");

	await proposeGraphMutation({
		projectId,
		causedByAgentId: agent.id,
		pipelineRunId: pipelineRun?.id,
		mutationType: mutationType as any,
		payload,
	});
	log.info(`[proposal-processor] Graph mutation proposal from ${agent.name} persisted for approval`);
}
