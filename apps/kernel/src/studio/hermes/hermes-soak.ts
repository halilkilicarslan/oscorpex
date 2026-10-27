import { createLogger } from "../logger.js";
import { createSession, getHermesAllowedTools, handleHermesInvocation, isHermesEnabled } from "./index.js";

const log = createLogger("hermes-soak");

export interface HermesSoakResult {
	toolsTested: number;
	passed: number;
	failed: number;
	denied: number;
	results: Array<{ tool: string; status: string; error?: string }>;
	duration: number;
	timestamp: string;
}

// P13-B: Read-only soak — exercises every allowed tool + verifies denied tools are blocked.
// Never runs in production (caller must guard).
export async function runHermesSoak(tenantId: string, projectId: string): Promise<HermesSoakResult> {
	if (!isHermesEnabled()) {
		log.info("[hermes-soak] Hermes disabled — skipping soak");
		return {
			toolsTested: 0,
			passed: 0,
			failed: 0,
			denied: 0,
			results: [],
			duration: 0,
			timestamp: new Date().toISOString(),
		};
	}

	const tools = Array.from(getHermesAllowedTools());
	const session = createSession({
		apiKeyId: "soak-test",
		tenantId,
		projectId,
		maxToolCalls: tools.length + 10,
	});
	const results: Array<{ tool: string; status: string; error?: string }> = [];
	const start = Date.now();

	log.info({ tenantId, projectId, toolCount: tools.length }, "[hermes-soak] Starting soak run");

	// Exercise each allowed (read-only) tool
	for (const tool of tools) {
		const result = await handleHermesInvocation({
			sessionId: session.id,
			tenantId,
			projectId,
			actorId: "soak-tester",
			toolName: tool,
			args: {},
			source: "hermes",
		});
		results.push({
			tool,
			status: result.ok ? "pass" : "fail",
			error: result.error?.message,
		});
	}

	// Verify denied write-capable tools are actually blocked
	const deniedTools = ["file.write", "git.commit", "shell.run"];
	for (const tool of deniedTools) {
		const result = await handleHermesInvocation({
			sessionId: session.id,
			tenantId,
			projectId,
			actorId: "soak-tester",
			toolName: tool,
			args: {},
			source: "hermes",
		});
		results.push({
			tool,
			status: result.ok ? "UNEXPECTED_PASS" : "correctly_denied",
			error: result.error?.code,
		});
	}

	const duration = Date.now() - start;
	const passed = results.filter((r) => r.status === "pass").length;
	const failed = results.filter((r) => r.status === "fail").length;
	const denied = results.filter((r) => r.status === "correctly_denied").length;

	log.info({ passed, failed, denied, duration }, "[hermes-soak] Soak run complete");

	return {
		toolsTested: results.length,
		passed,
		failed,
		denied,
		results,
		duration,
		timestamp: new Date().toISOString(),
	};
}
