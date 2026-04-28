import type {
	WorkItem,
	Sprint,
	StandupReport,
	RetrospectiveReport,
	ProjectReport,
	LifecycleInfo,
} from './types.js';
import { API, json, fetchPaginated, httpDelete, httpPatch, httpPost, type PaginatedResult } from './base.js';

// --- Work Items (v3.2) ---
export async function fetchWorkItems(projectId: string, filters?: Record<string, string>): Promise<WorkItem[]> {
	const params = new URLSearchParams(filters);
	return json(`${API}/projects/${projectId}/work-items?${params}`);
}

export async function fetchWorkItemsPaginated(projectId: string, limit = 50, offset = 0): Promise<PaginatedResult<WorkItem>> {
	return fetchPaginated<WorkItem>(`${API}/projects/${projectId}/work-items`, limit, offset);
}

export async function createWorkItem(projectId: string, data: Partial<WorkItem>): Promise<WorkItem> {
  return httpPost<WorkItem>(`${API}/projects/${projectId}/work-items`, data);
}

export async function updateWorkItem(projectId: string, itemId: string, data: Partial<WorkItem>): Promise<WorkItem> {
  return httpPatch<WorkItem>(`${API}/projects/${projectId}/work-items/${itemId}`, data);
}

export async function deleteWorkItem(projectId: string, itemId: string): Promise<void> {
  await httpDelete<void>(`${API}/projects/${projectId}/work-items/${itemId}`);
}

export async function convertWorkItemToPlan(projectId: string, itemId: string): Promise<unknown> {
  return json(`${API}/projects/${projectId}/work-items/${itemId}/plan`, { method: 'POST' });
}

// --- Sprints (v3.9) ---
export async function fetchSprints(projectId: string): Promise<Sprint[]> {
  return json(`${API}/projects/${projectId}/sprints`);
}

export async function createSprint(projectId: string, data: { name: string; goal?: string; startDate: string; endDate: string }): Promise<Sprint> {
  return httpPost<Sprint>(`${API}/projects/${projectId}/sprints`, data);
}

// --- Ceremonies (v3.6) ---
export async function runStandup(projectId: string): Promise<StandupReport[]> {
  return json(`${API}/projects/${projectId}/ceremonies/standup`, { method: 'POST' });
}

export async function runRetrospective(projectId: string): Promise<RetrospectiveReport> {
  return json(`${API}/projects/${projectId}/ceremonies/retro`, { method: 'POST' });
}

// --- Agent Chat (v3.8) ---
export async function chatWithAgent(projectId: string, agentId: string, message: string): Promise<{ response: string }> {
  return json(`${API}/projects/${projectId}/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

// --- Reports (v3.5) ---
export async function fetchProjectReport(projectId: string): Promise<ProjectReport> {
  return json(`${API}/projects/${projectId}/report`);
}

// --- Lifecycle (v3.5) ---
export async function fetchLifecycle(projectId: string): Promise<LifecycleInfo> {
  return json(`${API}/projects/${projectId}/lifecycle`);
}

export async function transitionProjectStatus(projectId: string, to: string): Promise<{ projectId: string; status: string }> {
  return json(`${API}/projects/${projectId}/lifecycle/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  });
}

export async function createHotfix(projectId: string, description: string): Promise<{ projectId: string; taskId: string }> {
  return json(`${API}/projects/${projectId}/hotfix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}
