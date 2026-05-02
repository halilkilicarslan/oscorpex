// ---------------------------------------------------------------------------
// Project Routes — Barrel that mounts all project sub-routers
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { projectChatRoutes } from "./project-chat-routes.js";
import { projectCrudRoutes } from "./project-crud-routes.js";
import { projectExecutionRoutes } from "./project-execution-routes.js";
import { projectPlanRoutes } from "./project-plan-routes.js";
import { projectSettingsRoutes } from "./project-settings-routes.js";

export const projectRoutes = new Hono();
projectRoutes.route("/", projectCrudRoutes);
projectRoutes.route("/", projectChatRoutes);
projectRoutes.route("/", projectPlanRoutes);
projectRoutes.route("/", projectExecutionRoutes);
projectRoutes.route("/", projectSettingsRoutes);
