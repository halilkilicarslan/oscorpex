import "dotenv/config";
import { Agent, Memory, VoltAgent, VoltAgentObservability, VoltOpsClient } from "@voltagent/core";
import { LibSQLMemoryAdapter, LibSQLObservabilityAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { createCodeAssistant, createSummarizer, createTranslator } from "./agents";
import { observabilityRoutes } from "./observability-routes.js";
import { containerPool } from "./studio/container-pool.js";
import { applyDbBootstrap } from "./studio/db-bootstrap.js";
import { authRoutes, studioRoutes } from "./studio/index.js";
import { providerState } from "./studio/provider-state.js";
import { webhookSender } from "./studio/webhook-sender.js";
import { startWSServer } from "./studio/ws-server.js";
import { calculatorTool, dateTimeTool, weatherTool, webSearchTool } from "./tools";
import { expenseApprovalWorkflow } from "./workflows";

// Create a logger instance
const logger = createPinoLogger({
	name: "my-voltagent-app",
	level: "info",
});

// Configure persistent memory (LibSQL / SQLite)
const memory = new Memory({
	storage: new LibSQLMemoryAdapter({
		url: "file:./.voltagent/memory.db",
		logger: logger.child({ component: "libsql" }),
	}),
});

// Configure persistent observability (LibSQL / SQLite)
const observability = new VoltAgentObservability({
	storage: new LibSQLObservabilityAdapter({
		url: "file:./.voltagent/observability.db",
	}),
});

// All available tools
const allTools = [weatherTool, calculatorTool, dateTimeTool, webSearchTool];

// Main assistant agent — general purpose with all tools
const assistant = new Agent({
	name: "assistant",
	instructions: `You are a helpful AI assistant. You can:
- Check real-time weather for any city worldwide
- Perform calculations and math operations
- Get current date/time in any timezone
- Search the web for information

Always be concise and accurate. If you're unsure about something, say so.
When using tools, explain what you're doing and present results clearly.`,
	model: "openai/gpt-4o-mini",
	tools: allTools,
	memory,
});

// Research specialist agent — focused on web search and analysis
const researcher = new Agent({
	name: "researcher",
	instructions: `You are a research specialist. Your role is to:
- Search for information on given topics
- Summarize findings concisely
- Provide sources when available
- Compare different perspectives

Focus on accuracy and cite your sources. Present findings in a structured format.`,
	model: "openai/gpt-4o-mini",
	tools: [webSearchTool, dateTimeTool],
	memory,
});

const codeAssistant = createCodeAssistant();
const translator = createTranslator();
const summarizer = createSummarizer();

// Apply DB schema migrations (idempotent — safe on every startup)
await applyDbBootstrap();
await providerState.loadFromDb().catch((err) => {
	console.warn("[provider-state] Load skipped:", err instanceof Error ? err.message : err);
});

// Oscorpex WebSocket sunucusunu başlat (port 3142)
startWSServer();

// Webhook sender — event bus'a abone ol, tüm event tiplerini dinle
webhookSender.init();

// Container pool warm-up (non-blocking — fails silently if Docker not available)
containerPool.initialize().catch((err) => {
	console.warn("[pool] Initialization skipped:", err instanceof Error ? err.message : err);
});

new VoltAgent({
	agents: {
		assistant,
		researcher,
		"code-assistant": codeAssistant,
		translator,
		summarizer,
	},
	workflows: {
		expenseApprovalWorkflow,
	},
	server: honoServer({
		port: 3141,
		configureApp: (app) => {
			app.route("/api/studio", studioRoutes);
			app.route("/api/observability", observabilityRoutes);
			// M6: Auth routes — public (no auth middleware)
			app.route("/api/auth", authRoutes);
		},
	}),
	logger,
	observability,
	voltOpsClient: new VoltOpsClient({
		publicKey: process.env.VOLTAGENT_PUBLIC_KEY || "",
		secretKey: process.env.VOLTAGENT_SECRET_KEY || "",
	}),
});
