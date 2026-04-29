import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  MessageSquare,
  Footprints,
  Layers,
  Search,
  ChevronDown,
  ChevronRight,
  Trash2,
  Clock,
  User,
  Bot,
  Wrench,
  AlertCircle,
  GitBranch,
} from 'lucide-react';
import { observabilityDelete, observabilityGet } from '../lib/observability-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Conversation {
  id: string;
  resource_id: string;
  user_id: string;
  title: string;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at: string | null;
}

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface Message {
  conversation_id: string;
  message_id: string;
  user_id: string;
  role: string;
  parts: MessagePart[];
  metadata: unknown;
  format_version: number;
  created_at: string;
}

interface Step {
  id: string;
  conversation_id: string;
  agent_id: string;
  agent_name: string | null;
  step_index: number;
  type: string;
  role: string;
  content: string | null;
  arguments: unknown;
  result: unknown;
  usage: { inputTokens?: number; outputTokens?: number } | null;
  sub_agent_name: string | null;
  created_at: string;
}

interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  steps: Step[];
}

interface Stats {
  totalConversations: number;
  totalMessages: number;
  totalSteps: number;
  byAgent: Array<{ name: string; conversations: number; messages: number }>;
  totalWorkflows: number;
}

interface Workflow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: unknown;
  events: unknown;
  context: unknown;
  user_id: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  return observabilityGet<T>(`/memory${path}`);
}

async function apiDelete(path: string): Promise<void> {
  await observabilityDelete(`/memory${path}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractText(parts: MessagePart[]): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text ?? '')
    .join('\n');
}

function jsonPreview(value: unknown, maxLen = 120): string {
  if (value === null || value === undefined) return '—';
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

// ---------------------------------------------------------------------------
// Agent badge colors
// ---------------------------------------------------------------------------

const AGENT_COLORS: Record<string, string> = {
  assistant: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20',
  researcher: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20',
  'code-assistant': 'bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/20',
  translator: 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20',
  summarizer: 'bg-[#ec4899]/10 text-[#ec4899] border-[#ec4899]/20',
};

function agentBadgeClass(name: string): string {
  return AGENT_COLORS[name] ?? 'bg-[#525252]/10 text-[#a3a3a3] border-[#525252]/20';
}

// ---------------------------------------------------------------------------
// Workflow status badge
// ---------------------------------------------------------------------------

const WORKFLOW_STATUS_COLORS: Record<string, string> = {
  running: 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20',
  completed: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20',
  failed: 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20',
  suspended: 'bg-[#f97316]/10 text-[#f97316] border-[#f97316]/20',
};

function workflowStatusClass(status: string): string {
  return (
    WORKFLOW_STATUS_COLORS[status] ?? 'bg-[#525252]/10 text-[#a3a3a3] border-[#525252]/20'
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-[11px] text-[#525252] font-medium">{label}</div>
        <div className="text-lg font-bold text-[#fafafa] leading-tight">{value}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepBlock — collapsible tool call / step display
// ---------------------------------------------------------------------------

function StepBlock({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const isToolCall = step.type === 'tool-call' || step.type === 'tool_call';

  return (
    <div className="mt-2 rounded-lg border border-[#262626] overflow-hidden text-[12px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] hover:bg-[#222] transition-colors text-left"
      >
        {open ? (
          <ChevronDown size={12} className="text-[#525252] shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-[#525252] shrink-0" />
        )}
        {isToolCall ? (
          <Wrench size={12} className="text-[#a855f7] shrink-0" />
        ) : (
          <Footprints size={12} className="text-[#3b82f6] shrink-0" />
        )}
        <span className="text-[#a3a3a3] font-medium">
          {isToolCall ? 'Tool call' : step.type}
          {step.agent_name && (
            <span className="text-[#525252] font-normal ml-1">via {step.agent_name}</span>
          )}
        </span>
        {step.usage && (
          <span className="ml-auto text-[#525252] font-mono text-[10px] shrink-0">
            {(step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0)} tok
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 py-2 bg-[#111111] border-t border-[#262626] space-y-2">
          {step.content && (
            <div>
              <div className="text-[10px] text-[#525252] font-medium mb-1">Content</div>
              <pre className="text-[#a3a3a3] whitespace-pre-wrap break-words text-[11px] font-mono">
                {step.content}
              </pre>
            </div>
          )}
          {step.arguments !== null && step.arguments !== undefined && (
            <div>
              <div className="text-[10px] text-[#525252] font-medium mb-1">Arguments</div>
              <pre className="text-[#a3a3a3] whitespace-pre-wrap break-words text-[11px] font-mono bg-[#0d0d0d] rounded p-2">
                {jsonPreview(step.arguments, 500)}
              </pre>
            </div>
          )}
          {step.result !== null && step.result !== undefined && (
            <div>
              <div className="text-[10px] text-[#525252] font-medium mb-1">Result</div>
              <pre className="text-[#a3a3a3] whitespace-pre-wrap break-words text-[11px] font-mono bg-[#0d0d0d] rounded p-2">
                {jsonPreview(step.result, 500)}
              </pre>
            </div>
          )}
          {step.usage && (
            <div className="flex gap-4 text-[10px] text-[#525252]">
              <span>Input: {step.usage.inputTokens ?? 0} tokens</span>
              <span>Output: {step.usage.outputTokens ?? 0} tokens</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ message, steps }: { message: Message; steps: Step[] }) {
  const isUser = message.role === 'user';
  const text = extractText(message.parts);
  // Steps that belong to this message (by timestamp proximity / index)
  const relatedSteps = steps.filter(
    (s) => s.role === 'assistant' && !isUser,
  );

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[85%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Role badge */}
        <div className={`flex items-center gap-1.5 mb-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {isUser ? (
            <User size={12} className="text-[#525252]" />
          ) : (
            <Bot size={12} className="text-[#22c55e]" />
          )}
          <span className="text-[11px] text-[#525252] font-medium">
            {isUser ? 'User' : 'Assistant'}
          </span>
          <span className="text-[10px] text-[#3a3a3a]">{relativeTime(message.created_at)}</span>
        </div>

        {/* Bubble */}
        <div
          className={`rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
            isUser
              ? 'bg-[#1f1f1f] text-[#e5e5e5] border border-[#2a2a2a]'
              : 'bg-[#111111] text-[#d4d4d4] border border-[#1f1f1f]'
          }`}
        >
          {text ? (
            <p className="whitespace-pre-wrap break-words">{text}</p>
          ) : (
            <p className="text-[#525252] italic text-[12px]">[no text content]</p>
          )}

          {/* Steps only shown inside assistant bubbles */}
          {!isUser && relatedSteps.length > 0 && (
            <div className="mt-3 space-y-1">
              {relatedSteps.map((step) => (
                <StepBlock key={step.id} step={step} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConversationDetail (right panel)
// ---------------------------------------------------------------------------

function ConversationDetail({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<ConversationDetail>(`/conversations/${conversationId}`)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [conversationId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle size={24} className="text-[#ef4444]" />
          <p className="text-[13px] text-[#525252]">{error ?? 'Not found'}</p>
        </div>
      </div>
    );
  }

  const { conversation, messages, steps } = data;

  // Group steps per message (rough: all assistant steps shown once in first assistant msg)
  // We render steps attached to their message by step_index order, not per-message
  const assistantSteps = steps.filter((s) => s.role !== 'user');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#1f1f1f] bg-[#0d0d0d] shrink-0">
        <h2 className="text-[14px] font-semibold text-[#fafafa] truncate">{conversation.title}</h2>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${agentBadgeClass(
              conversation.resource_id,
            )}`}
          >
            {conversation.resource_id}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-[#525252]">
            <Clock size={11} />
            {fmtDate(conversation.created_at)}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-[#525252]">
            <MessageSquare size={11} />
            {messages.length} messages
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare size={28} className="text-[#333] mb-3" />
            <p className="text-[13px] text-[#525252]">No messages in this conversation</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble
              key={`${msg.conversation_id}-${msg.message_id}-${idx}`}
              message={msg}
              steps={msg.role === 'assistant' ? assistantSteps : []}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowsTab
// ---------------------------------------------------------------------------

function WorkflowRow({ workflow }: { workflow: Workflow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-[#1f1f1f] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#141414] transition-colors text-left"
      >
        <span className="text-[#525252] shrink-0">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <GitBranch size={14} className="text-[#525252] shrink-0" />
        <span className="flex-1 text-[13px] text-[#fafafa] font-medium truncate">
          {workflow.workflow_name}
        </span>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${workflowStatusClass(
            workflow.status,
          )}`}
        >
          {workflow.status}
        </span>
        <span className="text-[11px] text-[#525252] w-32 text-right shrink-0">
          {fmtDate(workflow.created_at)}
        </span>
        <span className="text-[11px] text-[#525252] w-32 text-right shrink-0">
          {fmtDate(workflow.updated_at)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[#1f1f1f] bg-[#0d0d0d] p-4 space-y-3">
          {workflow.input !== null && (
            <div>
              <div className="text-[10px] text-[#525252] font-medium mb-1">Input</div>
              <pre className="text-[12px] text-[#a3a3a3] font-mono bg-[#111111] border border-[#262626] rounded-lg p-3 whitespace-pre-wrap break-words">
                {jsonPreview(workflow.input, 1000)}
              </pre>
            </div>
          )}
          {workflow.output !== null && (
            <div>
              <div className="text-[10px] text-[#525252] font-medium mb-1">Output</div>
              <pre className="text-[12px] text-[#a3a3a3] font-mono bg-[#111111] border border-[#262626] rounded-lg p-3 whitespace-pre-wrap break-words">
                {jsonPreview(workflow.output, 1000)}
              </pre>
            </div>
          )}
          {workflow.events !== null && (
            <div>
              <div className="text-[10px] text-[#525252] font-medium mb-1">Events</div>
              <pre className="text-[12px] text-[#a3a3a3] font-mono bg-[#111111] border border-[#262626] rounded-lg p-3 whitespace-pre-wrap break-words">
                {jsonPreview(workflow.events, 1000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkflowsTab() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    apiFetch<{ workflows: Workflow[]; total: number }>(`/workflows${qs}`)
      .then((data) => {
        setWorkflows(data.workflows);
        setTotal(data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-5">
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#111111] border border-[#262626] text-[13px] text-[#a3a3a3] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#333]"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="suspended">Suspended</option>
        </select>
        <span className="text-[12px] text-[#525252]">{total} workflows</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#1f1f1f] flex items-center justify-center mb-3">
            <GitBranch size={24} className="text-[#333]" />
          </div>
          <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No workflows</h3>
          <p className="text-[12px] text-[#525252]">Workflow states will appear here when workflows run.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 text-[11px] text-[#525252] font-medium">
            <span className="w-4 shrink-0" />
            <span className="w-4 shrink-0" />
            <span className="flex-1">Workflow</span>
            <span className="w-24 text-right shrink-0">Status</span>
            <span className="w-32 text-right shrink-0">Created</span>
            <span className="w-32 text-right shrink-0">Updated</span>
          </div>
          {workflows.map((wf) => (
            <WorkflowRow key={wf.id} workflow={wf} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main MemoryPage
// ---------------------------------------------------------------------------

export default function MemoryPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [totalConversations, setTotalConversations] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'conversations' | 'workflows'>('conversations');
  const [loadingList, setLoadingList] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load stats once
  useEffect(() => {
    apiFetch<Stats>('/stats')
      .then(setStats)
      .catch(console.error);
  }, []);

  // Load conversations list
  const loadConversations = useCallback(() => {
    setLoadingList(true);
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (agentFilter) params.set('agent', agentFilter);
    apiFetch<{ conversations: Conversation[]; total: number }>(
      `/conversations?${params.toString()}`,
    )
      .then((data) => {
        setConversations(data.conversations);
        setTotalConversations(data.total);
      })
      .catch(console.error)
      .finally(() => setLoadingList(false));
  }, [agentFilter]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Filter by search client-side
  const filteredConversations = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.resource_id.toLowerCase().includes(q)
    );
  });

  // Delete conversation
  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await apiDelete(`/conversations/${id}`);
        if (selectedId === id) setSelectedId(null);
        loadConversations();
        // Refresh stats
        apiFetch<Stats>('/stats')
          .then(setStats)
          .catch(console.error);
      } catch (err) {
        console.error('Delete failed', err);
      } finally {
        setDeletingId(null);
        setConfirmDeleteId(null);
      }
    },
    [selectedId, loadConversations],
  );

  // All unique agent names from loaded conversations
  const agentNames = Array.from(new Set(conversations.map((c) => c.resource_id))).sort();

  const hasAnyData =
    stats !== null &&
    (stats.totalConversations > 0 || stats.totalWorkflows > 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-[#1a1a1a] shrink-0">
        <h1 className="text-xl font-semibold text-[#fafafa]">Memory</h1>
        <p className="text-sm text-[#737373] mt-0.5">
          Agent memory — conversations, messages, and workflow states
        </p>
      </div>

      {/* Stats row */}
      <div className="px-6 py-4 border-b border-[#1a1a1a] shrink-0">
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Conversations"
            value={stats?.totalConversations ?? 0}
            icon={<MessageSquare size={16} className="text-[#22c55e]" />}
          />
          <StatCard
            label="Messages"
            value={stats?.totalMessages ?? 0}
            icon={<MessageSquare size={16} className="text-[#3b82f6]" />}
          />
          <StatCard
            label="Steps"
            value={stats?.totalSteps ?? 0}
            icon={<Footprints size={16} className="text-[#a855f7]" />}
          />
          <StatCard
            label="Workflows"
            value={stats?.totalWorkflows ?? 0}
            icon={<Layers size={16} className="text-[#f59e0b]" />}
          />
        </div>
      </div>

      {/* Tab toggle */}
      <div className="px-6 py-3 border-b border-[#1a1a1a] flex items-center gap-2 shrink-0">
        <button
          onClick={() => setTab('conversations')}
          className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            tab === 'conversations'
              ? 'bg-[#1f1f1f] text-[#fafafa] border border-[#333]'
              : 'text-[#525252] hover:text-[#a3a3a3]'
          }`}
        >
          Conversations
          <span className="ml-1.5 text-[11px] text-[#525252]">{totalConversations}</span>
        </button>
        <button
          onClick={() => setTab('workflows')}
          className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
            tab === 'workflows'
              ? 'bg-[#1f1f1f] text-[#fafafa] border border-[#333]'
              : 'text-[#525252] hover:text-[#a3a3a3]'
          }`}
        >
          Workflows
          <span className="ml-1.5 text-[11px] text-[#525252]">{stats?.totalWorkflows ?? 0}</span>
        </button>
      </div>

      {/* Content */}
      {tab === 'workflows' ? (
        <WorkflowsTab />
      ) : !hasAnyData && !loadingList ? (
        // Empty state
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="w-20 h-20 rounded-2xl bg-[#111111] border border-[#262626] flex items-center justify-center mb-5">
            <Brain size={36} className="text-[#333]" />
          </div>
          <h2 className="text-[16px] font-semibold text-[#a3a3a3] mb-2">No conversations yet</h2>
          <p className="text-[13px] text-[#525252] max-w-sm leading-relaxed">
            Agent memory will be stored here as users interact with agents through the dashboard.
          </p>
        </div>
      ) : (
        // Split view
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel — Conversation list */}
          <div className="w-[35%] border-r border-[#1a1a1a] flex flex-col overflow-hidden">
            {/* Filters */}
            <div className="p-3 border-b border-[#1a1a1a] space-y-2 shrink-0">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]"
                />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[#111111] border border-[#262626] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333]"
                />
              </div>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="w-full bg-[#111111] border border-[#262626] rounded-lg px-3 py-1.5 text-[12px] text-[#a3a3a3] focus:outline-none focus:border-[#333]"
              >
                <option value="">All agents</option>
                {agentNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loadingList ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <MessageSquare size={22} className="text-[#333] mb-2" />
                  <p className="text-[12px] text-[#525252]">No conversations found</p>
                </div>
              ) : (
                filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`group relative px-4 py-3 border-b border-[#1a1a1a] cursor-pointer transition-colors ${
                      selectedId === conv.id
                        ? 'bg-[#1a1a1a] border-l-2 border-l-[#22c55e]'
                        : 'hover:bg-[#141414]'
                    }`}
                  >
                    {/* Agent badge */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${agentBadgeClass(
                          conv.resource_id,
                        )}`}
                      >
                        {conv.resource_id}
                      </span>
                    </div>

                    {/* Title */}
                    <p className="text-[12px] text-[#d4d4d4] font-medium truncate pr-8">
                      {conv.title}
                    </p>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-[10px] text-[#525252]">
                        <MessageSquare size={9} />
                        {conv.message_count}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-[#525252]">
                        <Clock size={9} />
                        {relativeTime(conv.last_message_at ?? conv.updated_at)}
                      </span>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(conv.id);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-[#2a2a2a] transition-all"
                      title="Delete conversation"
                    >
                      {deletingId === conv.id ? (
                        <div className="w-3 h-3 rounded-full border border-[#525252] border-t-transparent animate-spin" />
                      ) : (
                        <Trash2 size={13} className="text-[#525252] hover:text-[#ef4444]" />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right panel — Detail */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedId ? (
              <ConversationDetail key={selectedId} conversationId={selectedId} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                <div className="w-14 h-14 rounded-2xl bg-[#111111] border border-[#262626] flex items-center justify-center mb-3">
                  <MessageSquare size={22} className="text-[#333]" />
                </div>
                <p className="text-[13px] text-[#a3a3a3] font-medium mb-1">
                  Select a conversation
                </p>
                <p className="text-[12px] text-[#525252]">
                  Click a conversation on the left to view its messages and steps.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-[#111111] border border-[#262626] rounded-xl p-6 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-[#ef4444]/10 flex items-center justify-center">
                <Trash2 size={16} className="text-[#ef4444]" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-[#fafafa]">Delete conversation</h3>
                <p className="text-[11px] text-[#525252]">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-[12px] text-[#a3a3a3] mb-5">
              All messages and steps in this conversation will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 px-3 py-2 rounded-lg border border-[#262626] text-[12px] text-[#a3a3a3] hover:border-[#333] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 px-3 py-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30 text-[12px] text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
