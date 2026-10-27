import type { GatewayConfig } from "./gateway-types.js";

const READ_ONLY_TOOLS = new Set([
	"repo.listFiles",
	"repo.readFile",
	"repo.search",
	"git.status",
	"git.diff",
	"project.getTaskState",
	"project.getPipelineState",
	"docs.search",
]);

export function getGatewayConfig(): GatewayConfig {
	return {
		enabled: process.env.OSCORPEX_ENABLE_GATEWAY === "true",
		readOnly: true, // P11: always read-only
		maxRequestsPerMinute: Number(process.env.OSCORPEX_GATEWAY_RATE_LIMIT) || 60,
		allowedTools: READ_ONLY_TOOLS,
	};
}

export function isGatewayEnabled(): boolean {
	return process.env.OSCORPEX_ENABLE_GATEWAY === "true";
}
