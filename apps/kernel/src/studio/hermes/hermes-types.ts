export interface HermesApiKey {
	id: string;
	tenantId: string;
	name: string;
	keyHash: string;
	scopes: string[];
	rateLimit: number;
	sessionBudget: number;
	enabled: boolean;
	createdAt: string;
	expiresAt?: string;
}

export interface HermesSession {
	id: string;
	apiKeyId: string;
	tenantId: string;
	projectId: string;
	toolCallCount: number;
	maxToolCalls: number;
	createdAt: string;
	expiresAt: string;
	status: "active" | "exhausted" | "expired" | "revoked";
}

export interface HermesInvocation {
	sessionId: string;
	tenantId: string;
	projectId: string;
	actorId: string;
	toolName: string;
	args: Record<string, unknown>;
	source: "hermes";
}

export interface HermesResult {
	ok: boolean;
	data?: unknown;
	error?: { code: string; message: string };
	sessionId?: string;
	remainingCalls?: number;
	auditId?: string;
}
