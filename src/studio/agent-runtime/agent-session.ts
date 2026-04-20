// ---------------------------------------------------------------------------
// Oscorpex — Agent Session: Bounded runtime execution context
// Manages the observation → reasoning → action loop within a task execution.
// ---------------------------------------------------------------------------

import {
	addObservation,
	createAgentSession,
	getActiveSession,
	recordEpisode,
	updateAgentSession,
	updateStrategyPattern,
} from "../db.js";
import { eventBus } from "../event-bus.js";
import type { AgentObservation, AgentSession, EpisodeOutcome, Task } from "../types.js";
import { formatBehavioralPrompt, loadBehavioralContext } from "./agent-memory.js";
import { selectStrategy, type StrategySelection } from "./agent-strategy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionContext {
	session: AgentSession;
	strategySelection: StrategySelection;
	behavioralPrompt: string;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialize a new agent session for a task execution.
 * This is the entry point for the observation-reasoning-action loop.
 * Returns the session context including strategy and behavioral memory.
 */
export async function initSession(
	projectId: string,
	agentId: string,
	agentRole: string,
	task: Task,
): Promise<SessionContext> {
	// Check for existing active session (e.g. retry/revision)
	const existing = await getActiveSession(projectId, task.id);
	if (existing) {
		await updateAgentSession(existing.id, { status: "aborted", completedAt: new Date().toISOString() });
	}

	// Select strategy based on role, task type, and historical patterns
	const strategySelection = await selectStrategy(projectId, agentRole, task);

	// Create new session
	const session = await createAgentSession({
		projectId,
		agentId,
		taskId: task.id,
		maxSteps: resolveMaxSteps(task),
	});

	// Set strategy on session
	await updateAgentSession(session.id, { strategy: strategySelection.strategy.name });

	// Record initial observation
	await addObservation(session.id, {
		step: 0,
		type: "strategy_selected",
		summary: `Strategy "${strategySelection.strategy.name}" selected (${strategySelection.reason}, confidence ${(strategySelection.confidence * 100).toFixed(0)}%)`,
		timestamp: new Date().toISOString(),
	});

	// Load behavioral memory
	const behavioralCtx = await loadBehavioralContext(projectId, agentId, agentRole, task.taskType ?? "ai");
	const behavioralPrompt = formatBehavioralPrompt(behavioralCtx);

	// Emit structured agentic events (v7.0 Section 13)
	eventBus.emit({
		projectId,
		type: "agent:session_started",
		agentId,
		taskId: task.id,
		payload: { sessionId: session.id, strategy: strategySelection.strategy.name },
	});
	eventBus.emit({
		projectId,
		type: "agent:strategy_selected",
		agentId,
		taskId: task.id,
		payload: {
			strategy: strategySelection.strategy.name,
			confidence: strategySelection.confidence,
			reason: strategySelection.reason,
		},
	});

	eventBus.emitTransient({
		projectId,
		type: "agent:output",
		agentId,
		taskId: task.id,
		payload: {
			output: `[session] Strategy: ${strategySelection.strategy.name} (${strategySelection.reason})`,
		},
	});

	return {
		session: { ...session, strategy: strategySelection.strategy.name },
		strategySelection,
		behavioralPrompt,
	};
}

/**
 * Record an observation step within the session.
 */
export async function recordStep(
	sessionId: string,
	observation: Omit<AgentObservation, "timestamp">,
): Promise<void> {
	await addObservation(sessionId, {
		...observation,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Complete a session successfully and record the episode.
 */
export async function completeSession(
	sessionId: string,
	projectId: string,
	agentId: string,
	agentRole: string,
	task: Task,
	opts: { qualityScore?: number; costUsd?: number; durationMs?: number },
): Promise<void> {
	const session = await updateAgentSession(sessionId, {
		status: "completed",
		completedAt: new Date().toISOString(),
	});
	if (!session) return;

	// Record episode for behavioral learning
	await recordEpisode({
		projectId,
		agentId,
		taskId: task.id,
		taskType: task.taskType ?? "ai",
		strategy: session.strategy ?? "unknown",
		actionSummary: `Completed "${task.title}" with ${session.stepsCompleted} steps`,
		outcome: "success" as EpisodeOutcome,
		qualityScore: opts.qualityScore,
		costUsd: opts.costUsd,
		durationMs: opts.durationMs,
	});

	// Update strategy patterns (aggregated stats)
	await updateStrategyPattern(
		projectId,
		agentRole,
		task.taskType ?? "ai",
		session.strategy ?? "unknown",
	);
}

/**
 * Fail a session and record the failure episode.
 */
export async function failSession(
	sessionId: string,
	projectId: string,
	agentId: string,
	agentRole: string,
	task: Task,
	failureReason: string,
	opts?: { costUsd?: number; durationMs?: number },
): Promise<void> {
	const session = await updateAgentSession(sessionId, {
		status: "failed",
		completedAt: new Date().toISOString(),
	});
	if (!session) return;

	// Record failure episode
	await recordEpisode({
		projectId,
		agentId,
		taskId: task.id,
		taskType: task.taskType ?? "ai",
		strategy: session.strategy ?? "unknown",
		actionSummary: `Failed "${task.title}" after ${session.stepsCompleted} steps`,
		outcome: "failure" as EpisodeOutcome,
		failureReason,
		costUsd: opts?.costUsd,
		durationMs: opts?.durationMs,
	});

	// Update strategy patterns
	await updateStrategyPattern(
		projectId,
		agentRole,
		task.taskType ?? "ai",
		session.strategy ?? "unknown",
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve max steps based on task complexity */
function resolveMaxSteps(task: Task): number {
	switch (task.complexity) {
		case "S":
			return 5;
		case "M":
			return 10;
		case "L":
			return 15;
		case "XL":
			return 20;
		default:
			return 10;
	}
}
