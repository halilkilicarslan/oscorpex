import type {
  AgentConfig,
  TeamTemplate,
  CustomTeamTemplate,
  ProjectAgent,
  ProjectAgentCreateInput,
  AgentDependency,
  DependencyType,
  AvatarOption,
  Gender,
  OrgNode,
  PipelineAgent,
} from './types.js';
import { API, json, httpDelete } from './base.js';

export async function fetchAgentConfigs(): Promise<AgentConfig[]> {
  return json(`${API}/agents`);
}

export async function fetchPresetAgents(): Promise<AgentConfig[]> {
  return json(`${API}/agents/presets`);
}

export async function fetchAgent(id: string): Promise<AgentConfig> {
  return json(`${API}/agents/${id}`);
}

export async function createAgent(data: Omit<AgentConfig, 'id' | 'isPreset'>): Promise<AgentConfig> {
  return json(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateAgent(id: string, data: Partial<AgentConfig>): Promise<AgentConfig> {
  return json(`${API}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await httpDelete<void>(`${API}/agents/${id}`);
}

export async function fetchTeamTemplates(): Promise<TeamTemplate[]> {
  return json(`${API}/team-templates`);
}

export async function fetchCustomTeams(): Promise<CustomTeamTemplate[]> {
  return json(`${API}/custom-teams`);
}

export async function createCustomTeam(data: { name: string; description?: string; roles: string[]; dependencies: { from: string; to: string; type: DependencyType }[] }): Promise<CustomTeamTemplate> {
  return json(`${API}/custom-teams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

export async function updateCustomTeam(id: string, data: Partial<{ name: string; description: string; roles: string[]; dependencies: { from: string; to: string; type: DependencyType }[] }>): Promise<CustomTeamTemplate> {
  return json(`${API}/custom-teams/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

export async function deleteCustomTeam(id: string): Promise<void> {
  await httpDelete<void>(`${API}/custom-teams/${id}`);
}

export async function fetchProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  return json(`${API}/projects/${projectId}/team`);
}

export async function fetchProjectDependencies(projectId: string): Promise<AgentDependency[]> {
  return json(`${API}/projects/${projectId}/dependencies`);
}

export async function fetchAvatars(gender?: Gender): Promise<AvatarOption[]> {
  const query = gender ? `?gender=${gender}` : '';
  return json(`${API}/avatars${query}`);
}

export async function fetchProjectAgent(projectId: string, agentId: string): Promise<ProjectAgent> {
  return json(`${API}/projects/${projectId}/team/${agentId}`);
}

export async function addProjectAgent(
  projectId: string,
  data: ProjectAgentCreateInput,
): Promise<ProjectAgent> {
  return json(`${API}/projects/${projectId}/team`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateProjectAgent(
  projectId: string,
  agentId: string,
  data: Partial<ProjectAgent>,
): Promise<ProjectAgent> {
  return json(`${API}/projects/${projectId}/team/${agentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteProjectAgent(projectId: string, agentId: string): Promise<void> {
  await httpDelete<void>(`${API}/projects/${projectId}/team/${agentId}`);
}

export async function fetchOrgStructure(projectId: string): Promise<{ tree: OrgNode[]; pipeline: PipelineAgent[] }> {
  return json(`${API}/projects/${projectId}/team/org`);
}

export async function updateAgentHierarchy(
  projectId: string,
  agentId: string,
  data: { reportsTo: string | null; pipelineOrder?: number },
): Promise<ProjectAgent> {
  return json(`${API}/projects/${projectId}/team/${agentId}/hierarchy`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function copyTeamFromTemplate(projectId: string, templateId: string): Promise<ProjectAgent[]> {
  return json(`${API}/projects/${projectId}/team/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  });
}

export async function fetchDependencies(projectId: string): Promise<AgentDependency[]> {
  return json(`${API}/projects/${projectId}/dependencies`);
}

export async function saveDependencies(
  projectId: string,
  deps: { fromAgentId: string; toAgentId: string; type: DependencyType }[],
): Promise<AgentDependency[]> {
  return json(`${API}/projects/${projectId}/dependencies`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deps),
  });
}
