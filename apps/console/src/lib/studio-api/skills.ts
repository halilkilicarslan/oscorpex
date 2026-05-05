// ---------------------------------------------------------------------------
// Oscorpex — Agent Skills API
// ---------------------------------------------------------------------------

import { API, studioFetch } from "./base.js";

export interface Skill {
	id: string;
	name: string;
	description: string;
	contentMd: string;
	triggers: string[];
	applicableRoles: string[];
	providerHint?: string;
	modelHint?: string;
	category: string;
	isGlobal: boolean;
	maxTokenBudget: number;
	createdAt: string;
	updatedAt: string;
}

export interface SkillFilters {
	category?: string;
	global?: boolean;
	role?: string;
}

export async function fetchSkills(params?: SkillFilters): Promise<Skill[]> {
	const query = new URLSearchParams();
	if (params?.category) query.set("category", params.category);
	if (params?.global !== undefined) query.set("global", String(params.global));
	if (params?.role) query.set("role", params.role);
	const qs = query.toString();
	return studioFetch<Skill[]>(`${API}/skills${qs ? `?${qs}` : ""}`);
}

export async function fetchSkill(id: string): Promise<Skill> {
	return studioFetch<Skill>(`${API}/skills/${id}`);
}

export async function createSkill(data: Partial<Skill>): Promise<Skill> {
	return studioFetch<Skill>(`${API}/skills`, {
		method: "POST",
		body: JSON.stringify(data),
	});
}

export async function updateSkill(id: string, data: Partial<Skill>): Promise<Skill> {
	return studioFetch<Skill>(`${API}/skills/${id}`, {
		method: "PUT",
		body: JSON.stringify(data),
	});
}

export async function deleteSkill(id: string): Promise<void> {
	await studioFetch<void>(`${API}/skills/${id}`, { method: "DELETE" });
}

// Legacy agent-skill assignment helpers (kept for backward compat)
export async function fetchAgentSkills(agentId: string): Promise<Skill[]> {
	return studioFetch<Skill[]>(`${API}/agents/${agentId}/skills`);
}

export async function assignSkillToAgent(agentId: string, skillId: string, priority = 0): Promise<void> {
	await studioFetch<void>(`${API}/agents/${agentId}/skills`, {
		method: "POST",
		body: JSON.stringify({ skillId, priority }),
	});
}

export async function removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
	await studioFetch<void>(`${API}/agents/${agentId}/skills/${skillId}`, { method: "DELETE" });
}
