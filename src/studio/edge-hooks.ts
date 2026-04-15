// ---------------------------------------------------------------------------
// Oscorpex — Agent Dependency Edge Hooks (v3.1)
// Execution-time handlers for non-DAG edge types:
//   - notification: send an informational message when a task completes
//   - mentoring:    send non-blocking feedback from mentor to mentee
//   - handoff:      enforce documentation requirement on task output
//   - approval:     gate task start when an incoming approval edge exists
//
// DAG-blocking types (workflow, review, gate, conditional, handoff, approval)
// are wave-sequenced by pipeline-engine.buildDAGWaves(). These hooks add the
// runtime side-effects that the wave planner cannot express.
// ---------------------------------------------------------------------------

import { listAgentDependencies } from "./db.js";
import { sendMessage } from "./agent-messaging.js";
import type { AgentDependency, Task, TaskOutput } from "./types.js";

/** Simple inline doc-detection heuristic for handoff edges. */
export function outputHasDocumentation(output: TaskOutput): boolean {
	const files = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
	if (files.some((f) => /\.(md|mdx|rst|adoc)$/i.test(f))) return true;
	if (files.some((f) => /(^|\/)(docs?|documentation|README)/i.test(f))) return true;
	// Fallback: scan logs for documentation markers
	const logsText = (output.logs ?? []).join("\n").toLowerCase();
	return logsText.includes("documentation") || logsText.includes("## handoff");
}

export interface PostCompletionHookResult {
	notificationsSent: number;
	mentoringMessagesSent: number;
	handoffDocMissing: boolean;
}

/**
 * Execute post-completion edge hooks for a finished task.
 * Non-fatal: individual hook failures are logged but never thrown.
 */
export async function applyPostCompletionHooks(
	projectId: string,
	task: Task,
	output: TaskOutput,
	depsOverride?: AgentDependency[],
): Promise<PostCompletionHookResult> {
	const result: PostCompletionHookResult = {
		notificationsSent: 0,
		mentoringMessagesSent: 0,
		handoffDocMissing: false,
	};

	if (!task.assignedAgentId) return result;

	let deps: AgentDependency[];
	try {
		deps = depsOverride ?? (await listAgentDependencies(projectId));
	} catch (err) {
		console.warn("[edge-hooks] listAgentDependencies failed:", err);
		return result;
	}

	const outgoing = deps.filter((d) => d.fromAgentId === task.assignedAgentId);

	// notification: one message per target
	for (const edge of outgoing.filter((d) => d.type === "notification")) {
		try {
			await sendMessage(
				projectId,
				edge.fromAgentId,
				edge.toAgentId,
				"notification",
				`Task complete: ${task.title}`,
				[
					`Task "${task.title}" finished.`,
					`Files: ${(output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0)}`,
					output.testResults ? `Tests: ${JSON.stringify(output.testResults)}` : null,
				]
					.filter(Boolean)
					.join("\n"),
				{ taskId: task.id, edgeType: "notification" },
			);
			result.notificationsSent += 1;
		} catch (err) {
			console.warn(`[edge-hooks] notification → ${edge.toAgentId} failed:`, err);
		}
	}

	// mentoring: non-blocking feedback from mentor (fromAgent) to mentee (toAgent).
	// The mentor is notified that their mentee completed work and may offer feedback.
	for (const edge of outgoing.filter((d) => d.type === "mentoring")) {
		try {
			await sendMessage(
				projectId,
				edge.fromAgentId,
				edge.toAgentId,
				"feedback",
				`Mentoring checkpoint: ${task.title}`,
				`Heads-up — your mentee completed "${task.title}". Review when convenient and share feedback.`,
				{ taskId: task.id, edgeType: "mentoring", nonBlocking: true },
			);
			result.mentoringMessagesSent += 1;
		} catch (err) {
			console.warn(`[edge-hooks] mentoring → ${edge.toAgentId} failed:`, err);
		}
	}

	// handoff: enforce documentation requirement (metadata.documentRequired)
	const handoffEdges = outgoing.filter(
		(d) => d.type === "handoff" && d.metadata?.documentRequired === true,
	);
	if (handoffEdges.length > 0 && !outputHasDocumentation(output)) {
		result.handoffDocMissing = true;
		for (const edge of handoffEdges) {
			try {
				await sendMessage(
					projectId,
					edge.fromAgentId,
					edge.toAgentId,
					"handoff_doc",
					`Missing handoff documentation: ${task.title}`,
					`Task "${task.title}" completed without a documentation artifact. A handoff edge requires documentation.`,
					{ taskId: task.id, edgeType: "handoff", severity: "warning" },
				);
			} catch (err) {
				console.warn(`[edge-hooks] handoff warning → ${edge.toAgentId} failed:`, err);
			}
		}
		console.warn(
			`[edge-hooks] Task "${task.title}" missing handoff documentation (${handoffEdges.length} edge(s) require it)`,
		);
	}

	return result;
}

/**
 * Return true when the task's assigned agent has an incoming approval edge.
 * Used by TaskEngine.startTask to force requiresApproval prior to dispatch.
 */
export async function taskNeedsApprovalFromEdges(
	projectId: string,
	task: Task,
	depsOverride?: AgentDependency[],
): Promise<boolean> {
	if (!task.assignedAgentId) return false;

	let deps: AgentDependency[];
	try {
		deps = depsOverride ?? (await listAgentDependencies(projectId));
	} catch (err) {
		console.warn("[edge-hooks] listAgentDependencies failed:", err);
		return false;
	}

	return deps.some((d) => d.type === "approval" && d.toAgentId === task.assignedAgentId);
}
