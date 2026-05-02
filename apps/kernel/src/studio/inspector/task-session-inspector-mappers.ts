// ---------------------------------------------------------------------------
// Oscorpex — Inspector Mappers: transform raw DB rows → inspector payloads
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
	InspectorAgentSummary,
	InspectorExecutionSummary,
	InspectorGateSummary,
	InspectorObservation,
	InspectorOutputSummary,
	InspectorSessionSummary,
	InspectorStrategySummary,
	InspectorTaskSummary,
	InspectorTimelineItem,
	InspectorUsageSummary,
	InspectorWarning,
} from "./task-session-inspector-types.js";

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export function mapTask(row: Record<string, any>): InspectorTaskSummary {
	return {
		id: row.id,
		title: row.title,
		status: row.status,
		complexity: row.complexity ?? undefined,
		taskType: row.task_type ?? undefined,
		assignedAgent: row.assigned_agent ?? undefined,
		assignedAgentId: row.assigned_agent_id ?? undefined,
		retryCount: row.retry_count ?? 0,
		revisionCount: row.revision_count ?? 0,
		createdAt: toISO(row.created_at),
		startedAt: toISO(row.started_at),
		completedAt: toISO(row.completed_at),
		error: row.error ?? undefined,
	};
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export function mapAgent(row: Record<string, any>): InspectorAgentSummary {
	return {
		id: row.id,
		name: row.name ?? row.role ?? "unknown",
		role: row.role ?? "unknown",
	};
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function mapSession(row: Record<string, any>): InspectorSessionSummary {
	const startedAt = toISO(row.started_at ?? row.created_at);
	const completedAt = toISO(row.completed_at);
	let durationMs: number | undefined;
	if (startedAt && completedAt) {
		durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
	}
	return {
		id: row.id,
		status: row.status,
		maxSteps: row.max_steps != null ? Number(row.max_steps) : undefined,
		stepsCompleted: row.steps_completed != null ? Number(row.steps_completed) : undefined,
		strategy: row.strategy ?? undefined,
		createdAt: toISO(row.created_at),
		completedAt,
		durationMs,
	};
}

// ---------------------------------------------------------------------------
// Strategy (from session or strategy_selected event)
// ---------------------------------------------------------------------------

export function mapStrategy(
	sessionRow?: Record<string, any>,
	events?: Record<string, any>[],
): InspectorStrategySummary | undefined {
	// Try extracting from strategy_selected event payload
	const strategyEvent = events?.find((e) => e.type === "agent:strategy_selected");
	if (strategyEvent) {
		const payload = parsePayload(strategyEvent.payload);
		return {
			name: payload.strategy ?? sessionRow?.strategy ?? undefined,
			confidence: payload.confidence ?? undefined,
			reason: payload.reason ?? undefined,
		};
	}
	if (sessionRow?.strategy) {
		return { name: sessionRow.strategy };
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Execution (from episodes)
// ---------------------------------------------------------------------------

export function mapExecution(episodes: Record<string, any>[]): InspectorExecutionSummary | undefined {
	if (episodes.length === 0) return undefined;
	const latest = episodes[episodes.length - 1];
	return {
		provider: latest.provider ?? undefined,
		model: latest.model ?? undefined,
		latencyMs: latest.duration_ms != null ? Number(latest.duration_ms) : undefined,
		costUsd: latest.cost_usd != null ? Number(latest.cost_usd) : undefined,
		failureClassification: latest.outcome === "failure" ? (latest.failure_reason ?? "unknown") : undefined,
		error: latest.failure_reason ?? undefined,
	};
}

// ---------------------------------------------------------------------------
// Usage (aggregate token rows)
// ---------------------------------------------------------------------------

export function mapUsage(rows: Record<string, any>[]): InspectorUsageSummary | undefined {
	if (rows.length === 0) return undefined;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let totalTokens = 0;
	let costUsd = 0;
	for (const r of rows) {
		inputTokens += Number(r.input_tokens ?? 0);
		outputTokens += Number(r.output_tokens ?? 0);
		cacheReadTokens += Number(r.cache_read_tokens ?? 0);
		cacheWriteTokens += Number(r.cache_creation_tokens ?? 0);
		totalTokens += Number(r.total_tokens ?? 0);
		costUsd += Number(r.cost_usd ?? 0);
	}
	return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, costUsd };
}

// ---------------------------------------------------------------------------
// Output (from task output JSON + task_diffs)
// ---------------------------------------------------------------------------

export function mapOutput(
	taskRow: Record<string, any>,
	diffs: Record<string, any>[],
): InspectorOutputSummary | undefined {
	const raw = taskRow.output;
	let parsed: Record<string, any> | undefined;
	if (raw && typeof raw === "string") {
		try {
			parsed = JSON.parse(raw);
		} catch {
			// output is plain text
		}
	} else if (raw && typeof raw === "object") {
		parsed = raw as Record<string, any>;
	}

	const filesCreated: string[] = [];
	const filesModified: string[] = [];
	for (const d of diffs) {
		if (d.diff_type === "created") filesCreated.push(d.file_path as string);
		else if (d.diff_type === "modified") filesModified.push(d.file_path as string);
	}

	// Merge from parsed output if available
	if (parsed?.filesCreated && Array.isArray(parsed.filesCreated)) {
		for (const f of parsed.filesCreated) {
			if (!filesCreated.includes(f)) filesCreated.push(f);
		}
	}
	if (parsed?.filesModified && Array.isArray(parsed.filesModified)) {
		for (const f of parsed.filesModified) {
			if (!filesModified.includes(f)) filesModified.push(f);
		}
	}

	const logs: string[] = parsed?.logs ?? [];
	const error = taskRow.error ?? undefined;

	if (filesCreated.length === 0 && filesModified.length === 0 && logs.length === 0 && !error) {
		return undefined;
	}

	return { filesCreated, filesModified, logs, error };
}

// ---------------------------------------------------------------------------
// Gates (from verification_results)
// ---------------------------------------------------------------------------

export function mapGates(verifications: Record<string, any>[]): InspectorGateSummary[] {
	return verifications.map((v) => ({
		name: v.verification_type ?? "unknown",
		status: mapGateStatus(v.status as string),
		message: v.details ? (typeof v.details === "string" ? v.details : JSON.stringify(v.details)) : undefined,
		timestamp: toISO(v.created_at),
	}));
}

function mapGateStatus(s: string): InspectorGateSummary["status"] {
	if (s === "passed" || s === "pass") return "passed";
	if (s === "failed" || s === "fail") return "failed";
	if (s === "warning" || s === "warn") return "warning";
	if (s === "skipped" || s === "skip") return "skipped";
	return "unknown";
}

// ---------------------------------------------------------------------------
// Timeline (composite from multiple sources)
// ---------------------------------------------------------------------------

export function buildTimeline(
	taskRow: Record<string, any>,
	sessionRow?: Record<string, any>,
	events?: Record<string, any>[],
	episodes?: Record<string, any>[],
	verifications?: Record<string, any>[],
): InspectorTimelineItem[] {
	const items: InspectorTimelineItem[] = [];

	// Task lifecycle
	if (taskRow.created_at) {
		items.push(tl(taskRow.created_at, "task:created", "Task created", "info", "task"));
	}
	if (taskRow.started_at) {
		items.push(tl(taskRow.started_at, "task:started", "Task started", "info", "task"));
	}
	if (taskRow.completed_at && taskRow.status === "done") {
		items.push(tl(taskRow.completed_at, "task:completed", "Task completed", "success", "task"));
	}
	if (taskRow.completed_at && taskRow.status === "failed") {
		items.push(tl(taskRow.completed_at, "task:failed", `Task failed: ${taskRow.error ?? "unknown"}`, "error", "task"));
	}

	// Review events
	if (taskRow.review_status === "approved") {
		items.push(tl(taskRow.completed_at, "review:approved", "Review approved", "success", "review"));
	}
	if (taskRow.review_status === "rejected") {
		items.push(tl(taskRow.completed_at, "review:rejected", "Review rejected", "warning", "review"));
	}

	// Session lifecycle
	if (sessionRow) {
		if (sessionRow.created_at) {
			items.push(tl(sessionRow.created_at, "session:started", "Agent session started", "info", "session"));
		}
		if (sessionRow.strategy) {
			items.push(
				tl(sessionRow.created_at, "session:strategy", `Strategy: ${sessionRow.strategy}`, "info", "session"),
			);
		}
		if (sessionRow.completed_at && sessionRow.status === "completed") {
			items.push(tl(sessionRow.completed_at, "session:completed", "Session completed", "success", "session"));
		}
		if (sessionRow.completed_at && sessionRow.status === "failed") {
			items.push(tl(sessionRow.completed_at, "session:failed", "Session failed", "error", "session"));
		}
	}

	// Events from event bus
	if (events) {
		for (const e of events) {
			const payload = parsePayload(e.payload);
			const detail = payload.summary ?? payload.reason ?? payload.message ?? undefined;
			items.push(tl(e.timestamp, e.type, eventTitle(e.type), eventSeverity(e.type), "event", detail));
		}
	}

	// Episodes
	if (episodes) {
		for (const ep of episodes) {
			const sev = ep.outcome === "success" ? "success" : ep.outcome === "failure" ? "error" : "info";
			items.push(
				tl(ep.created_at, "episode:" + ep.outcome, `Episode: ${ep.action_summary}`, sev as any, "provider"),
			);
		}
	}

	// Verification gates
	if (verifications) {
		for (const v of verifications) {
			const sev = v.status === "passed" || v.status === "pass" ? "success" : "warning";
			items.push(
				tl(v.created_at, `gate:${v.verification_type}`, `Gate: ${v.verification_type} — ${v.status}`, sev as any, "gate"),
			);
		}
	}

	// Sort by timestamp (missing timestamps go last)
	items.sort((a, b) => {
		if (!a.timestamp && !b.timestamp) return 0;
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
	});

	return items;
}

// ---------------------------------------------------------------------------
// Observations (from session JSONB)
// ---------------------------------------------------------------------------

export function mapObservations(sessionRow?: Record<string, any>): InspectorObservation[] {
	if (!sessionRow) return [];
	let obs = sessionRow.observations;
	if (typeof obs === "string") {
		try {
			obs = JSON.parse(obs);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(obs)) return [];
	return obs.map((o: any) => ({
		step: o.step ?? 0,
		type: o.type ?? "unknown",
		summary: o.summary ?? "",
		timestamp: o.timestamp ?? undefined,
	}));
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export function buildWarnings(
	sessionRow?: Record<string, any>,
	usageRows?: Record<string, any>[],
	episodes?: Record<string, any>[],
): InspectorWarning[] {
	const warnings: InspectorWarning[] = [];
	if (!sessionRow) {
		warnings.push({ code: "NO_SESSION", message: "No agent session found for this task" });
	}
	if (!usageRows || usageRows.length === 0) {
		warnings.push({ code: "NO_USAGE", message: "Token usage data not recorded" });
	}
	if (!episodes || episodes.length === 0) {
		warnings.push({ code: "NO_EPISODES", message: "No execution episodes recorded" });
	}
	return warnings;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISO(val: unknown): string | undefined {
	if (!val) return undefined;
	if (typeof val === "string") return val;
	if (val instanceof Date) return val.toISOString();
	if (typeof (val as any).toISOString === "function") return (val as any).toISOString();
	return String(val);
}

function parsePayload(p: unknown): Record<string, any> {
	if (!p) return {};
	if (typeof p === "object") return p as Record<string, any>;
	if (typeof p === "string") {
		try {
			return JSON.parse(p);
		} catch {
			return {};
		}
	}
	return {};
}

function tl(
	ts: unknown,
	type: string,
	title: string,
	severity: InspectorTimelineItem["severity"],
	source: InspectorTimelineItem["source"],
	detail?: string,
): InspectorTimelineItem {
	return { id: randomUUID(), timestamp: toISO(ts), type, title, severity, source, detail };
}

function eventTitle(type: string): string {
	const map: Record<string, string> = {
		"agent:session_started": "Agent session started",
		"agent:strategy_selected": "Strategy selected",
		"task:completed": "Task completed",
		"task:failed": "Task failed",
		"task:started": "Task started",
		"task:review_requested": "Review requested",
		"task:review_completed": "Review completed",
		"task:approval_requested": "Approval requested",
		"task:approved": "Task approved",
		"task:rejected": "Task rejected",
	};
	return map[type] ?? type;
}

function eventSeverity(type: string): InspectorTimelineItem["severity"] {
	if (type.includes("failed") || type.includes("rejected") || type.includes("error")) return "error";
	if (type.includes("completed") || type.includes("approved") || type.includes("success")) return "success";
	if (type.includes("warning") || type.includes("retry")) return "warning";
	return "info";
}
