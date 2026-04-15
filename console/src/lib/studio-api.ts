// ---------------------------------------------------------------------------
// Oscorpex — Frontend API Client
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
  status: 'queued' | 'assigned' | 'running' | 'review' | 'revision' | 'waiting_approval' | 'done' | 'failed';
  complexity: 'S' | 'M' | 'L' | 'XL';
  dependsOn: string[];
  branch: string;
  output?: {
    filesCreated: string[];
    filesModified: string[];
    testResults?: { passed: number; failed: number; total: number };
    logs: string[];
  };
  retryCount: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  reviewStatus?: 'approved' | 'rejected' | null;
  reviewerAgentId?: string;
  revisionCount?: number;
  assignedAgentId?: string;
  // Human-in-the-Loop onay alanları
  requiresApproval?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | null;
  approvalRejectionReason?: string;
  parentTaskId?: string;
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
  dependencies: { from: string; to: string; type: DependencyType }[];
  createdAt: string;
}

export type Gender = 'male' | 'female';

export interface AvatarOption {
  name: string;
  url: string;
  gender: Gender;
}

export interface ProjectAgent {
  id: string;
  projectId: string;
  sourceAgentId?: string;
  name: string;
  role: string;
  avatar: string;
  gender: Gender;
  personality: string;
  model: string;
  cliTool: string;
  skills: string[];
  systemPrompt: string;
  createdAt: string;
  reportsTo?: string;
  color: string;
  pipelineOrder: number;
}

export type DependencyType = 'hierarchy' | 'workflow' | 'review' | 'gate' | 'escalation' | 'pair' | 'conditional' | 'fallback' | 'notification' | 'handoff' | 'approval' | 'mentoring';

export interface AgentDependency {
  id: string;
  projectId: string;
  fromAgentId: string;
  toAgentId: string;
  type: DependencyType;
  createdAt: string;
}

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  pipelineOrder: number;
  children: OrgNode[];
}

export interface PipelineAgent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  pipelineOrder: number;
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
  return json(await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

// ---- Project Templates ----------------------------------------------------

export interface ProjectTemplateInfo {
  id: string;
  name: string;
  description: string;
  techStack: string[];
  teamTemplate: string;
}

export async function fetchProjectTemplates(): Promise<ProjectTemplateInfo[]> {
  return json(await fetch(`${BASE}/project-templates`));
}

export async function createProjectFromTemplate(data: {
  name: string;
  templateId: string;
  description?: string;
  plannerAgentId?: string;
  previewEnabled?: boolean;
}): Promise<Project & { filesCreated?: string[] }> {
  return json(await fetch(`${BASE}/projects/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
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
  return json(await fetch(`${BASE}/projects/import`, {
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

/**
 * Proje için README.md oluşturur ve git repo'ya yazar.
 * Backend template-based generation kullanır; AI çağrısı yapılmaz.
 */
export async function generateReadme(projectId: string): Promise<{ success: boolean; logs: string[] }> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/generate-readme`, {
      method: 'POST',
    }),
  );
}

// ---- Plans ----------------------------------------------------------------

export async function fetchPlan(projectId: string): Promise<ProjectPlan | null> {
  const res = await fetch(`${BASE}/projects/${projectId}/plan`);
  if (res.status === 404) return null;
  return json(res);
}

export interface ApproveResult {
  success: boolean;
  planId: string;
  execution: { started: boolean };
  pipeline: { started: boolean; warning?: string };
}

export async function approvePlan(projectId: string): Promise<ApproveResult> {
  return json(await fetch(`${BASE}/projects/${projectId}/plan/approve`, { method: 'POST' }));
}

export interface AutoStartStatus {
  projectId: string;
  planApproved: boolean;
  autoStartEnabled: boolean;
  pipeline: {
    status: string;
    currentStage: number;
    totalStages: number;
    startedAt?: string;
  } | null;
}

export async function fetchAutoStartStatus(projectId: string): Promise<AutoStartStatus> {
  return json(await fetch(`${BASE}/projects/${projectId}/pipeline/auto-start-status`));
}

// ---- Plan Cost Estimate ---------------------------------------------------

export interface PlanCostEstimate {
  estimatedTokens: number;
  estimatedCost: number;
  currency: 'USD';
  taskCount: number;
  avgTokensPerTask: number;
  model: string;
  breakdown: {
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
  };
}

/**
 * Bir plan için tahmini maliyet bilgisini backend'den çeker.
 * Plan onay butonunun yanında badge olarak gösterilir.
 */
export async function fetchPlanCostEstimate(projectId: string, planId: string): Promise<PlanCostEstimate> {
  return json(await fetch(`${BASE}/projects/${projectId}/plans/${planId}/cost-estimate`));
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

export async function submitReview(
  projectId: string,
  taskId: string,
  approved: boolean,
  feedback?: string,
): Promise<void> {
  await json(
    await fetch(`${BASE}/projects/${projectId}/tasks/${taskId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, feedback }),
    }),
  );
}

export async function restartRevision(projectId: string, taskId: string): Promise<void> {
  await json(
    await fetch(`${BASE}/projects/${projectId}/tasks/${taskId}/restart-revision`, { method: 'POST' }),
  );
}

// ---- Human-in-the-Loop Onay API -------------------------------------------

/**
 * Waiting approval durumundaki bir task'ı onaylar.
 * Onaylanan task execution engine tarafından çalıştırılır.
 */
export async function approveTask(projectId: string, taskId: string): Promise<Task> {
  const result = await json<{ success: boolean; task: Task }>(
    await fetch(`${BASE}/projects/${projectId}/tasks/${taskId}/approve`, { method: 'POST' }),
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
    await fetch(`${BASE}/projects/${projectId}/tasks/${taskId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  );
  return result.task;
}

/**
 * Proje için bekleyen onay listesini getirir.
 */
export async function fetchPendingApprovals(projectId: string): Promise<Task[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/approvals`));
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

// ---- Custom Team Templates (user-created) ---------------------------------

export interface CustomTeamTemplate {
  id: string;
  name: string;
  description: string;
  roles: string[];
  dependencies: { from: string; to: string; type: DependencyType }[];
  createdAt: string;
}

export async function fetchCustomTeams(): Promise<CustomTeamTemplate[]> {
  return json(await fetch(`${BASE}/custom-teams`));
}

export async function createCustomTeam(data: { name: string; description?: string; roles: string[]; dependencies: { from: string; to: string; type: DependencyType }[] }): Promise<CustomTeamTemplate> {
  return json(await fetch(`${BASE}/custom-teams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
}

export async function updateCustomTeam(id: string, data: Partial<{ name: string; description: string; roles: string[]; dependencies: { from: string; to: string; type: DependencyType }[] }>): Promise<CustomTeamTemplate> {
  return json(await fetch(`${BASE}/custom-teams/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
}

export async function deleteCustomTeam(id: string): Promise<void> {
  await fetch(`${BASE}/custom-teams/${id}`, { method: 'DELETE' });
}

// ---- Project Team (project-scoped agents) ---------------------------------

export async function fetchProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/team`));
}

export async function fetchProjectDependencies(projectId: string): Promise<AgentDependency[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/dependencies`));
}

export async function fetchAvatars(gender?: Gender): Promise<AvatarOption[]> {
  const query = gender ? `?gender=${gender}` : '';
  return json(await fetch(`${BASE}/avatars${query}`));
}

export async function fetchProjectAgent(projectId: string, agentId: string): Promise<ProjectAgent> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/${agentId}`));
}

// Backend sunar color ve pipelineOrder icin default degerler; form bunlari
// gondermeden de ajan olusturabilir.
export type ProjectAgentCreateInput = Omit<
  ProjectAgent,
  'id' | 'projectId' | 'createdAt' | 'color' | 'pipelineOrder'
> &
  Partial<Pick<ProjectAgent, 'color' | 'pipelineOrder'>>;

export async function addProjectAgent(
  projectId: string,
  data: ProjectAgentCreateInput,
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

export async function fetchOrgStructure(projectId: string): Promise<{ tree: OrgNode[]; pipeline: PipelineAgent[] }> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/org`));
}

export async function updateAgentHierarchy(
  projectId: string,
  agentId: string,
  data: { reportsTo: string | null; pipelineOrder?: number },
): Promise<ProjectAgent> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/${agentId}/hierarchy`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function copyTeamFromTemplate(projectId: string, templateId: string): Promise<ProjectAgent[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/team/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  }));
}

// ---- Dependencies ---------------------------------------------------------

export async function fetchDependencies(projectId: string): Promise<AgentDependency[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/dependencies`));
}

export async function saveDependencies(
  projectId: string,
  deps: { fromAgentId: string; toAgentId: string; type: DependencyType }[],
): Promise<AgentDependency[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/dependencies`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deps),
  }));
}

// ---- Chat -----------------------------------------------------------------

export async function fetchChatHistory(projectId: string): Promise<ChatMessage[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/chat/history`));
}

export type PlannerCLIProvider = 'claude-code' | 'codex' | 'gemini';

export interface PlannerCLIProviderInfo {
  id: PlannerCLIProvider;
  label: string;
  binary: string;
  available: boolean;
  version?: string;
  models: string[];
  defaultModel: string;
  efforts: PlannerReasoningEffort[];
  defaultEffort?: PlannerReasoningEffort;
}

export type PlannerChatModel = string;
export type PlannerReasoningEffort = 'low' | 'medium' | 'high' | 'max' | 'xhigh';
export interface ArchitectMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TeamArchitectIntake {
  name: string;
  description: string;
  projectType: string;
  previewEnabled: boolean;
  techPreference: string[];
}

export function streamPMChat(
  projectId: string,
  message: string,
  provider: PlannerCLIProvider,
  model: PlannerChatModel,
  effort: PlannerReasoningEffort | null,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  fetch(`${BASE}/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, provider, model, effort }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            if (currentEvent === 'error' && parsed.error) {
              throw new Error(parsed.error);
            }
            // Sadece text-delta event'lerinden gelen string text değerlerini işle.
            // tool-call, tool-result, step-finish gibi AI SDK event'leri text içermez
            // ve ekranda "undefined" olarak görünmelerine yol açar — bunları atla.
            if (currentEvent === 'text-delta' && typeof parsed.text === 'string') {
              onText(parsed.text);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
          }
          currentEvent = '';
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err);
    });

  return () => controller.abort();
}

export function streamTeamArchitectChat(
  intake: TeamArchitectIntake,
  messages: ArchitectMessage[],
  onText: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  fetch(`${BASE}/team-architect/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intake, messages }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let finalText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            if (currentEvent === 'error' && parsed.error) {
              throw new Error(parsed.error);
            }
            if (currentEvent === 'text-delta' && typeof parsed.text === 'string') {
              onText(parsed.text);
            }
            if (currentEvent === 'done' && typeof parsed.fullText === 'string') {
              finalText = parsed.fullText;
            }
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
          }
          currentEvent = '';
        }
      }

      onDone(finalText);
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

// ---- Pipeline -------------------------------------------------------------

// Pipeline aşamasının durumu ve içeriği
export interface PipelineStage {
  order: number;
  agents: ProjectAgent[];
  tasks: Task[];
  status: 'pending' | 'running' | 'completed' | 'failed';
}

// Tüm pipeline'ın durum bilgisi
export interface PipelineState {
  projectId: string;
  stages: PipelineStage[];
  currentStage: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
}

// Pipeline'ı başlat
export async function startPipeline(projectId: string): Promise<PipelineState> {
  const data = await json<{ pipeline?: PipelineState } & PipelineState>(
    await fetch(`${BASE}/projects/${projectId}/pipeline/start`, { method: 'POST' }),
  );
  return data.pipeline ?? data;
}

// Pipeline durumunu getir
export async function getPipelineStatus(projectId: string): Promise<PipelineState> {
  const data = await json<{ pipeline?: PipelineState } & PipelineState>(
    await fetch(`${BASE}/projects/${projectId}/pipeline/status`),
  );
  // API { pipeline, taskProgress, status } formatında dönüyor — içindeki pipeline objesini çıkar
  return data.pipeline ?? data;
}

// Pipeline'ı duraklat
export async function pausePipeline(projectId: string): Promise<void> {
  await json(await fetch(`${BASE}/projects/${projectId}/pipeline/pause`, { method: 'POST' }));
}

// Pipeline'ı devam ettir
export async function resumePipeline(projectId: string): Promise<void> {
  await json(await fetch(`${BASE}/projects/${projectId}/pipeline/resume`, { method: 'POST' }));
}

// Pipeline'ı manuel olarak ilerlet (test amaçlı)
export async function advancePipeline(projectId: string): Promise<PipelineState> {
  const data = await json<{ pipeline?: PipelineState } & PipelineState>(
    await fetch(`${BASE}/projects/${projectId}/pipeline/advance`, { method: 'POST' }),
  );
  return data.pipeline ?? data;
}

// ---- Agent Runtime (süreç yönetimi) --------------------------------------

// Ajan süreç bilgisi arayüzü
export interface AgentProcessInfo {
  id: string;
  agentId: string;
  agentName: string;
  cliTool: string;
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  mode?: 'local' | 'docker';
}

// Ajan çalıştırma geçmişi arayüzü
export interface AgentRunHistory {
  id: string;
  projectId: string;
  agentId: string;
  cliTool: string;
  status: string;
  taskPrompt?: string;
  outputSummary?: string;
  pid?: number;
  exitCode?: number | null;
  startedAt?: string;
  stoppedAt?: string;
  createdAt: string;
}

// Ajan sürecini başlat
export async function startAgentProcess(
  projectId: string,
  agentId: string,
  taskPrompt?: string,
): Promise<AgentProcessInfo> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/agents/${agentId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskPrompt }),
    }),
  );
}

// Ajan sürecini durdur
export async function stopAgentProcess(projectId: string, agentId: string): Promise<void> {
  await fetch(`${BASE}/projects/${projectId}/agents/${agentId}/stop`, { method: 'POST' });
}

// Ajan durumunu sorgula
export async function getAgentStatus(
  projectId: string,
  agentId: string,
): Promise<AgentProcessInfo> {
  return json(await fetch(`${BASE}/projects/${projectId}/agents/${agentId}/status`));
}

// Mevcut çıktı tamponunu getir (since parametresi ile offset desteği)
export async function getAgentOutput(
  projectId: string,
  agentId: string,
  since?: number,
): Promise<{ agentId: string; lines: string[]; total: number }> {
  const url =
    since !== undefined
      ? `${BASE}/projects/${projectId}/agents/${agentId}/output?since=${since}`
      : `${BASE}/projects/${projectId}/agents/${agentId}/output`;
  return json(await fetch(url));
}

// Tüm ajanların çalışma durumlarını listele
export async function getAgentRuntimes(projectId: string): Promise<AgentProcessInfo[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/runtimes`));
}

// Ajan çalıştırma geçmişini getir
export async function getAgentRunHistory(
  projectId: string,
  agentId: string,
  limit?: number,
): Promise<AgentRunHistory[]> {
  const url =
    limit !== undefined
      ? `${BASE}/projects/${projectId}/agents/${agentId}/runs?limit=${limit}`
      : `${BASE}/projects/${projectId}/agents/${agentId}/runs`;
  return json(await fetch(url));
}

// ---------------------------------------------------------------------------
// WebSocket tabanlı Agent Output Streaming
// ---------------------------------------------------------------------------
//
// SSE'ye kıyasla avantajları:
//   - Bidirectional: ilerleyen süreçte client'tan agent'a komut gönderilebilir
//   - Tek bir kalıcı bağlantı üzerinden tüm projeler için multiplexing
//   - Daha düşük overhead (HTTP başlıkları her mesajda tekrar edilmez)
//
// Kullanım:
//   const stop = streamAgentOutputWS(projectId, agentId, (line, index) => {
//     console.log(line);
//   });
//   // Durdur:
//   stop();

const STUDIO_WS_URL = `ws://localhost:${import.meta.env.VITE_STUDIO_WS_PORT ?? 3142}/api/studio/ws`;
const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS  = 15_000;

export function streamAgentOutputWS(
  projectId: string,
  agentId: string | undefined,
  onLine: (line: string, index: number) => void,
  onError?: (err: Error) => void,
  taskId?: string,
): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let lineCounter = 0;

  function connect() {
    if (stopped) return;

    try {
      ws = new WebSocket(STUDIO_WS_URL);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      // Projeye abone ol
      ws!.send(JSON.stringify({ type: 'subscribe', projectId }));
    };

    ws.onmessage = (e: MessageEvent<string>) => {
      if (stopped) return;
      let msg: { type: string; payload?: unknown };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.type !== 'event') return;

      const event = msg.payload as {
        type: string;
        agentId?: string;
        taskId?: string;
        payload?: { line?: string; index?: number; output?: string };
      };

      // Filter by agentId or taskId
      if (
        event.type === 'agent:output' &&
        event.payload &&
        (agentId ? event.agentId === agentId : taskId ? event.taskId === taskId : false)
      ) {
        const { line, index, output } = event.payload;
        if (typeof line === 'string' && typeof index === 'number') {
          onLine(line, index);
        } else if (typeof output === 'string') {
          onLine(output, lineCounter++);
        }
      }
    };

    ws.onerror = () => {
      if (stopped) return;
      onError?.(new Error('WebSocket bağlantı hatası'));
    };

    ws.onclose = () => {
      if (stopped) return;
      ws = null;
      // Exponential backoff ile yeniden bağlan
      const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** attempt, WS_RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      ws.close(1000, 'caller stopped');
      ws = null;
    }
  };
}

// ---------------------------------------------------------------------------
// SSE akışını fetch + ReadableStream ile bağla.
// EventSource yerine fetch tercih edilir: daha iyi hata yönetimi ve iptal desteği sağlar.
// Dönen fonksiyon çağrıldığında bağlantıyı iptal eder (abort).
// NOT: Yeni kodda streamAgentOutputWS tercih edilmeli; bu fonksiyon geriye uyumluluk içindir.
export function streamAgentOutput(
  projectId: string,
  agentId: string,
  onLine: (line: string, index: number) => void,
  onError?: (err: Error) => void,
): () => void {
  const controller = new AbortController();

  // SSE akışını asenkron olarak başlat
  const connect = async () => {
    try {
      const res = await fetch(
        `${BASE}/projects/${projectId}/agents/${agentId}/stream`,
        { signal: controller.signal },
      );

      if (!res.ok) {
        throw new Error(`SSE bağlantısı başarısız: HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream desteklenmiyor');

      const decoder = new TextDecoder();
      let buffer = '';

      // Veri satırlarını sürekli oku
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Tampondaki tüm tam satırları işle
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          // Yalnızca SSE veri satırlarını işle
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr) as { line: string; index: number };
            if (typeof parsed.line === 'string' && typeof parsed.index === 'number') {
              onLine(parsed.line, parsed.index);
            }
          } catch {
            // JSON ayrıştırma hatalarını sessizce atla
          }
        }
      }
    } catch (err) {
      // AbortError normal kapatma sinyalidir; hata olarak iletme
      if (err instanceof Error && err.name === 'AbortError') return;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  connect();

  // Bağlantıyı iptal eden fonksiyonu döndür
  return () => controller.abort();
}

// ---- Docker ---------------------------------------------------------------

export async function fetchDockerStatus(): Promise<{ docker: boolean; coderImage: boolean }> {
  return json(await fetch(`${BASE}/docker/status`));
}

// ---- Config status --------------------------------------------------------

export async function fetchConfigStatus(): Promise<{
  openaiConfigured: boolean;
  providerConfigured: boolean;
  providerName?: string;
  plannerAvailable: boolean;
}> {
  return json(await fetch(`${BASE}/config/status`));
}

export async function fetchPlannerProviders(): Promise<PlannerCLIProviderInfo[]> {
  return json(await fetch(`${BASE}/planner/providers`));
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
  /** Fallback zincirindeki sıra; küçük değer = daha önce denenir */
  fallbackOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchProviders(): Promise<AIProvider[]> {
  return json(await fetch(`${BASE}/providers`));
}

/**
 * Aktif provider'ları fallback öncelik sırasına göre getirir.
 * Default provider her zaman başta yer alır.
 */
export async function fetchFallbackChain(): Promise<AIProvider[]> {
  return json(await fetch(`${BASE}/providers/fallback-chain`));
}

/**
 * Provider'ların fallback sıralamasını günceller.
 * @param orderedIds — Provider ID'leri, istenen sıraya göre dizili (birincisi en önce denenir).
 */
export async function updateFallbackOrder(orderedIds: string[]): Promise<AIProvider[]> {
  return json(
    await fetch(`${BASE}/providers/fallback-chain`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    }),
  );
}

// Backend createProvider yalnizca bu alanlari zorunlu tutar; fallbackOrder
// ayri bir endpoint ile guncellenir.
export type ProviderCreateInput = Pick<
  AIProvider,
  'name' | 'type' | 'apiKey' | 'baseUrl' | 'model' | 'isActive'
>;

export async function createProvider(
  data: ProviderCreateInput,
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

// ---- Mesajlaşma Tipleri ---------------------------------------------------

// Ajan mesaj türleri
export type AgentMessageType =
  | 'task_assignment'
  | 'task_complete'
  | 'review_request'
  | 'bug_report'
  | 'feedback'
  | 'notification';

// Ajan mesajı arayüzü
export interface AgentMessage {
  id: string;
  projectId: string;
  fromAgentId: string;
  toAgentId: string;
  type: AgentMessageType;
  subject: string;
  content: string;
  metadata: Record<string, unknown>;
  status: 'unread' | 'read' | 'archived';
  parentMessageId?: string;
  createdAt: string;
  readAt?: string;
}

// Mesaj gönderme veri yapısı
export interface SendMessageData {
  fromAgentId: string;
  toAgentId: string;
  type: AgentMessageType;
  subject: string;
  content: string;
  metadata?: Record<string, unknown>;
  parentMessageId?: string;
}

// Yayın mesajı veri yapısı
export interface BroadcastMessageData {
  fromAgentId: string;
  type: AgentMessageType;
  subject: string;
  content: string;
  metadata?: Record<string, unknown>;
}

// ---- Mesajlaşma Fonksiyonları ---------------------------------------------

// Proje mesajlarını listele (opsiyonel: agentId ve status filtresi)
export async function fetchProjectMessages(
  projectId: string,
  agentId?: string,
  status?: string,
): Promise<AgentMessage[]> {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  if (status) params.set('status', status);
  const query = params.toString() ? `?${params.toString()}` : '';
  return json(await fetch(`${BASE}/projects/${projectId}/messages${query}`));
}

// Ajan gelen kutusunu getir
export async function fetchAgentInbox(
  projectId: string,
  agentId: string,
  status?: string,
): Promise<AgentMessage[]> {
  const query = status ? `?status=${status}` : '';
  return json(await fetch(`${BASE}/projects/${projectId}/agents/${agentId}/inbox${query}`));
}

// Okunmamış mesaj sayısını getir
export async function fetchUnreadCount(
  projectId: string,
  agentId: string,
): Promise<{ agentId: string; unreadCount: number }> {
  return json(await fetch(`${BASE}/projects/${projectId}/agents/${agentId}/inbox/count`));
}

// Yeni mesaj gönder
export async function sendAgentMessage(
  projectId: string,
  data: SendMessageData,
): Promise<AgentMessage> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
}

// Mesajı okundu olarak işaretle
export async function markMessageRead(
  projectId: string,
  messageId: string,
): Promise<AgentMessage> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/messages/${messageId}/read`, {
      method: 'PUT',
    }),
  );
}

// Mesajı arşivle
export async function archiveAgentMessage(
  projectId: string,
  messageId: string,
): Promise<AgentMessage> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/messages/${messageId}/archive`, {
      method: 'PUT',
    }),
  );
}

// Mesaj zincirini (thread) getir
export async function fetchMessageThread(
  projectId: string,
  messageId: string,
): Promise<AgentMessage[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/messages/${messageId}/thread`));
}

// Tüm ekibe yayın mesajı gönder
export async function broadcastMessage(
  projectId: string,
  data: BroadcastMessageData,
): Promise<{ sent: number; messages: AgentMessage[] }> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/messages/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
}

// ---- File Operations (Enhanced) --------------------------------------------

export interface GitStatusResult {
  modified: string[];
  untracked: string[];
  staged: string[];
  deleted: string[];
}

export async function createFile(projectId: string, filePath: string, content = ''): Promise<{ path: string; created: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/files`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  }));
}

export async function deleteFile(projectId: string, filePath: string): Promise<{ path: string; deleted: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/files`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  }));
}

export async function getGitStatus(projectId: string): Promise<GitStatusResult> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/status`));
}

export async function commitChanges(projectId: string, message: string, files?: string[]): Promise<{ commit: string; message: string }> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, files }),
  }));
}

// ---- Analytics -------------------------------------------------------------

export interface ProjectAnalytics {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  totalFailures: number;
  totalReviewRejections: number;
  tasksPerAgent: { agentId: string; agentName: string; total: number; completed: number; completionRate: number }[];
  avgCompletionTimeMs: number | null;
  pipelineRunCount: number;
  pipelineSuccessRate: number;
}

export interface AgentAnalytics {
  agentId: string;
  agentName: string;
  role: string;
  avatar: string;
  color: string;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalFailures: number;
  totalReviewRejections: number;
  firstPassTasks: number;
  score: number;
  runCount: number;
  totalRuntimeMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  messagesSent: number;
  messagesReceived: number;
  isRunning: boolean;
}

export interface ActivityTimeline {
  date: string;
  tasksCompleted: number;
  runsStarted: number;
  runsCompleted: number;
}

export async function fetchProjectAnalytics(projectId: string): Promise<ProjectAnalytics> {
  return json(await fetch(`${BASE}/projects/${projectId}/analytics/overview`));
}

export async function fetchAgentAnalytics(projectId: string): Promise<AgentAnalytics[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/analytics/agents`));
}

export async function fetchActivityTimeline(projectId: string, days = 7): Promise<ActivityTimeline[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/analytics/timeline?days=${days}`));
}

// ---------------------------------------------------------------------------
// Token Usage & Cost Tracking
// ---------------------------------------------------------------------------

export interface ProjectCostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  taskCount: number;
}

export interface CostBreakdownEntry {
  agentId: string;
  agentName?: string;
  agentAvatar?: string;
  agentRole?: string;
  model: string;
  taskCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export async function fetchProjectCosts(projectId: string): Promise<ProjectCostSummary> {
  return json(await fetch(`${BASE}/projects/${projectId}/costs`));
}

export async function fetchCostBreakdown(projectId: string): Promise<CostBreakdownEntry[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/costs/breakdown`));
}

// ---------------------------------------------------------------------------
// App Runner
// ---------------------------------------------------------------------------

export interface AppService {
  name: string;
  url: string;
  isPreview: boolean;
}

export interface AppStatus {
  running: boolean;
  services: AppService[];
  previewUrl: string | null;
  // backward compat
  backendUrl: string | null;
  frontendUrl: string | null;
}

export interface AppConfig {
  services: {
    name: string;
    path: string;
    command: string;
    port: number;
    readyPattern: string;
    env?: Record<string, string>;
  }[];
  preview: string;
}

export async function startApp(projectId: string): Promise<{ ok: boolean; services: { name: string; url: string }[]; previewUrl: string | null }> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/start`, { method: 'POST' }));
}

export async function stopApp(projectId: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/stop`, { method: 'POST' }));
}

export async function fetchAppStatus(projectId: string): Promise<AppStatus> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/status`));
}

export async function switchPreviewService(projectId: string, service: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/switch-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service }),
  }));
}

export async function fetchAppConfig(projectId: string): Promise<AppConfig> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/config`));
}

// ---- Runtime & Environment ---------------------------------------------------

export type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'redis' | 'sqlite';
export type DbProvisionMethod = 'docker' | 'local' | 'cloud';
export type FrameworkType =
  | 'express' | 'hono' | 'fastify' | 'koa' | 'nestjs'
  | 'nextjs' | 'nuxt' | 'vite' | 'cra' | 'angular'
  | 'django' | 'fastapi' | 'flask'
  | 'spring-boot' | 'quarkus'
  | 'go' | 'gin' | 'fiber'
  | 'rails'
  | 'rust-actix' | 'rust-axum'
  | 'generic-node' | 'generic-python' | 'unknown';

export interface DetectedService {
  name: string;
  framework: FrameworkType;
  language: string;
  startCommand: string;
  installCommand: string | null;
  port: number;
  readyPattern: string;
  type: 'backend' | 'frontend' | 'fullstack';
  path: string;
  depsInstalled: boolean;
}

export interface DetectedDatabase {
  type: DatabaseType;
  image: string;
  port: number;
  envVars: string[];
  fromCompose: boolean;
}

export interface EnvVarRequirement {
  key: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  sensitive: boolean;
  category: 'database' | 'auth' | 'api' | 'app' | 'other';
}

export interface DbStatus {
  type: DatabaseType;
  method: DbProvisionMethod;
  running: boolean;
  port: number;
  containerName?: string;
  connectionUrl?: string;
}

export interface RuntimeAnalysis {
  services: DetectedService[];
  databases: DetectedDatabase[];
  envVars: EnvVarRequirement[];
  allDepsInstalled: boolean;
  allEnvVarsSet: boolean;
  dbReady: boolean;
  hasStudioConfig: boolean;
  hasDockerCompose: boolean;
  dbStatuses: DbStatus[];
}

/** Proje runtime gereksinimlerini analiz et */
export async function analyzeRuntime(projectId: string): Promise<RuntimeAnalysis> {
  return json(await fetch(`${BASE}/projects/${projectId}/runtime/analyze`));
}

/** Env var'ları .env dosyasına kaydet */
export async function saveEnvVars(projectId: string, values: Record<string, string>): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/runtime/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  }));
}

/** DB provision (Docker / Cloud) */
export async function provisionDb(
  projectId: string,
  type: DatabaseType,
  method: DbProvisionMethod,
  cloudUrl?: string,
  port?: number,
): Promise<{ ok: boolean; status?: DbStatus; envVars?: Record<string, string> }> {
  return json(await fetch(`${BASE}/projects/${projectId}/runtime/db/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, method, cloudUrl, port }),
  }));
}

/** DB durdur */
export async function stopDb(projectId: string, type?: DatabaseType): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/runtime/db/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  }));
}

/** DB durumları */
export async function fetchDbStatus(projectId: string): Promise<DbStatus[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/runtime/db/status`));
}

/** Bağımlılık kur */
export async function installDeps(
  projectId: string,
  serviceName?: string,
): Promise<{ ok: boolean; results: { name: string; success: boolean; error?: string }[] }> {
  return json(await fetch(`${BASE}/projects/${projectId}/runtime/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceName }),
  }));
}

// ---- Webhooks ----------------------------------------------------------------
// Proje bazlı Slack/Discord/Generic webhook yönetimi

/** Desteklenen webhook türleri */
export type WebhookType = 'slack' | 'discord' | 'generic';

/** Webhook desteklenen event tipleri */
export type WebhookEventType =
  | 'task_completed'
  | 'task_failed'
  | 'task_approval_required'
  | 'task_approved'
  | 'task_rejected'
  | 'pipeline_completed'
  | 'execution_error'
  | 'budget_warning'
  | 'plan_approved'
  | 'agent_started'
  | 'agent_stopped'
  | 'test';

/** Webhook veri yapısı */
export interface Webhook {
  id: string;
  projectId: string;
  name: string;
  url: string;
  type: WebhookType;
  events: WebhookEventType[];
  active: boolean;
  createdAt: string;
}

/** Webhook oluşturma isteği */
export interface CreateWebhookData {
  name: string;
  url: string;
  type: WebhookType;
  events: WebhookEventType[];
}

/** Webhook güncelleme isteği — tüm alanlar isteğe bağlı */
export type UpdateWebhookData = Partial<CreateWebhookData & { active: boolean }>;

/** Projeye ait webhook'ları listele */
export async function fetchWebhooks(projectId: string): Promise<Webhook[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/webhooks`));
}

/** Yeni webhook oluştur */
export async function createWebhook(
  projectId: string,
  data: CreateWebhookData,
): Promise<Webhook> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
}

/** Webhook'u güncelle */
export async function updateWebhook(
  projectId: string,
  webhookId: string,
  data: UpdateWebhookData,
): Promise<Webhook> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/webhooks/${webhookId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
}

/** Webhook'u sil */
export async function deleteWebhook(
  projectId: string,
  webhookId: string,
): Promise<void> {
  await json(
    await fetch(`${BASE}/projects/${projectId}/webhooks/${webhookId}`, {
      method: 'DELETE',
    }),
  );
}

/** Test bildirimi gönder */
export async function testWebhook(
  projectId: string,
  webhookId: string,
): Promise<{ success: boolean; message: string }> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/webhooks/${webhookId}/test`, {
      method: 'POST',
    }),
  );
}

// ---- Project Settings ------------------------------------------------------

export type SettingsMap = Record<string, Record<string, string>>;

export async function fetchProjectSettings(projectId: string): Promise<SettingsMap> {
  return json(await fetch(`${BASE}/projects/${projectId}/settings`));
}

export async function saveProjectSettings(
  projectId: string,
  category: string,
  entries: Record<string, string>,
): Promise<{ ok: boolean }> {
  return json(
    await fetch(`${BASE}/projects/${projectId}/settings/${category}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    }),
  );
}

// ---- Docs Freshness -------------------------------------------------------

export interface DocFreshnessItem {
  file: string;
  status: 'filled' | 'tbd' | 'missing';
}

export async function fetchDocsFreshness(projectId: string): Promise<DocFreshnessItem[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/docs/freshness`));
}

// ---- SonarQube -------------------------------------------------------------

export interface SonarStatus {
  enabled: boolean;
}

export interface SonarScanResult {
  scanId?: string;
  qualityGate?: QualityGateResult;
  error?: string;
}

export interface QualityGateResult {
  status: 'OK' | 'WARN' | 'ERROR' | 'NONE';
  conditions: QualityGateCondition[];
}

export interface QualityGateCondition {
  metricKey: string;
  status: 'OK' | 'WARN' | 'ERROR' | 'NO_VALUE';
  actualValue?: string;
  errorThreshold?: string;
}

export interface SonarLatestScan {
  id?: string;
  projectId?: string;
  qualityGate?: string;
  conditions?: QualityGateCondition[];
  createdAt?: string;
  status?: string;
}

export async function fetchSonarStatus(projectId: string): Promise<SonarStatus> {
  return json(await fetch(`${BASE}/projects/${projectId}/sonar/status`));
}

export async function triggerSonarScan(projectId: string): Promise<SonarScanResult> {
  return json(await fetch(`${BASE}/projects/${projectId}/sonar/scan`, { method: 'POST' }));
}

export async function fetchLatestSonarScan(projectId: string): Promise<SonarLatestScan> {
  return json(await fetch(`${BASE}/projects/${projectId}/sonar/latest`));
}

// ---- Git ------------------------------------------------------------------

export interface GitStatus {
  modified: string[];
  untracked: string[];
  staged: string[];
  deleted: string[];
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export async function fetchGitStatus(projectId: string): Promise<GitStatus> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/status`));
}

export async function fetchGitDiff(projectId: string, ref?: string): Promise<{ diff: string }> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return json(await fetch(`${BASE}/projects/${projectId}/git/diff${q}`));
}

export async function fetchGitLog(projectId: string): Promise<GitLogEntry[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/log`));
}

/**
 * Son `limit` kadar commit'i döndürür.
 * Commit geçmişi listesi için fetchGitLog'dan daha granüler kontrol sağlar.
 */
export async function fetchCommitLog(projectId: string, limit = 20): Promise<GitLogEntry[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/log?limit=${limit}`));
}

export interface RevertResult {
  success: boolean;
  revertCommit: string;
  originalCommit: string;
}

/**
 * Belirli bir commit'i geri alır.
 * `git revert --no-edit` kullanır — orijinal commit silinmez.
 */
export async function revertCommit(projectId: string, commitHash: string): Promise<RevertResult> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitHash }),
  }));
}

export interface BranchesResult {
  branches: string[];
  current: string;
}

/** Projenin branch listesini ve aktif branch'i döndürür. */
export async function fetchBranches(projectId: string): Promise<BranchesResult> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/branches`));
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  source?: string;
  target?: string;
}

/**
 * Kaynak branch'i hedef branch'e merge eder.
 * Conflict durumunda `success: false` ve çakışan dosyalar döner.
 */
export async function mergeBranch(
  projectId: string,
  source: string,
  target: string,
): Promise<MergeResult> {
  return json(await fetch(`${BASE}/projects/${projectId}/git/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, target }),
  }));
}

// ---- Container Pool -------------------------------------------------------

export interface PoolStatus {
  initialized: boolean;
  total: number;
  ready: number;
  busy: number;
  unhealthy: number;
  containers: {
    id: string;
    name: string;
    port: number;
    status: string;
    assignedTo?: { projectId: string; agentId: string; taskId: string };
    createdAt: string;
  }[];
}

export async function fetchPoolStatus(): Promise<PoolStatus> {
  return json(await fetch(`${BASE}/pool/status`));
}

// ---- Helpers ---------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  // v2 roles
  'product-owner': 'Product Owner',
  'scrum-master': 'Scrum Master',
  'tech-lead': 'Tech Lead',
  'business-analyst': 'Business Analyst',
  'design-lead': 'Design Lead',
  'frontend-dev': 'Frontend Developer',
  'backend-dev': 'Backend Developer',
  'frontend-qa': 'Frontend QA Engineer',
  'backend-qa': 'Backend QA Engineer',
  'frontend-reviewer': 'Frontend Code Reviewer',
  'backend-reviewer': 'Backend Code Reviewer',
  devops: 'DevOps Engineer',
  // legacy roles
  pm: 'Project Manager',
  architect: 'Software Architect',
  frontend: 'Frontend Developer',
  backend: 'Backend Developer',
  coder: 'Full-Stack Developer',
  qa: 'QA Engineer',
  reviewer: 'Code Reviewer',
  designer: 'UI/UX Designer',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

// ---- API Discovery -----------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface DiscoveredRoute {
  method: HttpMethod;
  path: string;
  source?: string;
  description?: string;
  params?: string[];
}

export interface ApiDiscoveryResult {
  discoveryMethod: 'openapi' | 'source-parse' | 'probe' | 'none';
  basePath: string;
  routes: DiscoveredRoute[];
  openApiUrl?: string;
}

export interface SavedRequest {
  id: string;
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  lastStatus?: number;
  lastResponse?: string;
  lastDuration?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCollection {
  projectId: string;
  requests: SavedRequest[];
}

export async function discoverApiRoutes(projectId: string): Promise<ApiDiscoveryResult> {
  return json(await fetch(`${BASE}/projects/${projectId}/api/discover`));
}

export async function loadApiCollection(projectId: string): Promise<ApiCollection> {
  return json(await fetch(`${BASE}/projects/${projectId}/api/collection`));
}

export async function saveApiRequest(projectId: string, request: SavedRequest): Promise<void> {
  await fetch(`${BASE}/projects/${projectId}/api/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request }),
  });
}

export async function deleteApiRequest(projectId: string, requestId: string): Promise<void> {
  await fetch(`${BASE}/projects/${projectId}/api/collection/${requestId}`, { method: 'DELETE' });
}

/** Proxy üzerinden API çağrısı yap */
export async function sendProxyRequest(
  projectId: string,
  method: HttpMethod,
  path: string,
  headers?: Record<string, string>,
  body?: string,
): Promise<{ status: number; headers: Record<string, string>; body: string; duration: number }> {
  const proxyPath = `/api/studio/projects/${projectId}/app/proxy${path.startsWith('/') ? path : '/' + path}`;
  const start = performance.now();
  const res = await fetch(proxyPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method !== 'GET' && method !== 'DELETE' ? body : undefined,
  });
  const duration = Math.round(performance.now() - start);
  const resBody = await res.text();
  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });
  return { status: res.status, headers: resHeaders, body: resBody, duration };
}

// v3.x Types
export interface WorkItem {
  id: string;
  projectId: string;
  type: string;
  title: string;
  description: string;
  priority: string;
  severity?: string;
  labels: string[];
  status: string;
  source: string;
  sourceAgentId?: string;
  sourceTaskId?: string;
  plannedTaskId?: string;
  sprintId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status: string;
  createdAt: string;
}

export interface StandupReport {
  agentId: string;
  agentName: string;
  completedTasks: string[];
  inProgressTasks: string[];
  blockers: string[];
}

export interface RetrospectiveReport {
  whatWentWell: string[];
  whatCouldImprove: string[];
  actionItems: string[];
  agentStats: { agentId: string; agentName: string; tasksCompleted: number; avgRevisions: number; successRate: number }[];
}

export interface ProjectReport {
  projectName: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCostUsd: number;
  durationMs: number;
  qualityMetrics: { reviewPassRate: number; avgRevisions: number; firstPassRate: number };
  topFileChanges: string[];
}

// --- Work Items (v3.2) ---
export async function fetchWorkItems(projectId: string, filters?: Record<string, string>): Promise<WorkItem[]> {
  const params = new URLSearchParams(filters);
  return json(await fetch(`${BASE}/projects/${projectId}/work-items?${params}`));
}

export async function createWorkItem(projectId: string, data: Partial<WorkItem>): Promise<WorkItem> {
  return json(await fetch(`${BASE}/projects/${projectId}/work-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function updateWorkItem(projectId: string, itemId: string, data: Partial<WorkItem>): Promise<WorkItem> {
  return json(await fetch(`${BASE}/projects/${projectId}/work-items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

export async function deleteWorkItem(projectId: string, itemId: string): Promise<void> {
  await fetch(`${BASE}/projects/${projectId}/work-items/${itemId}`, { method: 'DELETE' });
}

export async function convertWorkItemToPlan(projectId: string, itemId: string): Promise<unknown> {
  return json(await fetch(`${BASE}/projects/${projectId}/work-items/${itemId}/plan`, { method: 'POST' }));
}

// --- Sub-tasks (v3.0) ---
export async function fetchSubTasks(projectId: string, taskId: string): Promise<Task[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/tasks/${taskId}/subtasks`));
}

// --- Sprints (v3.9) ---
export async function fetchSprints(projectId: string): Promise<Sprint[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/sprints`));
}

export async function createSprint(projectId: string, data: { name: string; goal?: string; startDate: string; endDate: string }): Promise<Sprint> {
  return json(await fetch(`${BASE}/projects/${projectId}/sprints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }));
}

// --- Ceremonies (v3.6) ---
export async function runStandup(projectId: string): Promise<StandupReport[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/ceremonies/standup`, { method: 'POST' }));
}

export async function runRetrospective(projectId: string): Promise<RetrospectiveReport> {
  return json(await fetch(`${BASE}/projects/${projectId}/ceremonies/retro`, { method: 'POST' }));
}

// --- Agent Chat (v3.8) ---
export async function chatWithAgent(projectId: string, agentId: string, message: string): Promise<{ response: string }> {
  return json(await fetch(`${BASE}/projects/${projectId}/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }));
}

// --- Reports (v3.5) ---
export async function fetchProjectReport(projectId: string): Promise<ProjectReport> {
  return json(await fetch(`${BASE}/projects/${projectId}/report`));
}
