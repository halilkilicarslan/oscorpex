import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { getDefaultSessionBudget } from "./hermes-config.js";
import type { HermesSession } from "./hermes-types.js";

const log = createLogger("hermes-session");
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// In-memory store (DB-backed in production)
const sessions = new Map<string, HermesSession>();

export function createSession(opts: {
	apiKeyId: string;
	tenantId: string;
	projectId: string;
	maxToolCalls?: number;
}): HermesSession {
	const now = new Date();
	const session: HermesSession = {
		id: randomUUID(),
		apiKeyId: opts.apiKeyId,
		tenantId: opts.tenantId,
		projectId: opts.projectId,
		toolCallCount: 0,
		maxToolCalls: opts.maxToolCalls ?? getDefaultSessionBudget(),
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
		status: "active",
	};
	sessions.set(session.id, session);
	log.info(
		{ sessionId: session.id, tenantId: opts.tenantId, maxToolCalls: session.maxToolCalls },
		"[hermes-session] Session created",
	);
	return session;
}

export function getSession(id: string): HermesSession | undefined {
	return sessions.get(id);
}

export function consumeToolCall(sessionId: string): { allowed: boolean; remaining: number } {
	const session = sessions.get(sessionId);
	if (!session) return { allowed: false, remaining: 0 };
	if (session.status !== "active") return { allowed: false, remaining: 0 };
	if (new Date(session.expiresAt) < new Date()) {
		session.status = "expired";
		log.warn({ sessionId }, "[hermes-session] Session expired");
		return { allowed: false, remaining: 0 };
	}
	if (session.toolCallCount >= session.maxToolCalls) {
		session.status = "exhausted";
		log.warn({ sessionId, maxToolCalls: session.maxToolCalls }, "[hermes-session] Session budget exhausted");
		return { allowed: false, remaining: 0 };
	}
	session.toolCallCount++;
	const remaining = session.maxToolCalls - session.toolCallCount;
	return { allowed: true, remaining };
}
