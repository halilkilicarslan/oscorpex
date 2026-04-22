export interface AgentTool {
  id: string;
  name: string;
  description: string;
  type: string;
  parameters?: Record<string, unknown>;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  status: string;
  model: string;
  tools: AgentTool[];
  subAgents: unknown[];
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: 'calling' | 'done' | 'error';
  errorText?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: Date;
  isStreaming?: boolean;
}

export interface WorkflowInfo {
  id: string;
  name: string;
  purpose?: string;
  steps?: unknown[];
  status?: string;
}

export interface WorkflowExecution {
  executionId: string;
  status: string;
  result?: unknown;
}

export type EntityType = 'agent' | 'workflow' | 'tool';

export interface UnifiedEntity {
  id: string;
  name: string;
  description: string;
  type: EntityType;
  info: string;
  extra: string[];
}
