import type { ProjectPlan, ApproveResult, AutoStartStatus, PlanCostEstimate, Progress } from './types.js';
import { API, json, httpGet, StudioApiError } from './base.js';

export async function fetchPlan(projectId: string): Promise<ProjectPlan | null> {
  try {
    return await httpGet<ProjectPlan>(`${API}/projects/${projectId}/plan`);
  } catch (err) {
    if (err instanceof StudioApiError && err.status === 404) return null;
    throw err;
  }
}

export async function approvePlan(projectId: string): Promise<ApproveResult> {
  return json(`${API}/projects/${projectId}/plan/approve`, { method: 'POST' });
}

export async function fetchAutoStartStatus(projectId: string): Promise<AutoStartStatus> {
  return json(`${API}/projects/${projectId}/pipeline/auto-start-status`);
}

/**
 * Bir plan için tahmini maliyet bilgisini backend'den çeker.
 * Plan onay butonunun yanında badge olarak gösterilir.
 */
export async function fetchPlanCostEstimate(projectId: string, planId: string): Promise<PlanCostEstimate> {
  return json(`${API}/projects/${projectId}/plans/${planId}/cost-estimate`);
}

export async function rejectPlan(projectId: string, feedback?: string): Promise<void> {
  await json(`${API}/projects/${projectId}/plan/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
}

export async function executeProject(projectId: string): Promise<{ readyTasks: { id: string; title: string }[] }> {
  return json(`${API}/projects/${projectId}/execute`, { method: 'POST' });
}

export async function fetchProgress(projectId: string): Promise<Progress> {
  return json(`${API}/projects/${projectId}/progress`);
}
