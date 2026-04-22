// ---------------------------------------------------------------------------
// Oscorpex — Task Injection: Runtime task creation by agents
// Allows agents to propose new tasks during execution.
// Proposals are governed by approval rules.
// ---------------------------------------------------------------------------

import { autoApproveProposal, createProposal, createTask, hasCapability, listProjectAgents, query } from "../db.js";
import { eventBus } from "../event-bus.js";
import type { ProposalType, Task, TaskProposal } from "../types.js";
import { canAutoApprove } from "./agent-constraints.js";
import { canonicalizeAgentRole, roleMatches } from "../roles.js";

// ---------------------------------------------------------------------------
// Containment limits
// ---------------------------------------------------------------------------

const MAX_PROPOSALS_PER_TASK = 3;
const MAX_PROPOSALS_PER_PHASE = 10;
const MAX_INJECTION_DEPTH = 2;

export class InjectionLimitError extends Error {
	constructor(
		public readonly limitType: "per_task_quota" | "per_phase_budget" | "recursion_depth" | "duplicate",
		message: string,
	) {
		super(message);
		this.name = "InjectionLimitError";
	}
}

async function checkInjectionLimits(request: InjectionRequest): Promise<void> {
	// Per-task quota: max proposals from a single originating task
	if (request.originatingTaskId) {
		const taskProposals = await query(
			`SELECT COUNT(*) AS cnt FROM task_proposals WHERE originating_task_id = $1`,
			[request.originatingTaskId],
		);
		if (Number(taskProposals[0]?.cnt ?? 0) >= MAX_PROPOSALS_PER_TASK) {
			throw new InjectionLimitError("per_task_quota", `Task ${request.originatingTaskId} has reached proposal limit (${MAX_PROPOSALS_PER_TASK})`);
		}
	}

	// Per-phase budget: max proposals in a single phase
	if (request.phaseId) {
		const phaseProposals = await query(
			`SELECT COUNT(*) AS cnt FROM task_proposals WHERE phase_id = $1`,
			[request.phaseId],
		);
		if (Number(phaseProposals[0]?.cnt ?? 0) >= MAX_PROPOSALS_PER_PHASE) {
			throw new InjectionLimitError("per_phase_budget", `Phase ${request.phaseId} has reached injection budget (${MAX_PROPOSALS_PER_PHASE})`);
		}
	}

	// Recursion depth: injected tasks cannot inject beyond depth limit
	if (request.originatingTaskId) {
		const depthRow = await query(
			`WITH RECURSIVE chain AS (
				SELECT id, originating_task_id, 0 AS depth FROM task_proposals WHERE created_task_id = $1
				UNION ALL
				SELECT tp.id, tp.originating_task_id, c.depth + 1
				FROM task_proposals tp JOIN chain c ON tp.created_task_id = c.originating_task_id
			)
			SELECT COALESCE(MAX(depth), 0) AS max_depth FROM chain`,
			[request.originatingTaskId],
		);
		if (Number(depthRow[0]?.max_depth ?? 0) >= MAX_INJECTION_DEPTH) {
			throw new InjectionLimitError("recursion_depth", `Injection depth limit reached (${MAX_INJECTION_DEPTH})`);
		}
	}

	// Duplicate detection: same title in same project (pending/approved)
	const duplicates = await query(
		`SELECT id FROM task_proposals WHERE project_id = $1 AND title = $2 AND status IN ('pending', 'approved', 'auto_approved') LIMIT 1`,
		[request.projectId, request.title],
	);
	if (duplicates.length > 0) {
		throw new InjectionLimitError("duplicate", `Duplicate proposal already exists: "${request.title}"`);
	}
}

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
	// Containment: enforce quota, depth, and dedup limits
	await checkInjectionLimits(request);

	// Create the proposal record
	// Capability check (Section 14.3) — non-blocking, defaults allow if no explicit deny
	const agentRole = canonicalizeAgentRole(request.suggestedRole ?? "tech-lead");
	const canPropose = await hasCapability(request.projectId, agentRole, "can_propose_task");
	if (!canPropose) {
		// Create proposal in rejected state instead of blocking entirely
		const proposal = await createProposal({
			projectId: request.projectId,
			originatingTaskId: request.originatingTaskId,
			originatingAgentId: request.originatingAgentId,
			proposalType: request.proposalType,
			title: request.title,
			description: request.description,
			severity: request.severity,
			suggestedRole: canonicalizeAgentRole(request.suggestedRole),
			phaseId: request.phaseId,
			complexity: request.complexity,
		});
		return { proposal, autoApproved: false };
	}

	const proposal = await createProposal({
		projectId: request.projectId,
		originatingTaskId: request.originatingTaskId,
		originatingAgentId: request.originatingAgentId,
		proposalType: request.proposalType,
		title: request.title,
		description: request.description,
		severity: request.severity,
		suggestedRole: canonicalizeAgentRole(request.suggestedRole),
		phaseId: request.phaseId,
		complexity: request.complexity,
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
		const agents = await listProjectAgents(request.projectId);
		const resolvedAssignee = agents.find(
			(agent) =>
				agent.id === request.suggestedRole ||
				roleMatches(agent.role, request.suggestedRole) ||
				agent.name.toLowerCase() === String(request.suggestedRole ?? "").toLowerCase(),
		);

		const task = await createTask({
			phaseId: request.phaseId,
			title: request.title,
			description: request.description,
			assignedAgent: resolvedAssignee?.id ?? canonicalizeAgentRole(request.suggestedRole ?? "tech-lead"),
			assignedAgentId: resolvedAssignee?.id,
			complexity: request.complexity ?? "S",
			dependsOn: request.originatingTaskId ? [request.originatingTaskId] : [],
			branch: "main",
			projectId: request.projectId,
		});

		eventBus.emit({
			projectId: request.projectId,
			type: "task:proposal_approved",
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
		type: "task:proposal_created",
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
