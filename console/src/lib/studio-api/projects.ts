import type { Project, ProjectTemplateInfo } from './types.js';
import { API, json } from './base.js';

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

export async function fetchProjects(): Promise<Project[]> {
  return json(`${API}/projects`);
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
  teamTemplateId?: string;
  plannerAgentId?: string;
  previewEnabled?: boolean;
}): Promise<Project> {
  return json(`${API}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateProject(id: string, data: Partial<Project>): Promise<Project> {
  return json(`${API}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`${API}/projects/${id}`, { method: 'DELETE' });
}

/**
 * Proje için README.md oluşturur ve git repo'ya yazar.
 * Backend template-based generation kullanır; AI çağrısı yapılmaz.
 */
export async function generateReadme(projectId: string): Promise<{ success: boolean; logs: string[] }> {
  return json(
    `${API}/projects/${projectId}/generate-readme`,
    { method: 'POST' },
  );
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
  return json(`${API}/projects/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
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
  return json(`${API}/projects/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
