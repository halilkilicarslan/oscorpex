import type {
  ProjectAnalytics,
  AgentAnalytics,
  ActivityTimeline,
  ProjectCostSummary,
  CostBreakdownEntry,
} from './types.js';
import { API, json } from './base.js';

export async function fetchProjectAnalytics(projectId: string): Promise<ProjectAnalytics> {
  return json(`${API}/projects/${projectId}/analytics/overview`);
}

export async function fetchAgentAnalytics(projectId: string): Promise<AgentAnalytics[]> {
  return json(`${API}/projects/${projectId}/analytics/agents`);
}

export async function fetchActivityTimeline(projectId: string, days = 7): Promise<ActivityTimeline[]> {
  return json(`${API}/projects/${projectId}/analytics/timeline?days=${days}`);
}

export async function fetchProjectCosts(projectId: string): Promise<ProjectCostSummary> {
  return json(`${API}/projects/${projectId}/costs`);
}

export async function fetchCostBreakdown(projectId: string): Promise<CostBreakdownEntry[]> {
  return json(`${API}/projects/${projectId}/costs/breakdown`);
}
