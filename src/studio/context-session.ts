// ---------------------------------------------------------------------------
// Oscorpex — Context Session (v4.0 Faz 3)
// Session event tracking, dedup, eviction, and resume snapshot builder.
// Bridges event-bus emissions into context_events for crash recovery.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import {
	insertContextEvent,
	getContextEvents,
	isDuplicateEvent,
	countSessionEvents,
	evictLowPriorityEvents,
} from "./db.js";
import { eventBus as _eventBusType } from "./event-bus.js";
type EventBus = typeof _eventBusType;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_SESSION = 500;
const DEDUP_WINDOW = 5;

// ---------------------------------------------------------------------------
// Event categories & priority mapping
// ---------------------------------------------------------------------------

type EventCategory = "task" | "error" | "file" | "git" | "decision";

interface CategoryMapping {
	category: EventCategory;
	priority: number; // 1=critical, 5=low
}

const EVENT_TYPE_MAP: Record<string, CategoryMapping> = {
	"task:completed": { category: "task", priority: 1 },
	"task:failed": { category: "error", priority: 1 },
	"task:started": { category: "task", priority: 2 },
	"pipeline:completed": { category: "task", priority: 1 },
	"pipeline:failed": { category: "error", priority: 1 },
	"phase:completed": { category: "task", priority: 2 },
	"phase:started": { category: "task", priority: 3 },
	"review:approved": { category: "decision", priority: 2 },
	"review:rejected": { category: "decision", priority: 2 },
	"task:escalated": { category: "error", priority: 1 },
};

// ---------------------------------------------------------------------------
// Hash utility
// ---------------------------------------------------------------------------

function hashData(data: string): string {
	return createHash("md5").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Track Event
// ---------------------------------------------------------------------------

export async function trackEvent(
	projectId: string,
	taskId: string | undefined,
	agentId: string | undefined,
	type: string,
	data: string,
): Promise<void> {
	const sessionKey = taskId ? `${projectId}:${taskId}` : projectId;
	const mapping = EVENT_TYPE_MAP[type] ?? { category: "task", priority: 3 };
	const dataHash = hashData(data);

	// Dedup: skip if same type+hash exists in recent window
	const isDup = await isDuplicateEvent(sessionKey, type, dataHash, DEDUP_WINDOW);
	if (isDup) return;

	// Evict low-priority events if over limit
	const count = await countSessionEvents(sessionKey);
	if (count >= MAX_EVENTS_PER_SESSION) {
		await evictLowPriorityEvents(sessionKey, MAX_EVENTS_PER_SESSION - 10);
	}

	await insertContextEvent({
		projectId,
		taskId,
		agentId,
		sessionKey,
		type,
		category: mapping.category,
		priority: mapping.priority,
		data,
		dataHash,
	});
}

// ---------------------------------------------------------------------------
// Event-Bus Bridge
// ---------------------------------------------------------------------------

export function initContextSession(eventBus: EventBus): void {
	const bridgeEvents = [
		"task:completed",
		"task:failed",
		"task:started",
		"pipeline:completed",
		"pipeline:failed",
		"phase:completed",
		"phase:started",
		"review:approved",
		"review:rejected",
		"task:escalated",
	];

	for (const eventType of bridgeEvents) {
		eventBus.on(eventType as any, (data: any) => {
			trackEvent(
				data.projectId,
				data.taskId,
				data.agentId,
				eventType,
				JSON.stringify(data.payload ?? data),
			).catch((err) => {
				console.warn(`[context-session] Failed to track ${eventType}:`, err);
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Resume Snapshot Builder
// ---------------------------------------------------------------------------

interface ResumeSnapshot {
	filesTracked: Array<{ path: string; ops: string }>;
	errors: string[];
	completedSteps: string[];
	decisions: string[];
	eventCount: number;
}

export async function buildResumeSnapshot(sessionKey: string): Promise<ResumeSnapshot> {
	const events = await getContextEvents(sessionKey, { limit: MAX_EVENTS_PER_SESSION });

	const fileOps = new Map<string, string[]>();
	const errors: string[] = [];
	const completedSteps: string[] = [];
	const decisions: string[] = [];

	for (const evt of events) {
		switch (evt.category) {
			case "file": {
				try {
					const parsed = JSON.parse(evt.data);
					const path = parsed.path ?? parsed.file ?? "unknown";
					const ops = fileOps.get(path) ?? [];
					ops.push(evt.type);
					fileOps.set(path, ops);
				} catch {
					// skip malformed
				}
				break;
			}
			case "error": {
				try {
					const parsed = JSON.parse(evt.data);
					const msg = parsed.error ?? parsed.title ?? evt.data.slice(0, 200);
					errors.push(`[${evt.type}] ${msg}`);
				} catch {
					errors.push(`[${evt.type}] ${evt.data.slice(0, 200)}`);
				}
				break;
			}
			case "task": {
				try {
					const parsed = JSON.parse(evt.data);
					const title = parsed.title ?? "unknown";
					if (evt.type.includes("completed")) {
						completedSteps.push(title);
					}
				} catch {
					// skip
				}
				break;
			}
			case "decision": {
				try {
					const parsed = JSON.parse(evt.data);
					const msg = parsed.title ?? evt.data.slice(0, 200);
					decisions.push(`[${evt.type}] ${msg}`);
				} catch {
					decisions.push(`[${evt.type}] ${evt.data.slice(0, 200)}`);
				}
				break;
			}
		}
	}

	const filesTracked = [...fileOps.entries()].map(([path, ops]) => {
		const opCounts = new Map<string, number>();
		for (const op of ops) {
			opCounts.set(op, (opCounts.get(op) ?? 0) + 1);
		}
		const opStr = [...opCounts.entries()].map(([o, c]) => `${o}×${c}`).join(", ");
		return { path, ops: opStr };
	});

	return {
		filesTracked,
		errors: errors.slice(0, 10),
		completedSteps: completedSteps.slice(0, 20),
		decisions: decisions.slice(0, 10),
		eventCount: events.length,
	};
}

export function formatResumeSnapshot(snapshot: ResumeSnapshot): string {
	const lines: string[] = ["## Previous Session Context", ""];

	if (snapshot.completedSteps.length > 0) {
		lines.push("### Completed Steps");
		for (const step of snapshot.completedSteps) {
			lines.push(`- ${step}`);
		}
		lines.push("");
	}

	if (snapshot.filesTracked.length > 0) {
		lines.push("### Files Tracked");
		for (const f of snapshot.filesTracked) {
			lines.push(`- \`${f.path}\` (${f.ops})`);
		}
		lines.push("");
	}

	if (snapshot.errors.length > 0) {
		lines.push("### Previous Errors");
		for (const err of snapshot.errors) {
			lines.push(`- ${err}`);
		}
		lines.push("");
	}

	if (snapshot.decisions.length > 0) {
		lines.push("### Decisions Made");
		for (const dec of snapshot.decisions) {
			lines.push(`- ${dec}`);
		}
		lines.push("");
	}

	lines.push(`> ${snapshot.eventCount} events tracked in this session.`);
	return lines.join("\n");
}
