// ---------------------------------------------------------------------------
// AI Dev Studio — Data Models & Types
// ---------------------------------------------------------------------------

// ---- Project (Workspace) --------------------------------------------------

export type ProjectStatus =
  | 'planning'
  | 'approved'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  techStack: string[];
  repoPath: string;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

// ---- Project Plan ----------------------------------------------------------

export type PlanStatus = 'draft' | 'approved' | 'rejected';

export interface ProjectPlan {
  id: string;
  projectId: string;
  version: number;
  status: PlanStatus;
  phases: Phase[];
  createdAt: string;
}

// ---- Phase -----------------------------------------------------------------

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Phase {
  id: string;
  planId: string;
  name: string;
  order: number;
  status: PhaseStatus;
  tasks: Task[];
  dependsOn: string[]; // Phase IDs
}

// ---- Task ------------------------------------------------------------------

export type TaskStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'review'
  | 'done'
  | 'failed';

export type TaskComplexity = 'S' | 'M' | 'L';

export interface TaskOutput {
  filesCreated: string[];
  filesModified: string[];
  testResults?: { passed: number; failed: number; total: number };
  logs: string[];
}

export interface Task {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  assignedAgent: string;
  status: TaskStatus;
  complexity: TaskComplexity;
  dependsOn: string[]; // Task IDs
  branch: string;
  output?: TaskOutput;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
}

// ---- Agent Configuration ---------------------------------------------------

export type AgentRole =
  | 'pm'
  | 'designer'
  | 'architect'
  | 'frontend'
  | 'backend'
  | 'coder'
  | 'qa'
  | 'reviewer'
  | 'devops';

export type CLITool = 'claude-code' | 'codex' | 'aider' | 'none';

export interface AgentConfig {
  id: string;
  name: string;
  role: AgentRole;
  avatar: string;
  personality: string;
  model: string;
  cliTool: CLITool;
  skills: string[];
  systemPrompt: string;
  isPreset: boolean;
}

// ---- Agent Runtime State ---------------------------------------------------

export type AgentRuntimeStatus = 'idle' | 'working' | 'waiting' | 'error';

export interface AgentRuntime {
  agentId: string;
  projectId: string;
  containerId?: string;
  status: AgentRuntimeStatus;
  currentTaskId?: string;
  terminalBuffer: string[];
  branch: string;
  startedAt?: string;
}

// ---- Events ----------------------------------------------------------------

export type EventType =
  | 'task:assigned'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:retry'
  | 'agent:started'
  | 'agent:stopped'
  | 'agent:output'
  | 'agent:error'
  | 'phase:started'
  | 'phase:completed'
  | 'plan:created'
  | 'plan:approved'
  | 'execution:started'
  | 'escalation:user'
  | 'git:commit'
  | 'git:pr-created';

export interface StudioEvent {
  id: string;
  projectId: string;
  type: EventType;
  agentId?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ---- Chat Messages ---------------------------------------------------------

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  projectId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

// ---- Container Config (used by Container Manager) --------------------------

export interface VolumeMount {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface ContainerConfig {
  image: string;
  name: string;
  volumes: VolumeMount[];
  env: Record<string, string>;
  networkMode: string;
  memoryLimit: string;
  cpuLimit: number;
}

// ---- AI Providers ----------------------------------------------------------

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

// ---- Project Agent (proje bazlı takım üyesi) --------------------------------

export interface ProjectAgent {
  id: string;
  projectId: string;
  sourceAgentId?: string;
  name: string;
  role: AgentRole | string;
  avatar: string;
  personality: string;
  model: string;
  cliTool: CLITool;
  skills: string[];
  systemPrompt: string;
  createdAt: string;
  reportsTo?: string;      // ID of parent agent (null = top-level)
  color: string;           // hex color for org chart visualization
  pipelineOrder: number;   // execution order in workflow (0 = unordered)
}

// ---- Team Template (hazır takım şablonu) ------------------------------------

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  // agent_ids sütununda roller (ör: ["pm","frontend","qa"]) saklanır
  roles: string[];
  createdAt: string;
}

// ---- Agent Messages (ajan-arası iletişim) ----------------------------------

export type MessageType =
  | 'task_assignment'
  | 'task_complete'
  | 'review_request'
  | 'bug_report'
  | 'feedback'
  | 'notification';

export type MessageStatus = 'unread' | 'read' | 'archived';

export interface AgentMessage {
  id: string;
  projectId: string;
  fromAgentId: string;
  toAgentId: string;
  type: MessageType;
  subject: string;
  content: string;
  metadata: Record<string, any>;
  status: MessageStatus;
  parentMessageId?: string;
  createdAt: string;
  readAt?: string;
}

// ---- Pipeline Engine -------------------------------------------------------

// Bir pipeline aşamasının (stage) durumu
export type PipelineStageStatus = 'pending' | 'running' | 'completed' | 'failed';

// Genel pipeline durumu
export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

// Pipeline aşaması: aynı pipeline_order değerine sahip agent'lar ve görevler bir arada
export interface PipelineStage {
  order: number;
  agents: ProjectAgent[];
  tasks: Task[];
  status: PipelineStageStatus;
}

// Bir projenin anlık pipeline durumu (hem bellekte hem DB'de saklanır)
export interface PipelineState {
  projectId: string;
  stages: PipelineStage[];
  currentStage: number;
  status: PipelineStatus;
  startedAt?: string;
  completedAt?: string;
}

// Veritabanındaki pipeline_runs tablosuna karşılık gelen arayüz
export interface PipelineRun {
  id: string;
  projectId: string;
  currentStage: number;
  status: PipelineStatus;
  stagesJson: string;       // PipelineStage[] JSON olarak serileştirilmiş hali
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

// ---- Agent Process (yerel CLI süreç kaydı) ----------------------------------

/** Yerel agent sürecinin anlık durum değerleri */
export type AgentProcessStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

/** Bellek içi süreç kaydı — ChildProcess referansını da taşır */
export interface AgentProcessRecord {
  /** Benzersiz çalışma kimliği (agent_runs tablosunda da kullanılır) */
  id: string;
  projectId: string;
  agentId: string;
  agentName: string;
  cliTool: string;
  /** Node.js ChildProcess nesnesi — null ise süreç henüz başlamamış veya bitmiş */
  process: import('node:child_process').ChildProcess | null;
  status: AgentProcessStatus;
  /** Son OUTPUT_BUFFER_MAX satırı tutar (ring buffer) */
  output: string[];
  startedAt?: string;
  stoppedAt?: string;
  /** İşletim sistemi süreç kimliği */
  pid?: number;
  /** Süreç çıkış kodu; çalışırken undefined, sinyal ile sonlanırsa null */
  exitCode?: number | null;
}

// ---- Agent Run (veritabanı çalışma geçmişi) ---------------------------------

/** agent_runs tablosunun TypeScript yansıması */
export interface AgentRun {
  id: string;
  projectId: string;
  agentId: string;
  cliTool: string;
  status: AgentProcessStatus;
  taskPrompt?: string;
  outputSummary?: string;
  pid?: number;
  exitCode?: number | null;
  startedAt?: string;
  stoppedAt?: string;
  createdAt: string;
}

// ---- Git types -------------------------------------------------------------

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
}
