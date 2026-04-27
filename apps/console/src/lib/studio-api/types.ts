// ---------------------------------------------------------------------------
// Oscorpex — Shared API Types
// ---------------------------------------------------------------------------

/** Agent-level CLI tool selection (execution adapter). */
export type AgentCliTool = 'claude-code' | 'codex' | 'cursor' | 'none';
/** @deprecated Use AgentCliTool instead. */
export type CLITool = AgentCliTool;

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'planning' | 'approved' | 'running' | 'paused' | 'completed' | 'failed' | 'maintenance' | 'archived';
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
  revisionCount: number;
  assignedAgentId?: string;
  // Human-in-the-Loop onay alanları
  requiresApproval: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | null;
  approvalRejectionReason?: string;
  // v3.0: Micro-task decomposition
  parentTaskId?: string;
  targetFiles?: string[];
  estimatedLines?: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  avatar: string;
  personality: string;
  model: string;
  cliTool: AgentCliTool;
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
  cliTool: AgentCliTool;
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
  agentId?: string;
  createdAt: string;
}

export interface Progress {
  phases: { id: string; name: string; status: string; tasksDone: number; tasksTotal: number }[];
  overall: { total: number; done: number; running: number; failed: number; queued: number };
}

export interface ProjectTemplateInfo {
  id: string;
  name: string;
  description: string;
  techStack: string[];
  teamTemplate: string;
}

export interface ApproveResult {
  success: boolean;
  planId: string;
  execution: { started: boolean };
  pipeline: { started: boolean; warning?: string };
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

// ---------------------------------------------------------------------------
// v3.0 B1 — Interactive Planner: Intake Questions
// ---------------------------------------------------------------------------

export type IntakeQuestionStatus = 'pending' | 'answered' | 'skipped';

export type IntakeQuestionCategory =
  | 'scope'
  | 'functional'
  | 'nonfunctional'
  | 'priority'
  | 'technical'
  | 'general';

export interface IntakeQuestion {
  id: string;
  projectId: string;
  question: string;
  options: string[];
  category: IntakeQuestionCategory;
  status: IntakeQuestionStatus;
  answer?: string;
  planVersion?: number;
  createdAt: string;
  answeredAt?: string;
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

// ---- Mesajlaşma Tipleri ---------------------------------------------------

// Ajan mesaj türleri
export type AgentMessageType =
  | 'task_assignment'
  | 'task_complete'
  | 'review_request'
  | 'bug_report'
  | 'feedback'
  | 'notification'
  // v3.6: Agent ceremonies & communication
  | 'standup'
  | 'retrospective'
  | 'conflict'
  | 'help_request'
  | 'pair_session'
  | 'handoff_doc';

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

export interface GitStatusResult {
  modified: string[];
  untracked: string[];
  staged: string[];
  deleted: string[];
}

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

export type SettingsMap = Record<string, Record<string, string>>;

export type PolicyAction = 'block' | 'warn' | 'require_approval';

export interface PolicyRule {
  id: string;
  projectId: string;
  name: string;
  /** Supported patterns: `complexity == S|M|L|XL`, `title contains <text>`,
   *  `branch == <branch>`, `description contains <text>` */
  condition: string;
  action: PolicyAction | string;
  enabled: boolean;
}

export interface MemoryFact {
  projectId: string;
  scope: string;
  key: string;
  value: string;
  confidence: number;
  /** "user" = manuel girilmis; diger degerler (system, agent vs.) otomatik. */
  source: string;
  updatedAt: string;
}

export interface MemorySnapshot {
  kind: string;
  summary: Record<string, unknown>;
  sourceVersion: number;
  updatedAt: string;
}

export interface DocFreshnessItem {
  file: string;
  status: 'filled' | 'tbd' | 'missing';
}

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

/** @deprecated Use GitStatusResult instead. */
export type GitStatus = GitStatusResult;

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface RevertResult {
  success: boolean;
  revertCommit: string;
  originalCommit: string;
}

export interface BranchesResult {
  branches: string[];
  current: string;
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  source?: string;
  target?: string;
}

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

export interface LifecycleInfo {
  projectId: string;
  currentStatus: string;
  allowedTransitions: string[];
}

export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom' | 'cli';
export type ProviderCliTool = 'claude' | 'codex' | 'gemini' | 'cursor';
/** @deprecated Use ProviderCliTool instead. */
export type CliTool = ProviderCliTool;

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
  /** Only for type='cli': which local CLI to spawn (claude/codex/gemini). */
  cliTool?: ProviderCliTool;
  createdAt: string;
  updatedAt: string;
}

// Backend createProvider yalnizca bu alanlari zorunlu tutar; fallbackOrder
// ayri bir endpoint ile guncellenir.
export type ProviderCreateInput = Pick<
  AIProvider,
  'name' | 'type' | 'apiKey' | 'baseUrl' | 'model' | 'isActive' | 'cliTool'
>;

export type CLIProviderId = 'claude' | 'codex' | 'gemini' | 'cursor';
export type QuotaStatus = 'healthy' | 'warning' | 'critical' | 'depleted' | 'unknown';

export interface ProviderProbePermission {
  enabled: boolean;
  allowAuthFileRead: boolean;
  allowNetworkProbe: boolean;
  refreshIntervalSec: number;
}

export interface UsageQuota {
  type: 'session' | 'weekly' | 'daily' | 'model_specific' | 'credits';
  label: string;
  percentRemaining?: number;
  percentUsed?: number;
  resetsAt?: string;
  resetText?: string;
  dollarRemaining?: number;
  status: QuotaStatus;
}

export interface GlobalUsageSnapshot {
  quotas: UsageQuota[];
  dailyUsage?: { tokens: number; costUsd: number; sessionCount: number; workingTimeMs: number };
  weeklyUsage?: { tokens: number; costUsd: number };
  accountTier?: string;
  accountEmail?: string;
  source: 'cli_usage' | 'cli_cost' | 'local_jsonl' | 'provider_api' | 'unavailable';
  confidence: 'high' | 'medium' | 'low';
}

export interface OscorpexUsageSnapshot {
  todayTokens: number;
  weekTokens: number;
  todayCostUsd: number;
  weekCostUsd: number;
  runCount: number;
  failureCount: number;
  projectBreakdown: Array<{ projectId: string; projectName: string; tokens: number; costUsd: number }>;
}

export interface UsageAttribution {
  comparable: boolean;
  oscorpexSharePercent?: number;
  externalSharePercent?: number;
  reason?: string;
}

export interface CLIUsageTrendPoint {
  providerId: CLIProviderId;
  capturedAt: string;
  source: GlobalUsageSnapshot['source'];
  confidence: GlobalUsageSnapshot['confidence'];
  worstStatus: QuotaStatus;
  lowestPercentRemaining?: number;
}

export interface CLIProbeEvent {
  id: string;
  providerId: CLIProviderId;
  status: string;
  message: string;
  createdAt: string;
}

export interface CLIUsageSnapshot {
  providerId: CLIProviderId;
  label: string;
  installed: boolean;
  binaryPath?: string;
  version?: string;
  authStatus: 'connected' | 'missing' | 'expired' | 'unknown' | 'not_supported';
  global: GlobalUsageSnapshot | null;
  oscorpex: OscorpexUsageSnapshot;
  attribution: UsageAttribution | null;
  permissions: ProviderProbePermission;
  lastCheckedAt: string;
  errors: string[];
}

// Backend sunar color ve pipelineOrder icin default degerler; form bunlari
// gondermeden de ajan olusturabilir.
export type ProjectAgentCreateInput = Omit<
  ProjectAgent,
  'id' | 'projectId' | 'createdAt' | 'color' | 'pipelineOrder'
> &
  Partial<Pick<ProjectAgent, 'color' | 'pipelineOrder'>>;

export interface CustomTeamTemplate {
  id: string;
  name: string;
  description: string;
  roles: string[];
  dependencies: { from: string; to: string; type: DependencyType }[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Provider Telemetry (EPIC 3 — execution observability)
// ---------------------------------------------------------------------------

export type ProviderErrorClassification =
  | 'unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'killed'
  | 'tool_restriction_unsupported'
  | 'cli_error'
  | 'spawn_failure'
  | 'unknown';

export interface FallbackEntry {
  timestamp: string;
  fromProvider: string;
  toProvider: string;
  reason: string;
  errorClassification: ProviderErrorClassification;
  latencyMs: number;
}

export interface ProviderExecutionTelemetry {
  runId: string;
  taskId: string;
  startedAt: string;
  completedAt?: string;
  primaryProvider: string;
  finalProvider?: string;
  success: boolean;
  latencyMs: number;
  fallbackCount: number;
  fallbackTimeline: FallbackEntry[];
  errorClassification?: ProviderErrorClassification;
  errorMessage?: string;
  retryReason?: string;
  degradedMode?: boolean;
  degradedMessage?: string;
  canceled?: boolean;
  cancelReason?: string;
  queueWaitMs?: number;
}

export interface ProviderLatencySnapshot {
  providerId: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  lastFailureAt?: string;
  lastFailureClassification?: ProviderErrorClassification;
}

// ---- Performance Config (Admin Settings) ---------------------------------

export interface PerformanceFeatureFlags {
  adaptiveConcurrency: boolean;
  fairScheduling: boolean;
  fallbackDecisionMotor: boolean;
  retryPolicy: boolean;
  providerRuntimeCache: boolean;
  providerHealthCache: boolean;
  costAwareModelSelection: boolean;
  preflightWarmup: boolean;
  providerCooldown: boolean;
  timeoutPolicy: boolean;
  queueWaitTelemetry: boolean;
}

export interface AdaptiveConcurrencyConfig {
  defaultMax: number;
  adjustmentIntervalMs: number;
  failureRateThreshold: number;
  queueDepthThreshold: number;
}

export interface RetryPolicyConfig {
  maxAutoRetries: number;
  baseBackoffMs: number;
}

export interface TimeoutPolicyConfig {
  complexityBaseMs: { S: number; M: number; L: number; XL: number };
  providerMultipliers: Record<string, number>;
}

export interface CooldownConfig {
  durationsMs: {
    unavailable: number;
    spawn_failure: number;
    repeated_timeout: number;
  };
}

export interface DbPoolConfig {
  minConnections: number;
  maxConnections: number;
  idleTimeoutMs: number;
  acquireTimeoutMs: number;
}

export interface PerformanceConfigSnapshot {
  features: PerformanceFeatureFlags;
  adaptiveConcurrency: AdaptiveConcurrencyConfig;
  retryPolicy: RetryPolicyConfig;
  timeoutPolicy: TimeoutPolicyConfig;
  cooldown: CooldownConfig;
  dbPool: DbPoolConfig;
}

// ---------------------------------------------------------------------------
// Provider Runtime State (Admin Settings)
// ---------------------------------------------------------------------------

export type CooldownTrigger =
  | 'unavailable'
  | 'spawn_failure'
  | 'rate_limited'
  | 'repeated_timeout'
  | 'cli_error'
  | 'manual';

export interface ProviderRuntimeState {
  adapter: string;
  rateLimited: boolean;
  cooldownUntil: string | null;
  consecutiveFailures: number;
  lastSuccess: string | null;
  lastCooldownTrigger?: CooldownTrigger;
  lastCooldownAt?: string;
}

export type ProviderPolicyProfile =
  | 'balanced'
  | 'cheap'
  | 'quality'
  | 'local-first'
  | 'fallback-heavy';
