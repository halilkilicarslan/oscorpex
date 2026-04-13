// ---------------------------------------------------------------------------
// Oscorpex — Agent Repository: Agent Config + Project Agent CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { AgentConfig, DependencyType, ProjectAgent } from "../types.js";
import { bulkCreateDependencies } from "./dependency-repo.js";
import { now, rowToAgentConfig, rowToProjectAgent } from "./helpers.js";

// ---------------------------------------------------------------------------
// Agent Configs CRUD
// ---------------------------------------------------------------------------

export async function createAgentConfig(data: Omit<AgentConfig, "id">): Promise<AgentConfig> {
	const id = randomUUID();
	await execute(
		`
    INSERT INTO agent_configs (id, name, role, avatar, gender, personality, model, cli_tool, skills, system_prompt, is_preset)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `,
		[
			id,
			data.name,
			data.role,
			data.avatar,
			data.gender ?? "male",
			data.personality,
			data.model,
			data.cliTool,
			JSON.stringify(data.skills),
			data.systemPrompt,
			data.isPreset ? 1 : 0,
		],
	);
	return { id, ...data };
}

export async function getAgentConfig(id: string): Promise<AgentConfig | undefined> {
	const row = await queryOne<any>("SELECT * FROM agent_configs WHERE id = $1", [id]);
	return row ? rowToAgentConfig(row) : undefined;
}

export async function listAgentConfigs(): Promise<AgentConfig[]> {
	const rows = await query<any>("SELECT * FROM agent_configs ORDER BY name");
	return rows.map(rowToAgentConfig);
}

export async function listPresetAgents(): Promise<AgentConfig[]> {
	const rows = await query<any>("SELECT * FROM agent_configs WHERE is_preset = 1 ORDER BY name");
	return rows.map(rowToAgentConfig);
}

export async function updateAgentConfig(
	id: string,
	data: Partial<Omit<AgentConfig, "id">>,
): Promise<AgentConfig | undefined> {
	const fields: string[] = [];
	const values: any[] = [];
	let idx = 1;

	if (data.name !== undefined) {
		fields.push(`name = $${idx++}`);
		values.push(data.name);
	}
	if (data.role !== undefined) {
		fields.push(`role = $${idx++}`);
		values.push(data.role);
	}
	if (data.avatar !== undefined) {
		fields.push(`avatar = $${idx++}`);
		values.push(data.avatar);
	}
	if (data.gender !== undefined) {
		fields.push(`gender = $${idx++}`);
		values.push(data.gender);
	}
	if (data.personality !== undefined) {
		fields.push(`personality = $${idx++}`);
		values.push(data.personality);
	}
	if (data.model !== undefined) {
		fields.push(`model = $${idx++}`);
		values.push(data.model);
	}
	if (data.cliTool !== undefined) {
		fields.push(`cli_tool = $${idx++}`);
		values.push(data.cliTool);
	}
	if (data.skills !== undefined) {
		fields.push(`skills = $${idx++}`);
		values.push(JSON.stringify(data.skills));
	}
	if (data.systemPrompt !== undefined) {
		fields.push(`system_prompt = $${idx++}`);
		values.push(data.systemPrompt);
	}
	if (data.isPreset !== undefined) {
		fields.push(`is_preset = $${idx++}`);
		values.push(data.isPreset ? 1 : 0);
	}

	if (fields.length === 0) return getAgentConfig(id);

	values.push(id);
	await execute(`UPDATE agent_configs SET ${fields.join(", ")} WHERE id = $${idx}`, values);
	return getAgentConfig(id);
}

export async function deleteAgentConfig(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM agent_configs WHERE id = $1 AND is_preset = 0", [id]);
	return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Project Agents CRUD
// ---------------------------------------------------------------------------

export async function createProjectAgent(data: {
	projectId: string;
	sourceAgentId?: string;
	name: string;
	role: string;
	avatar: string;
	gender?: "male" | "female";
	personality: string;
	model: string;
	cliTool: string;
	skills: string[];
	systemPrompt: string;
	reportsTo?: string;
	color?: string;
	pipelineOrder?: number;
}): Promise<ProjectAgent> {
	const id = randomUUID();
	const ts = now();
	await execute(
		`INSERT INTO project_agents
      (id, project_id, source_agent_id, name, role, avatar, gender, personality, model, cli_tool, skills, system_prompt, created_at, reports_to, color, pipeline_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		[
			id,
			data.projectId,
			data.sourceAgentId ?? null,
			data.name,
			data.role,
			data.avatar,
			data.gender ?? "male",
			data.personality,
			data.model,
			data.cliTool,
			JSON.stringify(data.skills),
			data.systemPrompt,
			ts,
			data.reportsTo ?? null,
			data.color ?? "#22c55e",
			data.pipelineOrder ?? 0,
		],
	);
	return (await getProjectAgent(id))!;
}

export async function getProjectAgent(id: string): Promise<ProjectAgent | undefined> {
	const row = await queryOne<any>("SELECT * FROM project_agents WHERE id = $1", [id]);
	return row ? rowToProjectAgent(row) : undefined;
}

export async function listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
	const rows = await query<any>("SELECT * FROM project_agents WHERE project_id = $1 ORDER BY created_at", [projectId]);
	return rows.map(rowToProjectAgent);
}

export async function updateProjectAgent(
	id: string,
	data: Partial<Omit<ProjectAgent, "id" | "projectId" | "createdAt">>,
): Promise<ProjectAgent | undefined> {
	const fields: string[] = [];
	const values: any[] = [];
	let idx = 1;

	if (data.name !== undefined) {
		fields.push(`name = $${idx++}`);
		values.push(data.name);
	}
	if (data.role !== undefined) {
		fields.push(`role = $${idx++}`);
		values.push(data.role);
	}
	if (data.avatar !== undefined) {
		fields.push(`avatar = $${idx++}`);
		values.push(data.avatar);
	}
	if (data.gender !== undefined) {
		fields.push(`gender = $${idx++}`);
		values.push(data.gender);
	}
	if (data.personality !== undefined) {
		fields.push(`personality = $${idx++}`);
		values.push(data.personality);
	}
	if (data.model !== undefined) {
		fields.push(`model = $${idx++}`);
		values.push(data.model);
	}
	if (data.cliTool !== undefined) {
		fields.push(`cli_tool = $${idx++}`);
		values.push(data.cliTool);
	}
	if (data.skills !== undefined) {
		fields.push(`skills = $${idx++}`);
		values.push(JSON.stringify(data.skills));
	}
	if (data.systemPrompt !== undefined) {
		fields.push(`system_prompt = $${idx++}`);
		values.push(data.systemPrompt);
	}
	if (data.sourceAgentId !== undefined) {
		fields.push(`source_agent_id = $${idx++}`);
		values.push(data.sourceAgentId);
	}
	if (data.reportsTo !== undefined) {
		fields.push(`reports_to = $${idx++}`);
		values.push(data.reportsTo || null);
	}
	if (data.color !== undefined) {
		fields.push(`color = $${idx++}`);
		values.push(data.color);
	}
	if (data.pipelineOrder !== undefined) {
		fields.push(`pipeline_order = $${idx++}`);
		values.push(data.pipelineOrder);
	}

	if (fields.length === 0) return getProjectAgent(id);

	values.push(id);
	await execute(`UPDATE project_agents SET ${fields.join(", ")} WHERE id = $${idx}`, values);
	return getProjectAgent(id);
}

export async function deleteProjectAgent(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM project_agents WHERE id = $1", [id]);
	return (result.rowCount ?? 0) > 0;
}

/**
 * Belirli bir beceriye sahip proje agentlarını döner (büyük/küçük harf duyarsız).
 */
export async function getProjectAgentsBySkill(projectId: string, skill: string): Promise<ProjectAgent[]> {
	const agents = await listProjectAgents(projectId);
	const lowerSkill = skill.toLowerCase();
	return agents.filter((a) => a.skills.some((s: string) => s.toLowerCase().includes(lowerSkill)));
}

/**
 * Bir projedeki tüm agentları beceri listesiyle birlikte döner.
 */
export async function getProjectAgentsWithSkills(projectId: string): Promise<
	Array<{
		id: string;
		name: string;
		role: string;
		skills: string[];
	}>
> {
	const rows = await query<any>(
		"SELECT id, name, role, skills FROM project_agents WHERE project_id = $1 ORDER BY pipeline_order, created_at",
		[projectId],
	);
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		role: row.role,
		skills: JSON.parse(row.skills ?? "[]"),
	}));
}

/**
 * Belirtilen rollere sahip preset agentları projeye kopyalar.
 */
export async function copyAgentsToProject(projectId: string, roles: string[]): Promise<ProjectAgent[]> {
	const presets = await listPresetAgents();
	const created: ProjectAgent[] = [];

	const colorMap: Record<string, string> = {
		// v2 roles
		"product-owner": "#f59e0b",
		"scrum-master": "#06b6d4",
		"tech-lead": "#3b82f6",
		"business-analyst": "#8b5cf6",
		"design-lead": "#f472b6",
		"frontend-dev": "#ec4899",
		"backend-dev": "#22c55e",
		"frontend-qa": "#a855f7",
		"backend-qa": "#a855f7",
		"frontend-reviewer": "#ef4444",
		"backend-reviewer": "#ef4444",
		devops: "#0ea5e9",
		// legacy
		pm: "#f59e0b",
		designer: "#f472b6",
		architect: "#3b82f6",
		frontend: "#ec4899",
		backend: "#22c55e",
		coder: "#06b6d4",
		qa: "#a855f7",
		reviewer: "#ef4444",
	};

	const pipelineMap: Record<string, number> = {
		// v2 roles — wave-based order
		"product-owner": 0,
		"scrum-master": 0,
		"tech-lead": 1,
		"business-analyst": 1,
		"design-lead": 1,
		"frontend-dev": 2,
		"backend-dev": 2,
		"frontend-qa": 3,
		"backend-qa": 3,
		"frontend-reviewer": 4,
		"backend-reviewer": 4,
		devops: 5,
		// legacy
		pm: 0,
		designer: 1,
		architect: 2,
		frontend: 3,
		backend: 3,
		coder: 3,
		qa: 4,
		reviewer: 5,
	};

	for (const role of roles) {
		const preset = presets.find((p) => p.role === role);
		if (preset) {
			const agent = await createProjectAgent({
				projectId,
				sourceAgentId: preset.id,
				name: preset.name,
				role: preset.role,
				avatar: preset.avatar,
				personality: preset.personality,
				model: preset.model,
				cliTool: preset.cliTool,
				skills: preset.skills,
				systemPrompt: preset.systemPrompt,
				color: colorMap[preset.role] || "#22c55e",
				pipelineOrder: pipelineMap[preset.role] ?? 2,
			});
			created.push(agent);
		}
	}

	// Set up hierarchy (v2 + legacy compat)
	const po = created.find((a) => a.role === "product-owner") ?? created.find((a) => a.role === "pm");
	const techLead = created.find((a) => a.role === "tech-lead") ?? created.find((a) => a.role === "architect");
	const devRoles = new Set(["frontend-dev", "backend-dev", "frontend", "backend", "coder"]);
	const qaRoles = new Set(["frontend-qa", "backend-qa", "qa"]);
	const reviewRoles = new Set(["frontend-reviewer", "backend-reviewer", "reviewer"]);

	if (po) {
		for (const agent of created) {
			if (agent.id === po.id) continue;
			if ((devRoles.has(agent.role) || qaRoles.has(agent.role) || reviewRoles.has(agent.role)) && techLead) {
				await updateProjectAgent(agent.id, { reportsTo: techLead.id });
				agent.reportsTo = techLead.id;
			} else {
				await updateProjectAgent(agent.id, { reportsTo: po.id });
				agent.reportsTo = po.id;
			}
		}
	}

	// v2: Seed default agent dependencies for the standard pipeline
	await seedDefaultDependencies(projectId, created);

	return created;
}

/**
 * Standart Scrum takımı için default dependency'leri oluşturur.
 */
async function seedDefaultDependencies(projectId: string, agents: ProjectAgent[]): Promise<void> {
	if (agents.length < 2) return;

	const deps: {
		fromAgentId: string;
		toAgentId: string;
		type: DependencyType;
	}[] = [];
	const added = new Set<string>();

	function addDep(fromId: string, toId: string, type: DependencyType) {
		const key = `${fromId}→${toId}:${type}`;
		if (fromId === toId || added.has(key)) return;
		added.add(key);
		deps.push({ fromAgentId: fromId, toAgentId: toId, type });
	}

	const classify = (role: string) => {
		const r = role.toLowerCase();
		if (r.includes("review")) return "reviewer";
		if (r.includes("owner") || r.includes("scrum") || r === "pm") return "pm";
		if (r.includes("lead") || r.includes("architect")) return "lead";
		if (r.includes("qa") || r.includes("test")) return "qa";
		if (r.includes("dev") || r.includes("coder") || r.includes("engineer")) return "dev";
		if (r.includes("devops") || r.includes("ops") || r.includes("infra")) return "devops";
		if (r.includes("design")) return "design";
		if (r.includes("analyst")) return "analyst";
		return "other";
	};

	const byCategory = new Map<string, ProjectAgent[]>();
	for (const a of agents) {
		const cat = classify(a.role);
		if (!byCategory.has(cat)) byCategory.set(cat, []);
		byCategory.get(cat)?.push(a);
	}

	const pms = byCategory.get("pm") ?? [];
	const leads = byCategory.get("lead") ?? [];
	const devs = byCategory.get("dev") ?? [];
	const qas = byCategory.get("qa") ?? [];
	const reviewers = byCategory.get("reviewer") ?? [];
	const devopsAgents = byCategory.get("devops") ?? [];
	const designers = byCategory.get("design") ?? [];
	const analysts = byCategory.get("analyst") ?? [];

	// Workflow: PM → leads/designers/analysts
	for (const pm of pms) {
		for (const lead of leads) addDep(pm.id, lead.id, "workflow");
		for (const d of designers) addDep(pm.id, d.id, "workflow");
		for (const a of analysts) addDep(pm.id, a.id, "workflow");
	}

	// Workflow: leads → devs
	for (const lead of leads) {
		for (const dev of devs) addDep(lead.id, dev.id, "workflow");
	}

	// Workflow: devs → QAs
	for (const dev of devs) {
		const prefix = dev.role.split("-")[0];
		const matchedQA = qas.find((q) => q.role.startsWith(prefix)) ?? qas[0];
		if (matchedQA) addDep(dev.id, matchedQA.id, "workflow");
	}

	// Workflow: QAs → reviewers
	for (const qa of qas) {
		const prefix = qa.role.split("-")[0];
		const matchedReviewer = reviewers.find((r) => r.role.startsWith(prefix)) ?? reviewers[0];
		if (matchedReviewer) addDep(qa.id, matchedReviewer.id, "workflow");
	}

	// Review: devs → matching reviewers
	for (const dev of devs) {
		const prefix = dev.role.split("-")[0];
		const matchedReviewer = reviewers.find((r) => r.role.startsWith(prefix)) ?? reviewers[0];
		if (matchedReviewer) addDep(dev.id, matchedReviewer.id, "review");
	}

	// Gate: reviewers → devops
	for (const reviewer of reviewers) {
		for (const dops of devopsAgents) addDep(reviewer.id, dops.id, "gate");
	}

	// Hierarchy: PM → leads, leads → devs, leads → devops
	for (const pm of pms) {
		for (const lead of leads) addDep(pm.id, lead.id, "hierarchy");
		for (const d of designers) addDep(pm.id, d.id, "hierarchy");
		for (const a of analysts) addDep(pm.id, a.id, "hierarchy");
	}
	for (const lead of leads) {
		for (const dev of devs) addDep(lead.id, dev.id, "hierarchy");
		for (const dops of devopsAgents) addDep(lead.id, dops.id, "hierarchy");
	}

	if (deps.length > 0) {
		await bulkCreateDependencies(projectId, deps);
	}
}
