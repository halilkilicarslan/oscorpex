// ---------------------------------------------------------------------------
// Oscorpex — Task Injection: Runtime task creation by agents
// Allows agents to propose new tasks during execution.
// Proposals are governed by approval rules.
// ---------------------------------------------------------------------------

import { autoApproveProposal, createProposal, createTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import type { ProposalType, Task, TaskProposal } from "../types.js";
import { canAutoApprove } from "./agent-constraints.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectionRequest {
	projectId: string;
	originatingTaskId?: string;
	originatingAgentId: string;
	proposalType: ProposalType;
	title: string;
	description: string;
	severity?: string;
	suggestedRole?: string;
	/** If provided, the task will be created in this phase */
	phaseId?: string;
	/** Complexity for the new task */
	complexity?: Task["complexity"];
}

export interface InjectionResult {
	proposal: TaskProposal;
	autoApproved: boolean;
	task?: Task;
}

// ---------------------------------------------------------------------------
// Injection flow
// ---------------------------------------------------------------------------

/**
 * Propose a new task during agent execution.
 * Low-risk proposals are auto-approved and the task is created immediately.
 * High-risk proposals require human approval via the UI.
 */
export async function proposeTask(request: InjectionRequest): Promise<InjectionResult> {
	// Create the proposal record
	const proposal = await createProposal({
		projectId: request.projectId,
		originatingTaskId: request.originatingTaskId,
		originatingAgentId: request.originatingAgentId,
		proposalType: request.proposalType,
		title: request.title,
		description: request.description,
		severity: request.severity,
		suggestedRole: request.suggestedRole,
	});

	// Check if auto-approvable
	const { autoApprove, riskLevel, reason } = await canAutoApprove(request.projectId, {
		proposalType: request.proposalType,
		severity: request.severity,
		title: request.title,
	});

	if (autoApprove && request.phaseId) {
		// Auto-approve and create the task immediately
		const approved = await autoApproveProposal(proposal.id);

		const task = await createTask({
			phaseId: request.phaseId,
			title: request.title,
			description: request.description,
			assignedAgent: request.suggestedRole ?? "tech_lead",
			complexity: request.complexity ?? "S",
			dependsOn: request.originatingTaskId ? [request.originatingTaskId] : [],
			branch: "main",
			projectId: request.projectId,
		});

		eventBus.emit({
			projectId: request.projectId,
			type: "task:injected" as any,
			agentId: request.originatingAgentId,
			taskId: task.id,
			payload: {
				proposalId: proposal.id,
				title: request.title,
				riskLevel,
				autoApproved: true,
				reason,
			},
		});

		return { proposal: approved ?? proposal, autoApproved: true, task };
	}

	// Requires human approval — emit event for UI notification
	eventBus.emit({
		projectId: request.projectId,
		type: "task:proposal_pending" as any,
		agentId: request.originatingAgentId,
		payload: {
			proposalId: proposal.id,
			title: request.title,
			riskLevel,
			reason,
			requiresApproval: true,
		},
	});

	return { proposal, autoApproved: false };
}
