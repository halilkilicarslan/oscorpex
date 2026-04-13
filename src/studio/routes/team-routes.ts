// ---------------------------------------------------------------------------
// Team Routes — Team Templates, Custom Teams, Project Team (project_agents)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	createAgentFiles,
	deleteAgentFiles,
	listAgentFiles,
	readAgentFile,
	updateAgentFiles,
	writeAgentFile,
} from "../agent-files.js";
import {
	copyAgentsToProject,
	createCustomTeamTemplate,
	createProjectAgent,
	deleteCustomTeamTemplate,
	deleteProjectAgent,
	getAgentConfig,
	getCustomTeamTemplate,
	getProject,
	getProjectAgent,
	getTeamTemplate,
	listCustomTeamTemplates,
	listProjectAgents,
	listTeamTemplates,
	updateCustomTeamTemplate,
	updateProjectAgent,
} from "../db.js";
import type { ProjectAgent } from "../types.js";

export const teamRoutes = new Hono();

// ---- Team Templates -------------------------------------------------------

teamRoutes.get("/team-templates", async (c) => {
	return c.json(await listTeamTemplates());
});

// ---- Custom Team Templates (user-created) ---------------------------------

teamRoutes.get("/custom-teams", async (c) => {
	return c.json(await listCustomTeamTemplates());
});

teamRoutes.get("/custom-teams/:id", async (c) => {
	const template = await getCustomTeamTemplate(c.req.param("id"));
	if (!template) return c.json({ error: "Not found" }, 404);
	return c.json(template);
});

teamRoutes.post("/custom-teams", async (c) => {
	const body = await c.req.json();
	const template = await createCustomTeamTemplate(body);
	return c.json(template, 201);
});

teamRoutes.put("/custom-teams/:id", async (c) => {
	const body = await c.req.json();
	const template = await updateCustomTeamTemplate(c.req.param("id"), body);
	if (!template) return c.json({ error: "Not found" }, 404);
	return c.json(template);
});

teamRoutes.delete("/custom-teams/:id", async (c) => {
	const ok = await deleteCustomTeamTemplate(c.req.param("id"));
	if (!ok) return c.json({ error: "Not found" }, 404);
	return c.json({ success: true });
});

// ---- Project Team (project_agents) ----------------------------------------

// Projenin takım üyelerini listele
teamRoutes.get("/projects/:id/team", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json(await listProjectAgents(projectId));
});

// Projeye yeni takım üyesi ekle
teamRoutes.post("/projects/:id/team", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as {
		sourceAgentId?: string;
		name?: string;
		role?: string;
		avatar?: string;
		personality?: string;
		model?: string;
		cliTool?: string;
		skills?: string[];
		systemPrompt?: string;
	};

	if (body.sourceAgentId) {
		const preset = await getAgentConfig(body.sourceAgentId);
		if (!preset) return c.json({ error: "Source agent not found" }, 404);
		const agent = await createProjectAgent({
			projectId,
			sourceAgentId: preset.id,
			name: body.name ?? preset.name,
			role: body.role ?? preset.role,
			avatar: body.avatar ?? preset.avatar,
			personality: body.personality ?? preset.personality,
			model: body.model ?? preset.model,
			cliTool: body.cliTool ?? preset.cliTool,
			skills: body.skills ?? preset.skills,
			systemPrompt: body.systemPrompt ?? preset.systemPrompt,
		});
		createAgentFiles(projectId, agent.name, {
			skills: agent.skills,
			systemPrompt: agent.systemPrompt,
			personality: agent.personality,
			role: agent.role,
			model: agent.model,
		}).catch((err) => console.error("Failed to create agent files:", err));
		return c.json(agent, 201);
	}

	if (!body.name || !body.role) {
		return c.json({ error: "name and role are required" }, 400);
	}

	const agent = await createProjectAgent({
		projectId,
		sourceAgentId: body.sourceAgentId,
		name: body.name,
		role: body.role,
		avatar: body.avatar ?? "",
		personality: body.personality ?? "",
		model: body.model ?? "claude-sonnet-4-6",
		cliTool: body.cliTool ?? "claude-code",
		skills: body.skills ?? [],
		systemPrompt: body.systemPrompt ?? "",
	});
	createAgentFiles(projectId, agent.name, {
		skills: agent.skills,
		systemPrompt: agent.systemPrompt,
		personality: agent.personality,
		role: agent.role,
		model: agent.model,
	}).catch((err) => console.error("Failed to create agent files:", err));
	return c.json(agent, 201);
});

// Get org structure for a project
// NOTE: Must be defined BEFORE /team/:agentId to prevent "org" matching as agentId
teamRoutes.get("/projects/:id/team/org", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const agents = await listProjectAgents(projectId);

	const tree = buildOrgTree(agents);

	const pipeline = agents
		.filter((a) => a.pipelineOrder > 0)
		.sort((a, b) => a.pipelineOrder - b.pipelineOrder)
		.map((a) => ({
			id: a.id,
			name: a.name,
			role: a.role,
			avatar: a.avatar,
			color: a.color,
			pipelineOrder: a.pipelineOrder,
		}));

	return c.json({ tree, pipeline });
});

// Tekil proje agentını getir
teamRoutes.get("/projects/:id/team/:agentId", async (c) => {
	const agent = await getProjectAgent(c.req.param("agentId"));
	if (!agent || agent.projectId !== c.req.param("id")) {
		return c.json({ error: "Agent not found" }, 404);
	}
	return c.json(agent);
});

// Proje agentını güncelle
teamRoutes.put("/projects/:id/team/:agentId", async (c) => {
	const agentId = c.req.param("agentId");
	const existing = await getProjectAgent(agentId);
	if (!existing || existing.projectId !== c.req.param("id")) {
		return c.json({ error: "Agent not found" }, 404);
	}

	const body = await c.req.json();
	const updated = await updateProjectAgent(agentId, body);
	if (!updated) return c.json({ error: "Agent not found" }, 404);
	updateAgentFiles(c.req.param("id"), updated.name, {
		skills: updated.skills,
		systemPrompt: updated.systemPrompt,
		personality: updated.personality,
		role: updated.role,
		model: updated.model,
	}).catch((err) => console.error("Failed to update agent files:", err));
	return c.json(updated);
});

// Proje agentını takımdan çıkar
teamRoutes.delete("/projects/:id/team/:agentId", async (c) => {
	const agentId = c.req.param("agentId");
	const existing = await getProjectAgent(agentId);
	if (!existing || existing.projectId !== c.req.param("id")) {
		return c.json({ error: "Agent not found" }, 404);
	}
	const ok = await deleteProjectAgent(agentId);
	if (!ok) return c.json({ error: "Agent not found" }, 404);
	deleteAgentFiles(c.req.param("id"), existing.name).catch(() => {});
	return c.json({ success: true });
});

// Şablondan agentları projeye toplu kopyala
teamRoutes.post("/projects/:id/team/from-template", async (c) => {
	const projectId = c.req.param("id");
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json()) as { templateId: string };
	if (!body.templateId) return c.json({ error: "templateId is required" }, 400);

	const template = await getTeamTemplate(body.templateId);
	if (!template) return c.json({ error: "Template not found" }, 404);

	const agents = await copyAgentsToProject(projectId, template.roles);
	for (const agent of agents) {
		createAgentFiles(projectId, agent.name, {
			skills: agent.skills,
			systemPrompt: agent.systemPrompt,
			personality: agent.personality,
			role: agent.role,
			model: agent.model,
		}).catch((err) => console.error("Failed to create agent files:", err));
	}
	return c.json(agents, 201);
});

// ---- Agent .md Files ------------------------------------------------------

teamRoutes.get("/projects/:id/team/:agentId/files", async (c) => {
	const agent = await getProjectAgent(c.req.param("agentId"));
	if (!agent || agent.projectId !== c.req.param("id")) {
		return c.json({ error: "Agent not found" }, 404);
	}
	const files = await listAgentFiles(c.req.param("id"), agent.name);
	return c.json({ agentId: agent.id, agentName: agent.name, files });
});

teamRoutes.get("/projects/:id/team/:agentId/files/:fileName", async (c) => {
	const agent = await getProjectAgent(c.req.param("agentId"));
	if (!agent || agent.projectId !== c.req.param("id")) {
		return c.json({ error: "Agent not found" }, 404);
	}
	const content = await readAgentFile(c.req.param("id"), agent.name, c.req.param("fileName"));
	if (content === null) return c.json({ error: "File not found" }, 404);
	return c.json({ fileName: c.req.param("fileName"), content });
});

teamRoutes.put("/projects/:id/team/:agentId/files/:fileName", async (c) => {
	const agent = await getProjectAgent(c.req.param("agentId"));
	if (!agent || agent.projectId !== c.req.param("id")) {
		return c.json({ error: "Agent not found" }, 404);
	}
	const body = (await c.req.json()) as { content: string };
	await writeAgentFile(c.req.param("id"), agent.name, c.req.param("fileName"), body.content);
	return c.json({ success: true });
});

// ---- Org Structure helpers ------------------------------------------------

interface OrgNode {
	id: string;
	name: string;
	role: string;
	avatar: string;
	color: string;
	pipelineOrder: number;
	children: OrgNode[];
}

function buildOrgTree(agents: ProjectAgent[]): OrgNode[] {
	const nodeMap = new Map<string, OrgNode>();

	for (const a of agents) {
		nodeMap.set(a.id, {
			id: a.id,
			name: a.name,
			role: a.role,
			avatar: a.avatar,
			color: a.color,
			pipelineOrder: a.pipelineOrder,
			children: [],
		});
	}

	const roots: OrgNode[] = [];

	for (const a of agents) {
		const node = nodeMap.get(a.id)!;
		if (a.reportsTo && nodeMap.has(a.reportsTo)) {
			nodeMap.get(a.reportsTo)?.children.push(node);
		} else {
			roots.push(node);
		}
	}

	return roots;
}

// Update agent hierarchy
teamRoutes.put("/projects/:id/team/:agentId/hierarchy", async (c) => {
	const agentId = c.req.param("agentId");
	const existing = await getProjectAgent(agentId);
	if (!existing || existing.projectId !== c.req.param("id")) {
		return c.json({ error: "Agent not found" }, 404);
	}
	const body = (await c.req.json()) as {
		reportsTo: string | null;
		pipelineOrder?: number;
	};
	const updated = await updateProjectAgent(agentId, {
		reportsTo: body.reportsTo ?? undefined,
		pipelineOrder: body.pipelineOrder,
	});
	return c.json(updated);
});

// ---- Agent Dependencies (v2 org structure) --------------------------------

teamRoutes.get("/projects/:id/dependencies", async (c) => {
	const { listAgentDependencies } = await import("../db.js");
	const projectId = c.req.param("id");
	const type = c.req.query("type") as any;
	return c.json(await listAgentDependencies(projectId, type));
});

teamRoutes.post("/projects/:id/dependencies", async (c) => {
	const { createAgentDependency } = await import("../db.js");
	const projectId = c.req.param("id");
	const body = await c.req.json<{
		fromAgentId: string;
		toAgentId: string;
		type?: any;
	}>();
	if (!body.fromAgentId || !body.toAgentId) {
		return c.json({ error: "fromAgentId and toAgentId required" }, 400);
	}
	const dep = await createAgentDependency(projectId, body.fromAgentId, body.toAgentId, body.type ?? "workflow");
	return c.json(dep, 201);
});

teamRoutes.put("/projects/:id/dependencies", async (c) => {
	const { bulkCreateDependencies, deleteAllDependencies } = await import("../db.js");
	const projectId = c.req.param("id");
	const body = await c.req.json<{
		dependencies: {
			fromAgentId: string;
			toAgentId: string;
			type: any;
		}[];
	}>();
	await deleteAllDependencies(projectId);
	const deps = await bulkCreateDependencies(projectId, body.dependencies ?? []);
	return c.json(deps);
});

teamRoutes.delete("/projects/:id/dependencies/:depId", async (c) => {
	const { deleteAgentDependency } = await import("../db.js");
	const depId = c.req.param("depId");
	await deleteAgentDependency(depId);
	return c.json({ ok: true });
});

// ---- Agent Capabilities (file scope restrictions) -------------------------

teamRoutes.get("/projects/:id/capabilities", async (c) => {
	const { listAgentCapabilities } = await import("../db.js");
	const projectId = c.req.param("id");
	const agentId = c.req.query("agentId");
	return c.json(await listAgentCapabilities(projectId, agentId));
});

teamRoutes.post("/projects/:id/capabilities", async (c) => {
	const { createAgentCapability } = await import("../db.js");
	const projectId = c.req.param("id");
	const body = await c.req.json<{
		agentId: string;
		pattern: string;
		scopeType?: any;
		permission?: any;
	}>();
	if (!body.agentId || !body.pattern) {
		return c.json({ error: "agentId and pattern required" }, 400);
	}
	const cap = await createAgentCapability(body.agentId, projectId, body.pattern, body.scopeType, body.permission);
	return c.json(cap, 201);
});

teamRoutes.delete("/projects/:id/capabilities/:capId", async (c) => {
	const { deleteAgentCapability } = await import("../db.js");
	const capId = c.req.param("capId");
	await deleteAgentCapability(capId);
	return c.json({ ok: true });
});

teamRoutes.delete("/projects/:id/capabilities", async (c) => {
	const { deleteAllCapabilities } = await import("../db.js");
	const projectId = c.req.param("id");
	const agentId = c.req.query("agentId");
	await deleteAllCapabilities(projectId, agentId);
	return c.json({ ok: true });
});
