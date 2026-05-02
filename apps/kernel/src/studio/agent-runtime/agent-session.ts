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
import { createLogger } from "../logger.js";
import { getBehaviorRoleKey } from "../roles.js";
import type { AgentObservation, AgentSession, EpisodeOutcome, Task } from "../types.js";
import { formatBehavioralPrompt, loadBehavioralContext } from "./agent-memory.js";
import { type StrategySelection, selectStrategy } from "./agent-strategy.js";
const log = createLogger("agent-session");

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
	const strategyRole = getBehaviorRoleKey(agentRole);
	// Check for existing active session (e.g. retry/revision)
	const existing = await getActiveSession(projectId, task.id);
	if (existing) {
		await updateAgentSession(existing.id, { status: "aborted", completedAt: new Date().toISOString() });
	}

	// Select strategy based on role, task type, and historical patterns
	const strategySelection = await selectStrategy(projectId, strategyRole, task);

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
	const behavioralCtx = await loadBehavioralContext(projectId, agentId, strategyRole, task.taskType ?? "ai");
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
export async function recordStep(sessionId: string, observation: Omit<AgentObservation, "timestamp">): Promise<void> {
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
		getBehaviorRoleKey(agentRole),
		task.taskType ?? "ai",
		session.strategy ?? "unknown",
	);

	// v8.0: Trigger cross-project learning extraction (non-blocking)
	triggerLearningExtraction(projectId).catch((err) =>
		log.warn("[agent-session] Non-blocking operation failed:", err?.message ?? err),
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
		getBehaviorRoleKey(agentRole),
		task.taskType ?? "ai",
		session.strategy ?? "unknown",
	);

	// v8.0: Trigger cross-project learning extraction (non-blocking)
	triggerLearningExtraction(projectId).catch((err) =>
		log.warn("[agent-session] Non-blocking operation failed:", err?.message ?? err),
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * v8.0: Trigger cross-project learning extraction.
 * Rate-limited: only extracts if enough new episodes accumulated (≥5 since last extraction).
 */
const _lastExtractionCount = new Map<string, number>();
async function triggerLearningExtraction(projectId: string): Promise<void> {
	const { extractPatternsFromEpisodes, autoPromotePatterns } = await import("../cross-project-learning.js");
	const { queryOne: qo } = await import("../pg.js");

	// Count episodes since last extraction
	const countRow = await qo<{ cnt: number }>("SELECT COUNT(*) as cnt FROM agent_episodes WHERE project_id = $1", [
		projectId,
	]);
	const currentCount = (countRow?.cnt ?? 0) as number;
	const lastCount = _lastExtractionCount.get(projectId) ?? 0;

	if (currentCount - lastCount < 5) return; // Not enough new episodes

	// Get tenant_id for the project
	const projRow = await qo<{ tenant_id: string | null }>("SELECT tenant_id FROM projects WHERE id = $1", [projectId]);
	const tenantId = projRow?.tenant_id ?? projectId; // fallback to projectId for single-tenant

	const patternsCreated = await extractPatternsFromEpisodes(tenantId);
	_lastExtractionCount.set(projectId, currentCount);

	if (patternsCreated > 0) {
		await autoPromotePatterns(tenantId).catch((err) =>
			log.warn("[agent-session] Non-blocking operation failed:", err?.message ?? err),
		);
		log.info(`[agent-session] Extracted ${patternsCreated} learning patterns for project ${projectId}`);
	}
}

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
