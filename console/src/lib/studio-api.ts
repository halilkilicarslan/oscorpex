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
  error?: string;
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
  reportsTo?: string;
  color: string;
  pipelineOrder: number;
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
  const data = await json(await fetch(`${BASE}/projects/${projectId}/pipeline/start`, { method: 'POST' }));
  return data.pipeline ?? data;
}

// Pipeline durumunu getir
export async function getPipelineStatus(projectId: string): Promise<PipelineState> {
  const data = await json(await fetch(`${BASE}/projects/${projectId}/pipeline/status`));
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
  const data = await json(await fetch(`${BASE}/projects/${projectId}/pipeline/advance`, { method: 'POST' }));
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
  agentId: string,
  onLine: (line: string, index: number) => void,
  onError?: (err: Error) => void,
): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

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
        payload?: { line?: string; index?: number };
      };

      // Yalnızca bu agent'ın output event'lerini filtrele
      if (
        event.type === 'agent:output' &&
        event.agentId === agentId &&
        event.payload
      ) {
        const { line, index } = event.payload;
        if (typeof line === 'string' && typeof index === 'number') {
          onLine(line, index);
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
  tasksPerAgent: { agentId: string; agentName: string; total: number; completed: number; completionRate: number }[];
  avgCompletionTimeMs: number | null;
  pipelineRunCount: number;
  pipelineSuccessRate: number;
}

export interface AgentAnalytics {
  agentId: string;
  agentName: string;
  role: string;
  color: string;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksFailed: number;
  runCount: number;
  totalRuntimeMs: number;
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

export interface AppStatus {
  running: boolean;
  backendUrl: string | null;
  frontendUrl: string | null;
}

export async function startApp(projectId: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/start`, { method: 'POST' }));
}

export async function stopApp(projectId: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/stop`, { method: 'POST' }));
}

export async function fetchAppStatus(projectId: string): Promise<AppStatus> {
  return json(await fetch(`${BASE}/projects/${projectId}/app/status`));
}

// ---- Docs Freshness -------------------------------------------------------

export interface DocFreshnessItem {
  file: string;
  status: 'filled' | 'tbd' | 'missing';
}

export async function fetchDocsFreshness(projectId: string): Promise<DocFreshnessItem[]> {
  return json(await fetch(`${BASE}/projects/${projectId}/docs/freshness`));
}
