// ---------------------------------------------------------------------------
// Oscorpex — Skill Routes
// CRUD for skills + agent/project skill assignments.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	assignSkillToAgent,
	assignSkillToProject,
	createSkill,
	deleteSkill,
	getAgentSkills,
	getProjectSkills,
	getSkill,
	listSkills,
	removeSkillFromAgent,
	removeSkillFromProject,
	updateSkill,
} from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("skill-routes");
const skillRoutes = new Hono();

// ---------------------------------------------------------------------------
// Skills CRUD
// ---------------------------------------------------------------------------

skillRoutes.get("/skills", async (c) => {
	const category = c.req.query("category");
	const isGlobal = c.req.query("global") === "true" ? true : undefined;
	const role = c.req.query("role");
	log.info({ category, isGlobal, role }, "listing skills");
	const skills = await listSkills({ category, isGlobal, role });
	return c.json(skills);
});

skillRoutes.get("/skills/:id", async (c) => {
	const id = c.req.param("id");
	log.info({ id }, "fetching skill");
	const skill = await getSkill(id);
	if (!skill) return c.json({ error: "Skill not found" }, 404);
	return c.json(skill);
});

skillRoutes.post("/skills", async (c) => {
	const body = await c.req.json();
	if (!body.name?.trim() || !body.description?.trim()) {
		return c.json({ error: "name and description are required" }, 400);
	}
	log.info({ name: body.name }, "creating skill");
	const skill = await createSkill({
		name: body.name.trim(),
		description: body.description.trim(),
		contentMd: body.contentMd ?? "",
		triggers: Array.isArray(body.triggers) ? body.triggers : [],
		applicableRoles: Array.isArray(body.applicableRoles) ? body.applicableRoles : [],
		providerHint: body.providerHint,
		modelHint: body.modelHint,
		category: body.category ?? "custom",
		isGlobal: body.isGlobal ?? false,
		maxTokenBudget: body.maxTokenBudget ?? 5000,
	});
	return c.json(skill, 201);
});

skillRoutes.put("/skills/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json();
	log.info({ id }, "updating skill");
	const updated = await updateSkill(id, body);
	if (!updated) return c.json({ error: "Skill not found" }, 404);
	return c.json(updated);
});

skillRoutes.delete("/skills/:id", async (c) => {
	const id = c.req.param("id");
	log.info({ id }, "deleting skill");
	await deleteSkill(id);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Agent skill assignments
// ---------------------------------------------------------------------------

skillRoutes.get("/agents/:agentId/skills", async (c) => {
	const agentId = c.req.param("agentId");
	log.info({ agentId }, "fetching agent skills");
	const skills = await getAgentSkills(agentId);
	return c.json(skills);
});

skillRoutes.post("/agents/:agentId/skills", async (c) => {
	const agentId = c.req.param("agentId");
	const { skillId, priority } = await c.req.json();
	if (!skillId) return c.json({ error: "skillId required" }, 400);
	log.info({ agentId, skillId, priority }, "assigning skill to agent");
	await assignSkillToAgent(agentId, skillId, priority ?? 0);
	return c.json({ ok: true });
});

skillRoutes.delete("/agents/:agentId/skills/:skillId", async (c) => {
	const agentId = c.req.param("agentId");
	const skillId = c.req.param("skillId");
	log.info({ agentId, skillId }, "removing skill from agent");
	await removeSkillFromAgent(agentId, skillId);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Project skill assignments
// ---------------------------------------------------------------------------

skillRoutes.get("/projects/:projectId/skills", async (c) => {
	const projectId = c.req.param("projectId");
	log.info({ projectId }, "fetching project skills");
	const skills = await getProjectSkills(projectId);
	return c.json(skills);
});

skillRoutes.post("/projects/:projectId/skills", async (c) => {
	const projectId = c.req.param("projectId");
	const { skillId } = await c.req.json();
	if (!skillId) return c.json({ error: "skillId required" }, 400);
	log.info({ projectId, skillId }, "assigning skill to project");
	await assignSkillToProject(projectId, skillId);
	return c.json({ ok: true });
});

skillRoutes.delete("/projects/:projectId/skills/:skillId", async (c) => {
	const projectId = c.req.param("projectId");
	const skillId = c.req.param("skillId");
	log.info({ projectId, skillId }, "removing skill from project");
	await removeSkillFromProject(projectId, skillId);
	return c.json({ ok: true });
});

export { skillRoutes };
