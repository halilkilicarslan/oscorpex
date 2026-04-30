import type { Project, ProjectTemplateInfo } from './types.js';
import { API, json, fetchPaginated, httpDelete, httpPost, httpPatch, type PaginatedResult } from './base.js';

export interface PlatformStats {
  projects: { total: number; active: number; completed: number; failed: number };
  tasks: { total: number; done: number; running: number; failed: number; queued: number };
  cost: {
    totalUsd: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    cacheRate: number;
    activeAgents: number;
  };
  recentProjects: {
    id: string;
    name: string;
    status: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  }[];
  recentTasks: {
    id: string;
    title: string;
    status: string;
    assignedAgent: string;
    complexity: string;
    completedAt: string;
    projectName: string;
  }[];
}

export async function fetchPlatformStats(): Promise<PlatformStats> {
  return json(`${API}/platform/stats`);
}

export interface PlatformAnalytics {
  totals: {
    totalProjects: number; totalTasks: number; tasksDone: number; tasksFailed: number;
    taskDoneRate: number; failureRate: number; uniqueAgents: number; avgTaskMin: number;
    totalCostUsd: number; cacheRate: number; totalEvents: number; totalErrors: number;
    errorRate: number; activeDays: number;
  };
  agentUsage: { agent: string; role: string; count: number }[];
  dailyActivity: { date: string; events: number; errors: number; completions: number }[];
  hourlyPattern: { hour: number; count: number }[];
  projectActivity: { projectName: string; projectId: string; status: string; events: number; activeDays: number }[];
  fileActivity: { file: string; count: number }[];
  complexityDistribution: { complexity: string; count: number }[];
  eventTypes: { type: string; count: number }[];
  errorRates: { projectName: string; projectId: string; errors: number; total: number; errorRate: number }[];
  costByModel: { model: string; calls: number; cost: number; tokens: number }[];
}

export async function fetchPlatformAnalytics(): Promise<PlatformAnalytics> {
  return json(`${API}/platform/analytics`);
}

export async function fetchProjects(): Promise<Project[]> {
  return json(`${API}/projects`);
}

export async function fetchProjectsPaginated(limit = 50, offset = 0): Promise<PaginatedResult<Project>> {
	return fetchPaginated<Project>(`${API}/projects`, limit, offset);
}

export async function fetchProject(id: string): Promise<Project> {
  return json(`${API}/projects/${id}`);
}

export async function createProject(data: {
  name: string;
  description?: string;
  techStack?: string[];
  techPreference?: string[];
  projectType?: string;
  plannerAgentId?: string;
  previewEnabled?: boolean;
}): Promise<Project> {
  return httpPost<Project>(`${API}/projects`, data);
}

export interface ProjectScopeContract {
	problemStatement: string;
	goals: string[];
	nonGoals: string[];
	constraints: string[];
	risks: string[];
	acceptanceCriteria: string[];
	validationPlan: string[];
	requiredCapabilities: string[];
	recommendedTeamRoles: string[];
	status: 'draft' | 'ready_for_review' | 'approved' | 'superseded';
	approvedAt?: string;
	approvedBy?: string;
}

export interface TeamRecommendationResponse {
	decision: 'recommend-existing' | 'recommend-custom' | 'need-more-info';
	teamTemplateId?: string;
	templateSource?: 'preset' | 'custom';
	templateName?: string;
	reasoning?: string;
	matchedRoles?: string[];
	requiredCapabilities?: string[];
	recommendedTeamRoles?: string[];
}

export async function getProjectScope(projectId: string): Promise<ProjectScopeContract | null> {
	const res = await json<{ ok: boolean; data: ProjectScopeContract | null }>(`${API}/projects/${projectId}/scope`);
	return res.data;
}

export async function saveProjectScopeDraft(
	projectId: string,
	payload: Partial<ProjectScopeContract>,
): Promise<ProjectScopeContract | null> {
	const res = await httpPost<{ ok: boolean; data: ProjectScopeContract | null }>(
		`${API}/projects/${projectId}/scope/draft`,
		payload,
	);
	return res.data;
}

export async function approveProjectScope(projectId: string): Promise<ProjectScopeContract | null> {
	const res = await httpPost<{ ok: boolean; data: ProjectScopeContract | null }>(
		`${API}/projects/${projectId}/scope/approve`,
		{},
	);
	return res.data;
}

export async function recommendProjectTeam(projectId: string): Promise<TeamRecommendationResponse> {
	const res = await httpPost<{ ok: boolean; data: TeamRecommendationResponse }>(
		`${API}/projects/${projectId}/team/recommend`,
		{},
	);
	return res.data;
}

export async function applyProjectTeam(
	projectId: string,
	payload: {
		teamTemplateId?: string;
		customTeam?: { name: string; description: string; roles: string[] };
		plannerAgentId?: string;
	},
): Promise<{ ok: boolean; data: unknown[] }> {
	return httpPost<{ ok: boolean; data: unknown[] }>(`${API}/projects/${projectId}/team/apply`, payload);
}

export async function updateProject(id: string, data: Partial<Project>): Promise<Project> {
  return httpPatch<Project>(`${API}/projects/${id}`, data);
}

export async function deleteProject(id: string): Promise<void> {
  await httpDelete<void>(`${API}/projects/${id}`);
}

/**
 * Proje için README.md oluşturur ve git repo'ya yazar.
 * Backend template-based generation kullanır; AI çağrısı yapılmaz.
 */
export async function generateReadme(projectId: string): Promise<{ success: boolean; logs: string[] }> {
  return httpPost<{ success: boolean; logs: string[] }>(`${API}/projects/${projectId}/generate-readme`);
}

export async function fetchProjectTemplates(): Promise<ProjectTemplateInfo[]> {
  return json(`${API}/project-templates`);
}

export async function createProjectFromTemplate(data: {
  name: string;
  templateId: string;
  description?: string;
  plannerAgentId?: string;
  previewEnabled?: boolean;
}): Promise<Project & { filesCreated?: string[] }> {
  return httpPost<Project & { filesCreated?: string[] }>(`${API}/projects/from-template`, data);
}

export async function importProject(data: {
  name: string;
  repoPath: string;
  description?: string;
  techStack?: string[];
  teamTemplateId?: string;
  plannerAgentId?: string;
  previewEnabled?: boolean;
}): Promise<Project> {
  return httpPost<Project>(`${API}/projects/import`, data);
}
