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
  | 'architect'
  | 'frontend'
  | 'backend'
  | 'qa'
  | 'reviewer'
  | 'devops'
  | 'coder';

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
