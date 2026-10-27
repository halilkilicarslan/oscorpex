export interface GatewayRequest {
	tenantId: string;
	projectId: string;
	actorId: string;
	source: "gateway";
	toolName: string;
	args: Record<string, unknown>;
	apiKeyId?: string;
}

export interface GatewayResponse {
	ok: boolean;
	data?: unknown;
	error?: { code: string; message: string };
	auditId?: string;
	rateLimit?: { remaining: number; resetAt: string };
}

export interface GatewayConfig {
	enabled: boolean;
	readOnly: boolean;
	maxRequestsPerMinute: number;
	allowedTools: Set<string>;
}
