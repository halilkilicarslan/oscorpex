// ---------------------------------------------------------------------------
// Project CRUD Routes — List, Create, Import, Get, Update, Delete + Templates + Platform Stats
// ---------------------------------------------------------------------------

import { access, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { createAgentFiles } from "../agent-files.js";
import { requirePermission } from "../auth/rbac.js";
import { getTenantContext, verifyProjectAccess } from "../auth/tenant-context.js";
import {
	copyAgentsToProject,
	createProject,
	deleteProject,
	getProject,
	getPlatformAnalytics,
	getPlatformStats,
	listProjectsPaginated,
	listTeamTemplates,
	setProjectSettings,
	updateProject,
} from "../db.js";
import { gitManager } from "../git-manager.js";
import { initLintConfig } from "../lint-runner.js";
import { createLogger } from "../logger.js";
import { getProjectTemplate, listProjectTemplates, scaffoldFromTemplate } from "../project-templates.js";
import { initSonarConfig, isSonarEnabled } from "../sonar-runner.js";

const log = createLogger("project-crud-routes");

export const projectCrudRoutes = new Hono();

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item).trim()).filter(Boolean);
}

async function saveProjectIntake(
	projectId: string,
	data: {
		previewEnabled?: boolean;
		projectType?: string;
		techPreference?: string[];
	},
): Promise<void> {
	await setProjectSettings(projectId, "runtime", {
		previewEnabled: data.previewEnabled === false ? "false" : "true",
	});

	const intakeEntries: Record<string, string> = {};
	if (data.projectType?.trim()) {
		intakeEntries.projectType = data.projectType.trim();
	}
	if (data.techPreference && data.techPreference.length > 0) {
		intakeEntries.techPreference = JSON.stringify(data.techPreference);
	}
	if (Object.keys(intakeEntries).length > 0) {
		await setProjectSettings(projectId, "intake", intakeEntries);
	}
}

// ---- Platform Overview Dashboard ------------------------------------------

projectCrudRoutes.get("/platform/stats", async (c) => {
	try {
		const stats = await getPlatformStats();
		return c.json(stats);
	} catch (err) {
		log.error("[project-crud-routes] platform stats failed:" + " " + String(err));
		return c.json({ error: "Failed to get platform stats" }, 500);
	}
});

// ---- Platform Analytics (context-mode style) ------------------------------

projectCrudRoutes.get("/platform/analytics", async (c) => {
	try {
		const analytics = await getPlatformAnalytics();
		return c.json(analytics);
	} catch (err) {
		log.error("[project-crud-routes] platform analytics failed:" + " " + String(err));
		return c.json({ error: "Failed to get platform analytics" }, 500);
	}
});

// ---- Projects CRUD --------------------------------------------------------

projectCrudRoutes.get("/projects", async (c) => {
	try {
		const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
		const offset = Number(c.req.query("offset") ?? 0);
		const { tenantId } = getTenantContext(c);
		// tenantId varsa sadece o tenant'ın projelerini döndür (M6.2 tenant scoping)
		const [projects, total] = await listProjectsPaginated(limit, offset, tenantId);
		c.header("X-Total-Count", String(total));
		return c.json(projects);
	} catch (err) {
		log.error("[project-crud-routes] list projects failed:" + " " + String(err));
		return c.json({ error: "Failed to list projects" }, 500);
	}
});

projectCrudRoutes.post("/projects", requirePermission("projects:create"), async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		description?: string;
		techStack?: string[];
		techPreference?: string[];
		projectType?: string;
		teamTemplateId?: string;
		plannerAgentId?: string;
		previewEnabled?: boolean;
	};
	if (body.teamTemplateId) {
		return c.json({ error: "teamTemplateId cannot be provided during initial project creation" }, 422);
	}
	if (!body.description || body.description.trim().length < 10) {
		return c.json({ error: "Proje açıklaması en az 10 karakter olmalıdır" }, 400);
	}
	const { tenantId, userId } = getTenantContext(c);
	const project = await createProject({
		name: body.name,
		description: body.description ?? "",
		techStack: body.techStack ?? [],
		repoPath: "",
		tenantId,
		ownerId: userId,
	});
	await saveProjectIntake(project.id, {
		previewEnabled: body.previewEnabled,
		projectType: body.projectType,
		techPreference: normalizeStringList(body.techPreference),
	});
	if (body.plannerAgentId?.trim()) {
		await setProjectSettings(project.id, "planner", {
			preferredPlannerAgentId: body.plannerAgentId.trim(),
		});
	}

	try {
		const repoPath = join(resolve(".oscorpex/repos"), project.id);
		await mkdir(repoPath, { recursive: true });
		await gitManager.initRepo(repoPath);
		await gitManager.initDocs(repoPath);
		await initLintConfig(repoPath);
		if (await isSonarEnabled()) {
			await initSonarConfig(repoPath, `studio-${project.id}`, project.name);
		}
		await updateProject(project.id, { repoPath });
		return c.json({ ...project, repoPath }, 201);
	} catch {
		return c.json(project, 201);
	}
});

// POST /projects/import — import an existing local repository as a project
projectCrudRoutes.post("/projects/import", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		repoPath: string;
		description?: string;
		techStack?: string[];
		plannerAgentId?: string;
		previewEnabled?: boolean;
	};

	if (!body.repoPath) return c.json({ error: "repoPath is required" }, 400);

	try {
		await access(body.repoPath);
	} catch {
		return c.json({ error: `Path does not exist: ${body.repoPath}` }, 400);
	}

	let description = body.description ?? "";
	let techStack = body.techStack ?? [];
	try {
		const pkgRaw = await readFile(join(body.repoPath, "package.json"), "utf-8");
		const pkg = JSON.parse(pkgRaw);
		if (!description && pkg.description) description = pkg.description;
		if (techStack.length === 0) {
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			const known = [
				"react",
				"vue",
				"angular",
				"next",
				"express",
				"hono",
				"fastify",
				"nestjs",
				"typescript",
				"tailwindcss",
				"prisma",
				"drizzle",
			];
			techStack = known.filter((k) => deps[k] || deps[`@${k}/core`]);
		}
	} catch {
		// No package.json or parse error — fine
	}

	const project = await createProject({
		name: body.name,
		description,
		techStack,
		repoPath: body.repoPath,
	});
	await saveProjectIntake(project.id, {
		previewEnabled: body.previewEnabled,
	});

	// Team setup is intentionally deferred to explicit /projects/:id/team/apply flow.

	try {
		await initLintConfig(body.repoPath);
		if (await isSonarEnabled()) {
			await initSonarConfig(body.repoPath, `studio-${project.id}`, project.name);
		}
	} catch {
		// Non-blocking
	}

	return c.json(project, 201);
});

projectCrudRoutes.get("/projects/:id", async (c) => {
	const projectId = c.req.param("id");
	const { tenantId } = getTenantContext(c);
	// Ownership check — returns 404 (not 403) to avoid leaking project existence
	const hasAccess = await verifyProjectAccess(projectId, tenantId);
	if (!hasAccess) return c.json({ error: "Project not found" }, 404);
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(project);
});

projectCrudRoutes.patch("/projects/:id", requirePermission("projects:update"), async (c) => {
	const body = await c.req.json();
	const id = c.req.param("id") ?? "";
	const project = await updateProject(id, body);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(project);
});

projectCrudRoutes.delete("/projects/:id", requirePermission("projects:delete"), async (c) => {
	const id = c.req.param("id") ?? "";
	const ok = await deleteProject(id);
	if (!ok) return c.json({ error: "Project not found" }, 404);
	return c.json({ success: true });
});

// ---- Project Templates (scaffold) -----------------------------------------

projectCrudRoutes.get("/project-templates", (c) => {
	return c.json(listProjectTemplates());
});

projectCrudRoutes.get("/project-templates/:id", (c) => {
	const template = getProjectTemplate(c.req.param("id"));
	if (!template) return c.json({ error: "Template not found" }, 404);
	const { files: _f, ...rest } = template;
	return c.json({ ...rest, fileCount: Object.keys(template.files).length });
});

// POST /projects/from-template — create project + scaffold files
projectCrudRoutes.post("/projects/from-template", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		templateId: string;
		description?: string;
		plannerAgentId?: string;
		previewEnabled?: boolean;
	};

	const template = getProjectTemplate(body.templateId);
	if (!template) return c.json({ error: "Template not found" }, 400);

	const project = await createProject({
		name: body.name,
		description: body.description ?? template.description,
		techStack: template.techStack,
		repoPath: "",
	});
	await saveProjectIntake(project.id, {
		previewEnabled: body.previewEnabled,
	});

	const templates = await listTeamTemplates();
	const teamTpl = templates.find((t) => t.name === template.teamTemplate) ?? templates[0];
	if (teamTpl) {
		const copiedAgents = await copyAgentsToProject(project.id, teamTpl.roles, {
			plannerSourceAgentId: body.plannerAgentId,
		});
		for (const agent of copiedAgents) {
			createAgentFiles(project.id, agent.name, {
				skills: agent.skills,
				systemPrompt: agent.systemPrompt,
				personality: agent.personality,
				role: agent.role,
				model: agent.model,
			}).catch((err) => log.error("Failed to create agent files:" + " " + String(err)));
		}
	}

	try {
		const repoPath = join(resolve(".oscorpex/repos"), project.id);
		await mkdir(repoPath, { recursive: true });
		await gitManager.initRepo(repoPath);

		const { filesCreated } = await scaffoldFromTemplate(repoPath, body.templateId);

		await gitManager.initDocs(repoPath);
		await initLintConfig(repoPath);

		if (filesCreated.length > 0) {
			try {
				await gitManager.commitFiles(repoPath, filesCreated, `chore: scaffold from ${template.name} template`);
			} catch {
				/* commit might fail if no changes */
			}
		}

		await updateProject(project.id, { repoPath });
		return c.json({ ...project, repoPath, filesCreated }, 201);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Scaffold failed";
		return c.json({ ...project, error: msg }, 201);
	}
});
