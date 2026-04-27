// ---------------------------------------------------------------------------
// Oscorpex — Studio Routes
// Pure routing composition. Side-effect wiring lives in ../composition/.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { cors } from "hono/cors";
import { budgetGuard } from "../middleware/policy-middleware.js";
import { authMiddleware } from "../auth/auth-middleware.js";
import { correlationMiddleware } from "../middleware/correlation-middleware.js";
import { guaranteedCorrelationHeader } from "../middleware/guaranteed-correlation-header.js";

import { agentRoutes } from "./agent-routes.js";
import { costRoutes } from "./cost-routes.js";
import { notificationRoutes } from "./notification-routes.js";
import { analyticsRoutes } from "./analytics-routes.js";
import authRoutes from "./auth-routes.js";
import { ceremonyRoutes } from "./ceremony-routes.js";
import { cliUsageRoutes } from "./cli-usage-routes.js";
import { gitFileRoutes } from "./git-file-routes.js";
import { integrationRoutes } from "./integration-routes.js";
import { lifecycleRoutes } from "./lifecycle-routes.js";
import { memoryRoutes } from "./memory-routes.js";
import { pipelineRoutes } from "./pipeline-routes.js";
import pluginRoutes from "./plugin-routes.js";
import { projectRoutes } from "./project-routes.js";
import { providerRoutes } from "./provider-routes.js";
import { runtimeRoutes } from "./runtime-routes.js";
import { sprintRoutes } from "./sprint-routes.js";
import { taskRoutes } from "./task-routes.js";
import { teamRoutes } from "./team-routes.js";
import { workItemRoutes } from "./work-item-routes.js";
import { templateRoutes } from "./template-routes.js";
import { ciRoutes } from "./ci-routes.js";
import { jobRoutes } from "./job-routes.js";
import { telemetryRoutes } from "./telemetry-routes.js";
import { clusterRoutes } from "./cluster-routes.js";
import { collaborationRoutes } from "./collaboration-routes.js";
import { marketplaceRoutes } from "./marketplace-routes.js";
import { agenticRoutes } from "./agentic-routes.js";
import { graphRoutes } from "./graph-routes.js";
import { sandboxRoutes } from "./sandbox-routes.js";
import { replayRoutes } from "./replay-routes.js";
import { cpRegistryRoutes } from "../control-plane/registry/registry-routes.js";

const studio = new Hono();

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.OSCORPEX_CORS_ORIGINS ?? "http://localhost:5173,http://localhost:4242")
	.split(",")
	.map((o) => o.trim())
	.filter(Boolean);

studio.use(
	"*",
	cors({
		origin: allowedOrigins,
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		maxAge: 86400,
	}),
);

// ---------------------------------------------------------------------------
// Correlation ID — propagate request tracing across logs and events
// ---------------------------------------------------------------------------
studio.use("*", correlationMiddleware);
studio.use("*", guaranteedCorrelationHeader);

// ---------------------------------------------------------------------------
// Auth middleware — Bearer token (opt-in via OSCORPEX_API_KEY env var)
// ---------------------------------------------------------------------------
const apiKey = process.env.OSCORPEX_API_KEY;
if (apiKey) {
	studio.use("*", async (c, next) => {
		if (c.req.header("accept")?.includes("text/event-stream")) return next();
		const authHeader = c.req.header("authorization");
		if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		return next();
	});
}

// ---------------------------------------------------------------------------
// M6.2: Tenant-aware auth middleware — only active when OSCORPEX_AUTH_ENABLED=true
// ---------------------------------------------------------------------------
if (process.env.OSCORPEX_AUTH_ENABLED === "true") {
	studio.use("*", async (c, next) => {
		if (c.req.header("accept")?.includes("text/event-stream")) return next();
		return authMiddleware(c, next);
	});
}

// ---------------------------------------------------------------------------
// Budget guard — execution routes
// ---------------------------------------------------------------------------
studio.use("/projects/:id/execute*", budgetGuard());
studio.use("/projects/:id/pipeline/start*", budgetGuard());
studio.use("/projects/:id/agents/:agentId/exec*", budgetGuard());

// ---------------------------------------------------------------------------
// Route Mounts — grouped by bounded context
// ---------------------------------------------------------------------------

// Core — project, task, agent management
studio.route("/", projectRoutes);
studio.route("/", taskRoutes);
studio.route("/", agentRoutes);
studio.route("/", teamRoutes);
studio.route("/auth", authRoutes);

// Execution — pipeline, runtime, provider, sandbox, graph, agentic
studio.route("/", pipelineRoutes);
studio.route("/", runtimeRoutes);
studio.route("/", providerRoutes);
studio.route("/", sandboxRoutes);
studio.route("/", graphRoutes);
studio.route("/", agenticRoutes);

// Management — lifecycle, sprint, work items, templates, CI, jobs
studio.route("/", lifecycleRoutes);
studio.route("/", sprintRoutes);
studio.route("/", workItemRoutes);
studio.route("/templates", templateRoutes);
studio.route("/ci", ciRoutes);
studio.route("/jobs", jobRoutes);

// Integration — git, plugins, external integrations
studio.route("/", gitFileRoutes);
studio.route("/plugins", pluginRoutes);
studio.route("/", integrationRoutes);

// Observability — analytics, telemetry, cost, replay, notifications
studio.route("/", analyticsRoutes);
studio.route("/cost", costRoutes);
studio.route("/notifications", notificationRoutes);
studio.route("/replay", replayRoutes);

// Telemetry endpoints (performance config, provider records, queue wait)
studio.route("/telemetry", telemetryRoutes);

// Memory routes (archived — VoltAgent integration removed)
studio.route("/", memoryRoutes);

// CLI usage routes (used by console CLI usage monitor page)
studio.route("/", cliUsageRoutes);

// Control Plane — Phase 1
studio.route("/", cpRegistryRoutes);

// YAGNI-deferred: marketplace, cluster, collaboration
// Re-enable when needed.
studio.route("/", ceremonyRoutes);
// studio.route("/cluster", clusterRoutes);
// studio.route("/collaboration", collaborationRoutes);
// studio.route("/marketplace", marketplaceRoutes);

export { studio as studioRoutes };
