// ---------------------------------------------------------------------------
// Oscorpex — Skill Routes
// CRUD for skills + agent/project skill assignments.
// ---------------------------------------------------------------------------

import { type Context, Hono } from "hono";
import { callerTenantId, callerUserId, isPlatformAdminRequest } from "../auth/request-identity.js";
import {
	assignSkillToAgent,
	assignSkillToProject,
	createSkill,
	deleteSkill,
	getAgentSkills,
	getProjectSkills,
	getSkill,
	isAgentInTenant,
	isProjectInTenant,
	isSkillVisible,
	listSkills,
	removeSkillFromAgent,
	removeSkillFromProject,
	updateSkill,
} from "../db.js";
import { createLogger } from "../logger.js";
import { CreateSkillSchema, UpdateSkillSchema, parseBody } from "./validation-schemas.js";

const log = createLogger("skill-routes");
const skillRoutes = new Hono();

const isAdmin = isPlatformAdminRequest;
const callerId = callerUserId;

/** The agent must belong to a project of the caller's tenant; otherwise it is indistinguishable from a missing agent. */
async function agentVisible(c: Context, agentId: string): Promise<boolean> {
	const tenantId = callerTenantId(c);
	return tenantId ? isAgentInTenant(agentId, tenantId) : false;
}

/** The project must belong to the caller's tenant; otherwise it is indistinguishable from a missing project. */
async function projectVisible(c: Context, projectId: string): Promise<boolean> {
	const tenantId = callerTenantId(c);
	return tenantId ? isProjectInTenant(projectId, tenantId) : false;
}

/** Skills visible to the caller: global, owned (tenant + creator), and legacy tenant-less rows for platform admins. */
function skillVisible(c: Context, skill: { isGlobal: boolean; createdBy?: string; tenantId?: string }): boolean {
	return isSkillVisible(skill, { tenantId: callerTenantId(c), userId: callerId(c), isPlatformAdmin: isAdmin(c) });
}

// ---------------------------------------------------------------------------
// Skills CRUD
// ---------------------------------------------------------------------------

skillRoutes.get("/skills", async (c) => {
	const category = c.req.query("category");
	const isGlobal = c.req.query("global") === "true" ? true : undefined;
	const role = c.req.query("role");
	log.info({ category, isGlobal, role }, "listing skills");
	const skills = await listSkills({ category, isGlobal, role });
	return c.json(skills.filter((s) => skillVisible(c, s)));
});

skillRoutes.get("/skills/:id", async (c) => {
	const id = c.req.param("id");
	log.info({ id }, "fetching skill");
	const skill = await getSkill(id);
	if (!skill || !skillVisible(c, skill)) return c.json({ error: "Skill not found" }, 404);
	return c.json(skill);
});

skillRoutes.post("/skills", async (c) => {
	const rawBody = await c.req.json();
	const parsed = parseBody(CreateSkillSchema, rawBody);
	if (!parsed.success) return c.json({ error: parsed.error }, 400);
	const body = parsed.data;
	if (body.isGlobal === true && !isAdmin(c))
		return c.json({ error: "Only platform admins can create global skills" }, 403);
	log.info({ name: body.name }, "creating skill");
	const skill = await createSkill({
		name: body.name.trim(),
		description: "",
		contentMd: body.contentMd ?? "",
		triggers: body.triggers ?? [],
		applicableRoles: body.applicableRoles ?? [],
		providerHint: body.providerHint,
		modelHint: body.modelHint,
		category: body.category ?? "custom",
		isGlobal: body.isGlobal ?? false,
		maxTokenBudget: body.maxTokenBudget ?? 5000,
		createdBy: callerId(c),
	});
	return c.json(skill, 201);
});

skillRoutes.put("/skills/:id", async (c) => {
	const id = c.req.param("id");
	const rawBody = await c.req.json();
	const parsed = parseBody(UpdateSkillSchema, rawBody);
	if (!parsed.success) return c.json({ error: parsed.error }, 400);
	const existing = await getSkill(id);
	if (!existing) return c.json({ error: "Skill not found" }, 404);
	if (!isAdmin(c)) {
		// Global skills are platform data; personal skills belong to their creator
		if (existing.isGlobal) return c.json({ error: "Only platform admins can modify global skills" }, 403);
		if (!skillVisible(c, existing)) return c.json({ error: "Skill not found" }, 404);
		if (parsed.data.isGlobal === true) return c.json({ error: "Only platform admins can make a skill global" }, 403);
	}
	log.info({ id }, "updating skill");
	const updated = await updateSkill(id, parsed.data);
	if (!updated) return c.json({ error: "Skill not found" }, 404);
	return c.json(updated);
});

skillRoutes.delete("/skills/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await getSkill(id);
	if (!existing) return c.json({ error: "Skill not found" }, 404);
	if (!isAdmin(c)) {
		if (existing.isGlobal) return c.json({ error: "Only platform admins can delete global skills" }, 403);
		if (!skillVisible(c, existing)) return c.json({ error: "Skill not found" }, 404);
	}
	log.info({ id }, "deleting skill");
	await deleteSkill(id);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Agent skill assignments
// ---------------------------------------------------------------------------

skillRoutes.get("/agents/:agentId/skills", async (c) => {
	const agentId = c.req.param("agentId");
	if (!(await agentVisible(c, agentId))) return c.json({ error: "Agent not found" }, 404);
	log.info({ agentId }, "fetching agent skills");
	const skills = await getAgentSkills(agentId);
	return c.json(skills.filter((s) => skillVisible(c, s)));
});

skillRoutes.post("/agents/:agentId/skills", async (c) => {
	const agentId = c.req.param("agentId");
	const { skillId, priority } = await c.req.json();
	if (!skillId) return c.json({ error: "skillId required" }, 400);
	if (!(await agentVisible(c, agentId))) return c.json({ error: "Agent not found" }, 404);
	const skill = await getSkill(String(skillId));
	if (!skill || !skillVisible(c, skill)) return c.json({ error: "Skill not found" }, 404);
	log.info({ agentId, skillId, priority }, "assigning skill to agent");
	await assignSkillToAgent(agentId, skillId, priority ?? 0);
	return c.json({ ok: true });
});

skillRoutes.delete("/agents/:agentId/skills/:skillId", async (c) => {
	const agentId = c.req.param("agentId");
	const skillId = c.req.param("skillId");
	if (!(await agentVisible(c, agentId))) return c.json({ error: "Agent not found" }, 404);
	const skill = await getSkill(skillId);
	if (!skill || !skillVisible(c, skill)) return c.json({ error: "Skill not found" }, 404);
	log.info({ agentId, skillId }, "removing skill from agent");
	await removeSkillFromAgent(agentId, skillId);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Project skill assignments
// ---------------------------------------------------------------------------

skillRoutes.get("/projects/:projectId/skills", async (c) => {
	const projectId = c.req.param("projectId");
	if (!(await projectVisible(c, projectId))) return c.json({ error: "Project not found" }, 404);
	log.info({ projectId }, "fetching project skills");
	const skills = await getProjectSkills(projectId);
	return c.json(skills.filter((s) => skillVisible(c, s)));
});

skillRoutes.post("/projects/:projectId/skills", async (c) => {
	const projectId = c.req.param("projectId");
	const { skillId } = await c.req.json();
	if (!skillId) return c.json({ error: "skillId required" }, 400);
	if (!(await projectVisible(c, projectId))) return c.json({ error: "Project not found" }, 404);
	const skill = await getSkill(String(skillId));
	if (!skill || !skillVisible(c, skill)) return c.json({ error: "Skill not found" }, 404);
	log.info({ projectId, skillId }, "assigning skill to project");
	await assignSkillToProject(projectId, skillId);
	return c.json({ ok: true });
});

skillRoutes.delete("/projects/:projectId/skills/:skillId", async (c) => {
	const projectId = c.req.param("projectId");
	const skillId = c.req.param("skillId");
	if (!(await projectVisible(c, projectId))) return c.json({ error: "Project not found" }, 404);
	const skill = await getSkill(skillId);
	if (!skill || !skillVisible(c, skill)) return c.json({ error: "Skill not found" }, 404);
	log.info({ projectId, skillId }, "removing skill from project");
	await removeSkillFromProject(projectId, skillId);
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

// Auto-detect skills for a project and assign them
skillRoutes.post("/projects/:projectId/skills/auto-detect", async (c) => {
	const projectId = c.req.param("projectId");
	const { getProject, listProjectAgents } = await import("../db.js");
	const { autoAssignDetectedSkills } = await import("../skill-auto-detector.js");

	if (!(await projectVisible(c, projectId))) return c.json({ error: "Project not found" }, 404);
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const agents = await listProjectAgents(projectId);
	const body = (await c.req.json().catch(() => ({}))) as { minConfidence?: number };
	const minConfidence = body.minConfidence ?? 0.5;

	log.info({ projectId, minConfidence }, "auto-detecting skills for project");
	const result = await autoAssignDetectedSkills(project, agents, minConfidence, (sk) => skillVisible(c, sk));

	return c.json({
		assigned: result.assigned,
		suggestions: result.suggestions.map((s) => ({
			skillId: s.skill.id,
			skillName: s.skill.name,
			agentId: s.agent.id,
			agentName: s.agent.name,
			agentRole: s.agent.role,
			confidence: s.confidence,
			reason: s.reason,
		})),
	});
});

// Get skill suggestions without assigning
skillRoutes.get("/projects/:projectId/skills/suggestions", async (c) => {
	const projectId = c.req.param("projectId");
	const { getProject, listProjectAgents } = await import("../db.js");
	const { detectSkillsForProject } = await import("../skill-auto-detector.js");

	if (!(await projectVisible(c, projectId))) return c.json({ error: "Project not found" }, 404);
	const project = await getProject(projectId);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const agents = await listProjectAgents(projectId);

	log.info({ projectId }, "fetching skill suggestions for project");
	const suggestions = await detectSkillsForProject(project, agents, (sk) => skillVisible(c, sk));

	return c.json(
		suggestions.map((s) => ({
			skillId: s.skill.id,
			skillName: s.skill.name,
			agentId: s.agent.id,
			agentName: s.agent.name,
			agentRole: s.agent.role,
			confidence: s.confidence,
			reason: s.reason,
		})),
	);
});

export { skillRoutes };
