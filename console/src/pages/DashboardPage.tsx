import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Bot,
  Workflow,
  Wrench,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Play,
  X,
  Loader2,
} from 'lucide-react';
import { fetchAgents, fetchWorkflows, executeWorkflow } from '../lib/api';
import type { AgentInfo, WorkflowInfo, AgentTool, EntityType, UnifiedEntity } from '../types';

type FilterTab = 'all' | 'agents' | 'workflows' | 'tools';
type SortField = 'name' | 'type';
type SortDir = 'asc' | 'desc';

function TypeBadge({ type }: { type: EntityType }) {
  const styles: Record<EntityType, string> = {
    agent: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20',
    workflow: 'bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/20',
    tool: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20',
  };
  const icons: Record<EntityType, React.ReactNode> = {
    agent: <Bot size={12} />,
    workflow: <Workflow size={12} />,
    tool: <Wrench size={12} />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles[type]}`}
    >
      {icons[type]}
      {type}
    </span>
  );
}

function ExtraBadge({ text, variant }: { text: string; variant: 'green' | 'blue' | 'purple' | 'gray' }) {
  const colors = {
    green: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20',
    blue: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20',
    purple: 'bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/20',
    gray: 'bg-[#525252]/10 text-[#a3a3a3] border-[#525252]/20',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${colors[variant]}`}>
      {text}
    </span>
  );
}

// ---------- Workflow Execute Modal ----------

interface WorkflowExecuteModalProps {
  workflow: WorkflowInfo;
  onClose: () => void;
}

function WorkflowExecuteModal({ workflow, onClose }: WorkflowExecuteModalProps) {
  const [inputJson, setInputJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const validateJson = (value: string) => {
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputJson(e.target.value);
    validateJson(e.target.value);
  };

  const handleExecute = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(inputJson);
    } catch {
      setJsonError('Invalid JSON — fix before executing');
      return;
    }

    setRunning(true);
    setResult(null);
    setExecError(null);

    try {
      const data = await executeWorkflow(workflow.id, parsed);
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg mx-4 bg-[#0a0a0a] border border-[#262626] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#262626]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[#a855f7]/10 flex items-center justify-center">
              <Workflow size={14} className="text-[#a855f7]" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-[#fafafa]">Execute Workflow</h2>
              <p className="text-[11px] text-[#525252]">{workflow.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#737373] hover:text-[#fafafa] hover:bg-[#1f1f1f] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#525252] uppercase tracking-wider mb-2">
              Input (JSON)
            </label>
            <textarea
              value={inputJson}
              onChange={handleInputChange}
              rows={6}
              spellCheck={false}
              className={`w-full bg-[#111111] border rounded-lg px-3 py-2.5 text-[12px] font-mono text-[#fafafa] placeholder:text-[#525252] outline-none resize-none transition-colors ${
                jsonError
                  ? 'border-red-500/50 focus:border-red-500/80'
                  : 'border-[#262626] focus:border-[#333]'
              }`}
            />
            {jsonError && (
              <p className="mt-1 text-[11px] text-red-400">{jsonError}</p>
            )}
          </div>

          {/* Result */}
          {result !== null && (
            <div>
              <label className="block text-[11px] font-semibold text-[#525252] uppercase tracking-wider mb-2">
                Result
              </label>
              <pre className="w-full bg-[#111111] border border-[#22c55e]/20 rounded-lg px-3 py-2.5 text-[12px] font-mono text-[#22c55e] overflow-auto max-h-40 whitespace-pre-wrap break-all">
                {result}
              </pre>
            </div>
          )}

          {/* Exec error */}
          {execError !== null && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2.5">
              <p className="text-[12px] text-red-400">{execError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#262626]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium text-[#a3a3a3] hover:text-[#fafafa] hover:bg-[#1f1f1f] transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleExecute}
            disabled={running || !!jsonError}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[#a855f7]/10 text-[#a855f7] hover:bg-[#a855f7]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={10} />
            )}
            {running ? 'Executing...' : 'Execute'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Helpers ----------

/** Extract { paramName: type } pairs from a JSON Schema parameters object */
function extractParamBadges(parameters: Record<string, unknown>): string[] {
  const props =
    (parameters.properties as Record<string, { type?: string }> | undefined) ??
    (parameters as Record<string, { type?: string }>);

  return Object.entries(props)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([name, schema]) => {
      const type = (schema as { type?: string }).type ?? 'any';
      return `${name} ${type}`;
    });
}

// ---------- Props ----------

interface DashboardPageProps {
  onTestAgent?: (agent: AgentInfo) => void;
}

export default function DashboardPage({ onTestAgent }: DashboardPageProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [executeWorkflowTarget, setExecuteWorkflowTarget] = useState<WorkflowInfo | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentsData, workflowsData] = await Promise.all([
        fetchAgents().catch(() => [] as AgentInfo[]),
        fetchWorkflows().catch(() => [] as WorkflowInfo[]),
      ]);
      setAgents(agentsData);
      setWorkflows(workflowsData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build unified entity list
  const entities: UnifiedEntity[] = [];

  for (const agent of agents) {
    entities.push({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      type: 'agent',
      info: agent.model,
      extra: agent.tools.map((t) => t.name),
    });
  }

  for (const wf of workflows) {
    entities.push({
      id: wf.id,
      name: wf.name,
      description: wf.purpose ?? '',
      type: 'workflow',
      info: wf.status ?? 'Idle',
      extra: wf.steps ? [`${wf.steps.length} steps`] : [],
    });
  }

  // Extract tools from agents (deduplicated)
  const toolMap = new Map<string, AgentTool>();
  for (const agent of agents) {
    for (const tool of agent.tools) {
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
      }
    }
  }
  for (const tool of toolMap.values()) {
    const paramBadges = tool.parameters ? extractParamBadges(tool.parameters) : [];
    entities.push({
      id: tool.id ?? tool.name,
      name: tool.name,
      description: tool.description,
      type: 'tool',
      info: 'Ready',
      extra: paramBadges,
    });
  }

  // Filter
  const filtered = entities.filter((e) => {
    if (filter !== 'all' && e.type !== filter.slice(0, -1)) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q);
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    const aVal = sortField === 'name' ? a.name : a.type;
    const bVal = sortField === 'name' ? b.name : b.type;
    const cmp = aVal.localeCompare(bVal);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: entities.length },
    { key: 'agents', label: 'Agents', count: agents.length },
    { key: 'workflows', label: 'Workflows', count: workflows.length },
    { key: 'tools', label: 'Tools', count: toolMap.size },
  ];

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-[#a3a3a3]" />
    ) : (
      <ChevronDown size={12} className="text-[#a3a3a3]" />
    );
  };

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#fafafa]">
          Agents, Workflows & Tools
        </h1>
        <p className="text-sm text-[#737373] mt-1">
          Manage your AI agents, direct tools, and automated workflows
        </p>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents, workflows, tools..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#141414] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder:text-[#525252] outline-none focus:border-[#333]"
          />
        </div>

        <div className="flex items-center bg-[#141414] border border-[#262626] rounded-lg overflow-hidden">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                filter === tab.key
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#737373] hover:text-[#a3a3a3]'
              }`}
            >
              {tab.label}
              <span className="ml-1 text-[10px] text-[#525252]">{tab.count}</span>
            </button>
          ))}
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="p-1.5 rounded-lg text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Table */}
      <div className="border border-[#262626] rounded-xl overflow-hidden bg-[#0a0a0a]">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_2fr_1fr_1.5fr_auto] gap-4 px-4 py-2.5 bg-[#111111] border-b border-[#262626] text-[11px] font-semibold text-[#525252] uppercase tracking-wider">
          <button
            onClick={() => toggleSort('name')}
            className="flex items-center gap-1 hover:text-[#a3a3a3] transition-colors text-left"
          >
            Name <SortIcon field="name" />
          </button>
          <span>Details</span>
          <span>Info</span>
          <span>Extra</span>
          <span className="w-20">Actions</span>
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw size={20} className="text-[#525252] animate-spin" />
              <span className="text-sm text-[#525252]">Loading...</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <span className="text-sm text-[#525252]">No items found</span>
          </div>
        ) : (
          filtered.map((entity) => (
            <div
              key={`${entity.type}-${entity.id}`}
              className="grid grid-cols-[1fr_2fr_1fr_1.5fr_auto] gap-4 px-4 py-3 border-b border-[#1a1a1a] hover:bg-[#111111] transition-colors items-center"
            >
              {/* Name */}
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-[#fafafa] truncate">
                  {entity.name}
                </span>
                <TypeBadge type={entity.type} />
              </div>

              {/* Details */}
              <p className="text-[12px] text-[#737373] truncate">{entity.description}</p>

              {/* Info */}
              <div>
                {entity.type === 'agent' ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-[#a3a3a3]">
                    <span className="w-4 h-4 rounded bg-[#1f1f1f] flex items-center justify-center">
                      <Bot size={10} className="text-[#22c55e]" />
                    </span>
                    {entity.info}
                  </span>
                ) : entity.type === 'tool' ? (
                  <ExtraBadge text={entity.info} variant="green" />
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-[#a3a3a3]">
                    <Workflow size={10} className="text-[#a855f7]" />
                    {entity.info}
                  </span>
                )}
              </div>

              {/* Extra */}
              <div className="flex flex-wrap gap-1">
                {entity.extra.slice(0, 3).map((tag) => (
                  <ExtraBadge
                    key={tag}
                    text={tag}
                    variant={
                      entity.type === 'agent'
                        ? 'green'
                        : entity.type === 'workflow'
                          ? 'purple'
                          : 'blue'
                    }
                  />
                ))}
                {entity.extra.length > 3 && (
                  <ExtraBadge text={`+${entity.extra.length - 3}`} variant="gray" />
                )}
              </div>

              {/* Actions */}
              <div className="w-20 flex justify-end">
                {entity.type === 'agent' && onTestAgent && (
                  <button
                    onClick={() => {
                      const agent = agents.find((a) => a.id === entity.id);
                      if (agent) onTestAgent(agent);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#22c55e]/10 text-[#22c55e] text-[11px] font-medium hover:bg-[#22c55e]/20 transition-colors"
                  >
                    <Play size={10} />
                    Test
                  </button>
                )}
                {entity.type === 'workflow' && (
                  <button
                    onClick={() => {
                      const wf = workflows.find((w) => w.id === entity.id);
                      if (wf) setExecuteWorkflowTarget(wf);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#a855f7]/10 text-[#a855f7] text-[11px] font-medium hover:bg-[#a855f7]/20 transition-colors"
                  >
                    <Play size={10} />
                    Execute
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between mt-3 text-[12px] text-[#525252]">
        <span>
          {filtered.length} of {entities.length} items
        </span>
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select className="bg-[#141414] border border-[#262626] rounded px-1.5 py-0.5 text-[12px] text-[#a3a3a3] outline-none">
            <option>10</option>
            <option>25</option>
            <option>50</option>
          </select>
        </div>
      </div>

      {/* Workflow Execute Modal */}
      {executeWorkflowTarget && (
        <WorkflowExecuteModal
          workflow={executeWorkflowTarget}
          onClose={() => setExecuteWorkflowTarget(null)}
        />
      )}
    </div>
  );
}
