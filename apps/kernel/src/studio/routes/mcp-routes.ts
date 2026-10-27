import { Hono } from "hono";
import { createLogger } from "../logger.js";
import { applyApprovedWrite } from "../mcp-bridge/approval-apply.js";
import { type McpRequestContext, handleJsonRpcRequest } from "../mcp-bridge/protocol/json-rpc.js";
import { rateLimiter } from "../middleware/rate-limiter.js";

const log = createLogger("mcp-routes");

export const mcpRoutes = new Hono();

// P5: Rate limit MCP endpoints (100 req/min)
mcpRoutes.use("*", rateLimiter({ windowMs: 60_000, max: 100 }));

// POST /mcp/invoke — JSON-RPC 2.0 endpoint
mcpRoutes.post("/mcp/invoke", async (c) => {
	// Build context from auth middleware
	const context: McpRequestContext = {
		tenantId: (c.get as (key: string) => string | undefined)("tenantId") ?? "dev_tenant_id",
		projectId: c.req.header("x-project-id") ?? "",
		actorId: (c.get as (key: string) => string | undefined)("userId") ?? "anonymous",
		source: (c.req.header("x-mcp-source") as "user" | "llm" | "provider" | "system") ?? "user",
	};

	if (!context.projectId) {
		log.warn("[mcp-routes] Missing x-project-id header");
		return c.json({ jsonrpc: "2.0", id: 0, error: { code: -32602, message: "x-project-id header required" } }, 400);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ jsonrpc: "2.0", id: 0, error: { code: -32700, message: "Parse error" } }, 400);
	}

	const response = await handleJsonRpcRequest(body, context);
	const status = response.error ? (response.error.code === -32600 ? 400 : 200) : 200;
	return c.json(response, status);
});

// POST /mcp/write/apply — execute approved write operation
mcpRoutes.post("/mcp/write/apply", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body || !body.approvalId || !body.toolName) {
		return c.json({ error: "approvalId and toolName required" }, 400);
	}
	const result = await applyApprovedWrite({
		approvalId: body.approvalId,
		checkpointId: body.checkpointId ?? "",
		tenantId: (c.get as (key: string) => string | undefined)("tenantId") ?? "dev_tenant_id",
		projectId: c.req.header("x-project-id") ?? body.projectId ?? "",
		actorId: (c.get as (key: string) => string | undefined)("userId") ?? "anonymous",
		toolName: body.toolName,
		args: body.args ?? {},
		source: "user",
	});
	return c.json(result, result.status === "applied" ? 200 : result.status === "denied" ? 403 : 500);
});

// GET /mcp/metrics — simple MCP usage metrics
mcpRoutes.get("/mcp/metrics", async (c) => {
	const { listMcpTools } = await import("../mcp-bridge/mcp-bridge.js");
	const tools = listMcpTools();
	return c.json({
		totalTools: tools.length,
		readOnlyTools: tools.filter((t) => t.riskLevel === "read").length,
		writeTools: tools.filter((t) => t.riskLevel === "write").length,
		writeToolsEnabled: process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS === "true",
		timestamp: new Date().toISOString(),
	});
});

// GET /scheduler/jobs — list all registered scheduler jobs and enabled state
mcpRoutes.get("/scheduler/jobs", async (c) => {
	const { listJobs, isSchedulerEnabled } = await import("../scheduler/index.js");
	return c.json({ enabled: isSchedulerEnabled(), jobs: listJobs() });
});

// POST /scheduler/soak — run soak cycle (non-production only)
mcpRoutes.post("/scheduler/soak", async (c) => {
	if (process.env.NODE_ENV === "production") {
		return c.json({ error: "Soak mode not available in production" }, 403);
	}
	const { runSoakCycle } = await import("../scheduler/index.js");
	const result = await runSoakCycle();
	return c.json(result);
});

// GET /hermes/metrics — P12-K: Hermes operational metrics
mcpRoutes.get("/hermes/metrics", async (c) => {
	const { isHermesEnabled } = await import("../hermes/hermes-config.js");
	return c.json({
		enabled: isHermesEnabled(),
		readOnly: true,
		timestamp: new Date().toISOString(),
	});
});

// GET /mcp/approvals — list pending write approvals (stub — returns empty for now)
mcpRoutes.get("/mcp/approvals", async (c) => {
	return c.json({ approvals: [] });
});

// GET /mcp/audit — list recent audit events (stub — returns empty for now)
mcpRoutes.get("/mcp/audit", async (c) => {
	return c.json({ events: [] });
});

// GET /hermes/keys — list Hermes API keys (stub — returns empty for now)
mcpRoutes.get("/hermes/keys", async (c) => {
	return c.json({ keys: [] });
});

// GET /mcp/tools — list available tools (convenience endpoint)
mcpRoutes.get("/mcp/tools", async (c) => {
	const response = await handleJsonRpcRequest(
		{ jsonrpc: "2.0", id: "list", method: "tools/list" },
		{
			tenantId: (c.get as (key: string) => string | undefined)("tenantId") ?? "dev",
			projectId: "any",
			actorId: (c.get as (key: string) => string | undefined)("userId") ?? "anon",
			source: "user",
		},
	);
	return c.json(response.result ?? response.error);
});
