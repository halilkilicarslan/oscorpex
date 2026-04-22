import type { Task } from './types.js';
import { API, json, fetchPaginated, type PaginatedResult } from './base.js';

export async function fetchTasks(projectId: string): Promise<Task[]> {
	return json(`${API}/projects/${projectId}/tasks`);
}

export async function fetchTasksPaginated(projectId: string, limit = 50, offset = 0): Promise<PaginatedResult<Task>> {
	return fetchPaginated<Task>(`${API}/projects/${projectId}/tasks`, limit, offset);
}

export async function retryTask(projectId: string, taskId: string): Promise<void> {
  await json(`${API}/projects/${projectId}/tasks/${taskId}/retry`, { method: 'POST' });
}

export async function submitReview(
  projectId: string,
  taskId: string,
  approved: boolean,
  feedback?: string,
): Promise<void> {
  await json(
    `${API}/projects/${projectId}/tasks/${taskId}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, feedback }),
    },
  );
}

export async function restartRevision(projectId: string, taskId: string): Promise<void> {
  await json(
    `${API}/projects/${projectId}/tasks/${taskId}/restart-revision`,
    { method: 'POST' },
  );
}

/**
 * Waiting approval durumundaki bir task'ı onaylar.
 * Onaylanan task execution engine tarafından çalıştırılır.
 */
export async function approveTask(projectId: string, taskId: string): Promise<Task> {
  const result = await json<{ success: boolean; task: Task }>(
    `${API}/projects/${projectId}/tasks/${taskId}/approve`,
    { method: 'POST' },
  );
  return result.task;
}

/**
 * Waiting approval durumundaki bir task'ı reddeder.
 * Reddedilen task failed durumuna alınır.
 */
export async function rejectTask(
  projectId: string,
  taskId: string,
  reason?: string,
): Promise<Task> {
  const result = await json<{ success: boolean; task: Task }>(
    `${API}/projects/${projectId}/tasks/${taskId}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
  return result.task;
}

/**
 * Proje için bekleyen onay listesini getirir.
 */
export async function fetchPendingApprovals(projectId: string): Promise<Task[]> {
  return json(`${API}/projects/${projectId}/approvals`);
}

// --- Sub-tasks (v3.0) ---
export async function fetchSubTasks(projectId: string, taskId: string): Promise<Task[]> {
  return json(`${API}/projects/${projectId}/tasks/${taskId}/subtasks`);
}

// --- Task Diffs (v4.1) ---
export interface TaskDiff {
  id: string;
  taskId: string;
  filePath: string;
  diffContent: string;
  diffType: 'created' | 'modified' | 'deleted';
  linesAdded: number;
  linesRemoved: number;
  createdAt: string;
}

export interface TaskDiffSummary {
  totalFiles: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface TaskDiffsResponse {
  taskId: string;
  summary: TaskDiffSummary;
  diffs: TaskDiff[];
}

export async function fetchTaskDiffs(projectId: string, taskId: string): Promise<TaskDiffsResponse> {
  return json(`${API}/projects/${projectId}/tasks/${taskId}/diffs`);
}
