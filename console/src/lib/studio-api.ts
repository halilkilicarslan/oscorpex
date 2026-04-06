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

// ---- Team Templates & Project Agents ------------------------------------

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  roles: string[];
  createdAt: string;
}

export interface ProjectAgent {
  id: string;
  projectId: string;
  sourceAgentId?: string;
  name: string;
  role: string;
  avatar: string;
  personality: string;
  model: string;
  cliTool: string;
  skills: string[];
  systemPrompt: string;
  createdAt: string;
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

export async function createProject(data: { name: string; description?: string; techStack?: string[]; teamTemplateId?: string }): Promise<Project> {
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

export async function fetchAgent(id: string): Promise<AgentConfig> {
  return json(await fetch(`${BASE}/agents/${id}`));
}

export async function createAgent(data: Omit<AgentConfig, 'id' | 'isPreset'>): Promise<AgentConfig> {
  return json(await fetch(`${BASE}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function updateAgent(id: string, data: Partial<AgentConfig>): Promise<AgentConfig> {
  return json(await fetch(`${BASE}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function deleteAgent(id: string): Promise<void> {
  await fetch(`${BASE}/agents/${id}`, { method: 'DELETE' });
}

// ---- Team Templates -------------------------------------------------------

export async function fetchTeamTemplates(): Promise<TeamTemplate[]> {
  return json(await fetch(`${BASE}/team-templates`));
}

// ---- Project Team (project-scoped agents) ---------------------------------

export async function fetchProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/team`));
}

export async function fetchProjectAgent(projectId: string, agentId: string): Promise<ProjectAgent> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/${agentId}`));
}

export async function addProjectAgent(
  projectId: string,
  data: Omit<ProjectAgent, 'id' | 'projectId' | 'createdAt'>,
): Promise<ProjectAgent> {
  return json(await fetch(`${BASE}/projects/${projectId}/team`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function updateProjectAgent(
  projectId: string,
  agentId: string,
  data: Partial<ProjectAgent>,
): Promise<ProjectAgent> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/${agentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function deleteProjectAgent(projectId: string, agentId: string): Promise<void> {
  await fetch(`${BASE}/projects/${projectId}/team/${agentId}`, { method: 'DELETE' });
}

export async function copyTeamFromTemplate(projectId: string, templateId: string): Promise<ProjectAgent[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  }));
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

// ---- Agent Files ----------------------------------------------------------

export async function fetchAgentFiles(
  projectId: string,
  agentId: string,
): Promise<{ agentId: string; agentName: string; files: string[] }> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/${agentId}/files`));
}

export async function fetchAgentFile(
  projectId: string,
  agentId: string,
  fileName: string,
): Promise<{ fileName: string; content: string }> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/${agentId}/files/${fileName}`));
}

export async function writeAgentFile(
  projectId: string,
  agentId: string,
  fileName: string,
  content: string,
): Promise<void> {
  await json(
    await fetch(`${BASE}/projects/${projectId}/team/${agentId}/files/${fileName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  );
}

// ---- Docker ---------------------------------------------------------------

export async function fetchDockerStatus(): Promise<{ docker: boolean; coderImage: boolean }> {
  return json(await fetch(`${BASE}/docker/status`));
}

// ---- Config status --------------------------------------------------------

export async function fetchConfigStatus(): Promise<{ openaiConfigured: boolean }> {
  return json(await fetch(`${BASE}/config/status`));
}

// ---- AI Providers ---------------------------------------------------------

export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchProviders(): Promise<AIProvider[]> {
  return json(await fetch(`${BASE}/providers`));
}

export async function createProvider(
  data: Omit<AIProvider, 'id' | 'createdAt' | 'updatedAt' | 'isDefault'>,
): Promise<AIProvider> {
  return json(
    await fetch(`${BASE}/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
}

export async function updateProvider(id: string, data: Partial<AIProvider>): Promise<AIProvider> {
  return json(
    await fetch(`${BASE}/providers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
}

export async function deleteProvider(id: string): Promise<void> {
  await json(await fetch(`${BASE}/providers/${id}`, { method: 'DELETE' }));
}

export async function setDefaultProvider(id: string): Promise<void> {
  await json(await fetch(`${BASE}/providers/${id}/default`, { method: 'POST' }));
}

export async function testProvider(id: string): Promise<{ valid: boolean; message: string }> {
  return json(await fetch(`${BASE}/providers/${id}/test`, { method: 'POST' }));
}
