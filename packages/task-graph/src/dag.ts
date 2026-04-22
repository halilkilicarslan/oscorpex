// @oscorpex/task-graph — DAG topology: Kahn's algorithm, wave generation, pair-edge handling
// Pure functions — no DB or event-bus dependencies.

import type { DependencyEdge, GraphAgent } from "./types.js";
import type { PipelineStage } from "@oscorpex/core";

// Re-export PipelineStageStatus and PipelineStatus for convenience
export type { PipelineStageStatus, PipelineStatus } from "@oscorpex/core";

interface DAGNode {
	agentId: string;
	predecessors: Set<string>;
	successors: Set<string>;
}

const NON_BLOCKING_TYPES = new Set(["hierarchy", "notification", "mentoring", "escalation", "fallback"]);

export interface DAGWaveResult {
	waves: string[][];
	cycleDetected: boolean;
}

/**
 * Build DAG waves from agents and their dependency edges using Kahn's algorithm.
 *
 * Blocking types (workflow, review, gate, conditional, handoff, approval):
 *   "to" agent depends on "from" agent completing first.
 *
 * Non-blocking types (hierarchy, notification, mentoring, escalation, fallback):
 *   Ignored for scheduling purposes.
 *
 * Pair type: both agents placed in the same wave (latest wave wins).
 *
 * Returns agent ID groups: wave[0] = root agents, wave[1] = next, etc.
 */
export function buildDAGWaves(agents: GraphAgent[], deps: DependencyEdge[]): string[][] {
	const nodes = new Map<string, DAGNode>();
	for (const agent of agents) {
		nodes.set(agent.id, {
			agentId: agent.id,
			predecessors: new Set(),
			successors: new Set(),
		});
	}

	const pairEdges: Array<{ a: string; b: string }> = [];

	for (const dep of deps) {
		if (NON_BLOCKING_TYPES.has(dep.type)) continue;

		if (dep.type === "pair") {
			pairEdges.push({ a: dep.fromAgentId, b: dep.toAgentId });
			continue;
		}

		const from = nodes.get(dep.fromAgentId);
		const to = nodes.get(dep.toAgentId);
		if (from && to) {
			to.predecessors.add(from.agentId);
			from.successors.add(to.agentId);
		}
	}

	const inDegree = new Map<string, number>();
	for (const [id, node] of nodes) {
		inDegree.set(id, node.predecessors.size);
	}

	const waves: string[][] = [];
	const remaining = new Set(nodes.keys());
	let cycleDetected = false;

	while (remaining.size > 0) {
		const wave: string[] = [];
		for (const id of remaining) {
			if ((inDegree.get(id) ?? 0) === 0) {
				wave.push(id);
			}
		}

		if (wave.length === 0) {
			cycleDetected = true;
			waves.push([...remaining]);
			break;
		}

		waves.push(wave);

		for (const id of wave) {
			remaining.delete(id);
			const node = nodes.get(id)!;
			for (const succId of node.successors) {
				inDegree.set(succId, (inDegree.get(succId) ?? 1) - 1);
			}
		}
	}

	for (const { a, b } of pairEdges) {
		let waveA = -1;
		let waveB = -1;
		for (let i = 0; i < waves.length; i++) {
			if (waves[i].includes(a)) waveA = i;
			if (waves[i].includes(b)) waveB = i;
		}
		if (waveA >= 0 && waveB >= 0 && waveA !== waveB) {
			const targetWave = Math.max(waveA, waveB);
			const sourceWave = Math.min(waveA, waveB);
			const moveId = waveA < waveB ? a : b;
			waves[sourceWave] = waves[sourceWave].filter((id) => id !== moveId);
			if (!waves[targetWave].includes(moveId)) {
				waves[targetWave].push(moveId);
			}
		}
	}

	return waves.filter((w) => w.length > 0);
}

/**
 * Find the reviewer agent for a given agent ID using review-type dependency edges.
 * Returns the toAgentId of the first review edge originating from the given agent.
 */
export function findReviewerAgentId(agentId: string, deps: DependencyEdge[]): string | null {
	const reviewDep = deps.find((d) => d.type === "review" && d.fromAgentId === agentId);
	return reviewDep?.toAgentId ?? null;
}

/**
 * Find the dev agent for a given reviewer agent ID using review-type dependency edges.
 * Returns the fromAgentId of the review edge targeting the given reviewer.
 */
export function findDevAgentId(reviewerAgentId: string, deps: DependencyEdge[]): string | null {
	const reviewDep = deps.find((d) => d.type === "review" && d.toAgentId === reviewerAgentId);
	return reviewDep?.fromAgentId ?? null;
}