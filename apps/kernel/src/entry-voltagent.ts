// ---------------------------------------------------------------------------
// Oscorpex — VoltAgent Integration Entry Point (isolated)
// Boots the kernel AND registers VoltAgent agents/workflows.
// VoltAgent modules are loaded dynamically so the kernel can build/run
// without them when OSCORPEX_MODE !== "voltagent".
// ---------------------------------------------------------------------------

import "dotenv/config";
import { createLogger } from "./studio/logger.js";

const log = createLogger("entry-voltagent");

async function bootVoltAgentMode() {
	// Dynamic imports isolate VoltAgent from the core build graph
	const { Agent, Memory, VoltAgent, VoltAgentObservability, VoltOpsClient } = await import("@voltagent/core");
	const { LibSQLMemoryAdapter, LibSQLObservabilityAdapter } = await import("@voltagent/libsql");
	const { createPinoLogger } = await import("@voltagent/logger");
	const { honoServer } = await import("@voltagent/server-hono");
	const { createCodeAssistant, createSummarizer, createTranslator } = await import("./agents/index.js");
	const { calculatorTool, dateTimeTool, weatherTool, webSearchTool } = await import("./tools/index.js");
	const { expenseApprovalWorkflow } = await import("./workflows/index.js");

	const logger = createPinoLogger({ name: "my-voltagent-app", level: "info" });

	const memory = new Memory({
		storage: new LibSQLMemoryAdapter({
			url: "file:./.voltagent/memory.db",
			logger: logger.child({ component: "libsql" }),
		}),
	});

	const observability = new VoltAgentObservability({
		storage: new LibSQLObservabilityAdapter({
			url: "file:./.voltagent/observability.db",
		}),
	});

	const allTools = [weatherTool, calculatorTool, dateTimeTool, webSearchTool];

	const assistant = new Agent({
		name: "assistant",
		instructions: `You are a helpful AI assistant...`,
		model: "openai/gpt-4o-mini",
		tools: allTools,
		memory,
	});

	const researcher = new Agent({
		name: "researcher",
		instructions: `You are a research specialist...`,
		model: "openai/gpt-4o-mini",
		tools: [webSearchTool, dateTimeTool],
		memory,
	});

	const codeAssistant = createCodeAssistant();
	const translator = createTranslator();
	const summarizer = createSummarizer();

	// Boot shared kernel services
	const { applyDbBootstrap } = await import("./studio/db-bootstrap.js");
	const { providerState } = await import("./studio/provider-state.js");
	const { startWSServer } = await import("./studio/ws-server.js");
	const { webhookSender } = await import("./studio/webhook-sender.js");
	const { containerPool } = await import("./studio/container-pool.js");
	const { studioRoutes, authRoutes } = await import("./studio/index.js");
	const { observabilityRoutes } = await import("./observability-routes.js");

	await applyDbBootstrap();
	await providerState.loadFromDb().catch((err) => {
		log.warn("[provider-state] Load skipped:", err instanceof Error ? err.message : err);
	});
	startWSServer();
	webhookSender.init();
	containerPool.initialize().catch((err) => {
		log.warn("[pool] Initialization skipped:", err instanceof Error ? err.message : err);
	});

	new VoltAgent({
		agents: {
			assistant,
			researcher,
			"code-assistant": codeAssistant,
			translator,
			summarizer,
		},
		workflows: { expenseApprovalWorkflow },
		server: honoServer({
			port: 3141,
			configureApp: (app: any) => {
				app.route("/api/studio", studioRoutes);
				app.route("/api/observability", observabilityRoutes);
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

	log.info("[entry-voltagent] VoltAgent mode booted successfully");
}

// Only boot VoltAgent when explicitly requested
if (process.env.OSCORPEX_MODE === "voltagent") {
	bootVoltAgentMode().catch((err) => {
		log.error("[entry-voltagent] Failed to boot VoltAgent mode:", err);
		process.exit(1);
	});
} else {
	log.info("[entry-voltagent] OSCORPEX_MODE !== 'voltagent' — skipping VoltAgent boot. Use boot.ts for kernel-only mode.");
}