// ---------------------------------------------------------------------------
// Observability Routes — barrel
// Mounts all domain sub-routers under a single Hono instance.
// Mount point (in src/index.ts): app.route("/api/observability", observabilityRoutes)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { alertsRoutes } from "./alerts.js";
import { feedbacksRoutes } from "./feedbacks.js";
import { logsRoutes } from "./logs.js";
import { memoryRoutes } from "./memory.js";
import { promptsRoutes } from "./prompts.js";
import { ragRoutes } from "./rag.js";
import { studioTracesRoutes } from "./studio-traces.js";
import { tracesRoutes } from "./traces.js";
import { triggersRoutes } from "./triggers.js";

export const observabilityRoutes = new Hono();

observabilityRoutes.route("/", memoryRoutes);
observabilityRoutes.route("/", logsRoutes);
observabilityRoutes.route("/", studioTracesRoutes);
observabilityRoutes.route("/", tracesRoutes);
observabilityRoutes.route("/", promptsRoutes);
observabilityRoutes.route("/", alertsRoutes);
observabilityRoutes.route("/", feedbacksRoutes);
observabilityRoutes.route("/", triggersRoutes);
observabilityRoutes.route("/", ragRoutes);
