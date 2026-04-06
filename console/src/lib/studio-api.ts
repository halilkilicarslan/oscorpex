// ---------------------------------------------------------------------------
// AI Dev Studio — Frontend API Client
// ---------------------------------------------------------------------------

const BASE = '/api/studio';

// ---- Types ----------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'planning' | 'approved' | 'running' | 'paused' | 'completed' | 'failed';
  techStack: string[];
  repoPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPlan {
  id: string;
  projectId: string;
  version: number;
  status: 'draft' | 'approved' | 'rejected';
  phases: Phase[];
  createdAt: string;
}

export interface Phase {
  id: string;
  planId: string;
  name: string;
  order: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  tasks: Task[];
  dependsOn: string[];
}

export interface Task {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  assignedAgent: string;
  status: 'queued' | 'assigned' | 'running' | 'review' | 'done' | 'failed';
  complexity: 'S' | 'M' | 'L';
  dependsOn: string[];
  branch: string;
  output?: {
    filesCreated: string[];
    filesModified: string[];
    testResults?: { passed: number; failed: number; total: number };
    logs: string[];
  };
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  avatar: string;
  personality: string;
  model: string;
  cliTool: string;
  skills: string[];
  systemPrompt: string;
  isPreset: boolean;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Progress {
  phases: { id: string; name: string; status: string; tasksDone: number; tasksTotal: number }[];
  overall: { total: number; done: number; running: number; failed: number; queued: number };
}

// ---- Helper ---------------------------------------------------------------

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- Projects -------------------------------------------------------------

export async function fetchProjects(): Promise<Project[]> {
  return json(await fetch(`${BASE}/projects`));
}

export async function fetchProject(id: string): Promise<Project> {
  return json(await fetch(`${BASE}/projects/${id}`));
}

export async function createProject(data: { name: string; description?: string; techStack?: string[] }): Promise<Project> {
  return json(await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function updateProject(id: string, data: Partial<Project>): Promise<Project> {
  return json(await fetch(`${BASE}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`${BASE}/projects/${id}`, { method: 'DELETE' });
}

// ---- Plans ----------------------------------------------------------------

export async function fetchPlan(projectId: string): Promise<ProjectPlan> {
  return json(await fetch(`${BASE}/projects/${projectId}/plan`));
}

export async function approvePlan(projectId: string): Promise<void> {
  await json(await fetch(`${BASE}/projects/${projectId}/plan/approve`, { method: 'POST' }));
}

export async function rejectPlan(projectId: string, feedback?: string): Promise<void> {
  await json(await fetch(`${BASE}/projects/${projectId}/plan/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  }));
}

// ---- Execution ------------------------------------------------------------

export async function executeProject(projectId: string): Promise<{ readyTasks: { id: string; title: string }[] }> {
  return json(await fetch(`${BASE}/projects/${projectId}/execute`, { method: 'POST' }));
}

export async function fetchProgress(projectId: string): Promise<Progress> {
  return json(await fetch(`${BASE}/projects/${projectId}/progress`));
}

// ---- Tasks ----------------------------------------------------------------

export async function fetchTasks(projectId: string): Promise<Task[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/tasks`));
}

export async function retryTask(projectId: string, taskId: string): Promise<void> {
  await json(await fetch(`${BASE}/projects/${projectId}/tasks/${taskId}/retry`, { method: 'POST' }));
}

// ---- Agents ---------------------------------------------------------------

export async function fetchAgentConfigs(): Promise<AgentConfig[]> {
  return json(await fetch(`${BASE}/agents`));
}

export async function fetchPresetAgents(): Promise<AgentConfig[]> {
  return json(await fetch(`${BASE}/agents/presets`));
}

// ---- Chat -----------------------------------------------------------------

export async function fetchChatHistory(projectId: string): Promise<ChatMessage[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/chat/history`));
}

export function streamPMChat(
  projectId: string,
  message: string,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  fetch(`${BASE}/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.text) onText(parsed.text);
          } catch {
            // skip
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return () => controller.abort();
}

// ---- Docker ---------------------------------------------------------------

export async function fetchDockerStatus(): Promise<{ docker: boolean; coderImage: boolean }> {
  return json(await fetch(`${BASE}/docker/status`));
}
