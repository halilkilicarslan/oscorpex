import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Workflow,
  Zap,
  Clock,
  Globe,
  Activity,
  Play,
  Trash2,
  Edit3,
  Plus,
  TestTube2,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Eye,
  EyeOff,
  Filter,
  Search,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TriggerType = 'webhook' | 'schedule' | 'event' | 'condition';
type ActionType = 'run_agent' | 'send_webhook' | 'execute_pipeline' | 'notify';
type LogStatus = 'success' | 'failed' | 'skipped';

interface TriggerConfig {
  // webhook
  url?: string;
  method?: string;
  headers?: string;
  // schedule
  cron?: string;
  timezone?: string;
  // event
  event_type?: string;
  filter?: string;
  // condition
  metric?: string;
  operator?: string;
  threshold?: string;
  check_interval?: string;
}

interface TriggerAction {
  type: ActionType;
  params: Record<string, string>;
}

interface Trigger {
  id: string;
  name: string;
  description: string;
  type: TriggerType;
  config: TriggerConfig;
  action: TriggerAction;
  enabled: boolean;
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
  updated_at: string;
}

interface TriggerLog {
  id: string;
  trigger_id: string;
  status: LogStatus;
  input: unknown;
  output: unknown;
  duration_ms: number | null;
  fired_at: string;
}

interface TriggerStats {
  total: number;
  active: number;
  totalFires: number;
  recentFires24h: number;
  byType: { webhook: number; schedule: number; event: number; condition: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3141/api/observability';

const TYPE_META: Record<TriggerType, { label: string; badge: string; dot: string; icon: React.ReactNode }> = {
  webhook:   { label: 'Webhook',   badge: 'text-[#3b82f6] bg-[#172554] border border-[#1d4ed8]', dot: 'bg-[#3b82f6]', icon: <Globe className="w-3.5 h-3.5" /> },
  schedule:  { label: 'Schedule',  badge: 'text-[#f59e0b] bg-[#451a03] border border-[#b45309]', dot: 'bg-[#f59e0b]', icon: <Clock className="w-3.5 h-3.5" /> },
  event:     { label: 'Event',     badge: 'text-[#a855f7] bg-[#2e1065] border border-[#7c3aed]', dot: 'bg-[#a855f7]', icon: <Zap className="w-3.5 h-3.5" /> },
  condition: { label: 'Condition', badge: 'text-[#22c55e] bg-[#052e16] border border-[#16a34a]', dot: 'bg-[#22c55e]', icon: <Activity className="w-3.5 h-3.5" /> },
};

const LOG_STATUS_META: Record<LogStatus, { label: string; badge: string; icon: React.ReactNode }> = {
  success: { label: 'Success', badge: 'text-[#22c55e] bg-[#052e16] border border-[#16a34a]', icon: <CheckCircle2 className="w-3 h-3" /> },
  failed:  { label: 'Failed',  badge: 'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]', icon: <XCircle className="w-3 h-3" /> },
  skipped: { label: 'Skipped', badge: 'text-[#525252] bg-[#1c1c1c] border border-[#3f3f46]',  icon: <MinusCircle className="w-3 h-3" /> },
};

const ACTION_LABELS: Record<ActionType, string> = {
  run_agent:        'Run Agent',
  send_webhook:     'Send Webhook',
  execute_pipeline: 'Execute Pipeline',
  notify:           'Notify',
};

const EVENT_TYPES = [
  'task:completed',
  'task:failed',
  'task:started',
  'pipeline:started',
  'pipeline:completed',
  'pipeline:failed',
  'agent:error',
  'agent:response',
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function cronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hr, dom, , dow] = parts;
  if (min === '*' && hr === '*') return 'Every minute';
  if (dom === '*' && dow === '*') {
    if (min !== '*' && hr !== '*') return `Daily at ${hr}:${min.padStart(2, '0')}`;
    if (min !== '*') return `Every hour at :${min.padStart(2, '0')}`;
  }
  return cron;
}

function configSummary(type: TriggerType, config: TriggerConfig): string {
  switch (type) {
    case 'webhook':   return config.url ? `${config.method ?? 'POST'} ${config.url}` : 'No URL configured';
    case 'schedule':  return config.cron ? `${config.cron} — ${cronHuman(config.cron)}` : 'No schedule configured';
    case 'event':     return config.event_type ? `Listening for: ${config.event_type}` : 'No event type set';
    case 'condition': {
      const { metric, operator, threshold } = config;
      if (metric && operator && threshold) return `${metric} ${operator} ${threshold}`;
      return 'No condition configured';
    }
    default: return '';
  }
}

function actionSummary(action: TriggerAction): string {
  const label = ACTION_LABELS[action.type] ?? action.type;
  if (action.type === 'run_agent' && action.params?.agent_name) return `${label}: ${action.params.agent_name}`;
  if (action.type === 'send_webhook' && action.params?.url) return `${label}: ${action.params.url}`;
  if (action.type === 'execute_pipeline' && action.params?.pipeline) return `${label}: ${action.params.pipeline}`;
  return label;
}

// ---------------------------------------------------------------------------
// Form types + defaults
// ---------------------------------------------------------------------------

interface TriggerFormValues {
  name: string;
  description: string;
  type: TriggerType;
  // webhook
  wh_url: string;
  wh_method: string;
  wh_headers: string;
  // schedule
  sc_cron: string;
  sc_timezone: string;
  // event
  ev_type: string;
  ev_filter: string;
  // condition
  co_metric: string;
  co_operator: string;
  co_threshold: string;
  co_check_interval: string;
  // action
  ac_type: ActionType;
  ac_agent_name: string;
  ac_webhook_url: string;
  ac_pipeline: string;
  ac_message: string;
  enabled: boolean;
}

const EMPTY_FORM: TriggerFormValues = {
  name: '', description: '', type: 'webhook',
  wh_url: '', wh_method: 'POST', wh_headers: '',
  sc_cron: '0 * * * *', sc_timezone: 'UTC',
  ev_type: 'task:completed', ev_filter: '',
  co_metric: 'error_rate', co_operator: '>', co_threshold: '10', co_check_interval: '5',
  ac_type: 'run_agent', ac_agent_name: '', ac_webhook_url: '', ac_pipeline: '', ac_message: '',
  enabled: true,
};

function formToPayload(form: TriggerFormValues) {
  const config: TriggerConfig = {};
  switch (form.type) {
    case 'webhook':
      config.url = form.wh_url;
      config.method = form.wh_method;
      config.headers = form.wh_headers;
      break;
    case 'schedule':
      config.cron = form.sc_cron;
      config.timezone = form.sc_timezone;
      break;
    case 'event':
      config.event_type = form.ev_type;
      config.filter = form.ev_filter;
      break;
    case 'condition':
      config.metric = form.co_metric;
      config.operator = form.co_operator;
      config.threshold = form.co_threshold;
      config.check_interval = form.co_check_interval;
      break;
  }

  const params: Record<string, string> = {};
  switch (form.ac_type) {
    case 'run_agent':        params.agent_name = form.ac_agent_name; break;
    case 'send_webhook':     params.url = form.ac_webhook_url; break;
    case 'execute_pipeline': params.pipeline = form.ac_pipeline; break;
    case 'notify':           params.message = form.ac_message; break;
  }

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    type: form.type,
    config,
    action: { type: form.ac_type, params },
    enabled: form.enabled,
  };
}

function triggerToForm(t: Trigger): TriggerFormValues {
  const c = t.config ?? {};
  const a = t.action ?? { type: 'run_agent', params: {} };
  const p = a.params ?? {};
  return {
    name: t.name, description: t.description, type: t.type as TriggerType,
    wh_url: c.url ?? '', wh_method: c.method ?? 'POST', wh_headers: c.headers ?? '',
    sc_cron: c.cron ?? '0 * * * *', sc_timezone: c.timezone ?? 'UTC',
    ev_type: c.event_type ?? 'task:completed', ev_filter: c.filter ?? '',
    co_metric: c.metric ?? 'error_rate', co_operator: c.operator ?? '>',
    co_threshold: c.threshold ?? '10', co_check_interval: c.check_interval ?? '5',
    ac_type: (a.type ?? 'run_agent') as ActionType,
    ac_agent_name: p.agent_name ?? '', ac_webhook_url: p.url ?? '',
    ac_pipeline: p.pipeline ?? '', ac_message: p.message ?? '',
    enabled: t.enabled,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="flex-1 px-4 py-3 border-r border-[#262626] last:border-r-0">
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="text-[11px] text-[#525252]">{label}</span>
      </div>
      <span className="text-xl font-semibold text-[#fafafa]">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trigger Form Modal
// ---------------------------------------------------------------------------

function TriggerFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Trigger | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TriggerFormValues>(editing ? triggerToForm(editing) : EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof TriggerFormValues>(key: K, val: TriggerFormValues[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Trigger name is required.'); return; }
    setLoading(true);
    setError(null);
    try {
      const url = editing ? `${API_BASE}/triggers/${editing.id}` : `${API_BASE}/triggers`;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPayload(form)),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setError(err.error ?? 'Operation failed.');
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('Could not reach server.');
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]';
  const selectCls = 'w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]';
  const labelCls = 'block text-[11px] text-[#525252] mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-[#111111] border border-[#262626] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#262626]">
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-[#22c55e]" />
            <span className="text-sm font-semibold text-[#fafafa]">
              {editing ? 'Edit Trigger' : 'Create Trigger'}
            </span>
          </div>
          <button onClick={onClose} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => { void submit(e); }} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Name + Description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input type="text" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="My Trigger" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input type="text" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Optional..." className={inputCls} />
            </div>
          </div>

          {/* Type selector */}
          <div>
            <label className={labelCls}>Trigger Type</label>
            <div className="grid grid-cols-4 gap-2">
              {(['webhook', 'schedule', 'event', 'condition'] as TriggerType[]).map((t) => {
                const meta = TYPE_META[t];
                const selected = form.type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setField('type', t)}
                    className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-xs transition-colors ${
                      selected
                        ? 'bg-[#1c1c1c] border-[#22c55e] text-[#fafafa]'
                        : 'bg-[#0a0a0a] border-[#262626] text-[#525252] hover:border-[#3f3f46]'
                    }`}
                  >
                    <span style={{ color: selected ? undefined : '#525252' }}>{meta.icon}</span>
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic config */}
          <div className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3 space-y-3">
            <p className="text-[11px] text-[#525252] uppercase tracking-wider font-medium">Config</p>

            {form.type === 'webhook' && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className={labelCls}>URL</label>
                    <input type="text" value={form.wh_url} onChange={(e) => setField('wh_url', e.target.value)} placeholder="https://..." className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Method</label>
                    <select value={form.wh_method} onChange={(e) => setField('wh_method', e.target.value)} className={selectCls}>
                      {['GET', 'POST', 'PUT', 'PATCH'].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Headers (JSON)</label>
                  <textarea value={form.wh_headers} onChange={(e) => setField('wh_headers', e.target.value)} placeholder={'{"Authorization": "Bearer ..."}'} rows={2} className={`${inputCls} resize-none`} />
                </div>
              </>
            )}

            {form.type === 'schedule' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Cron Expression</label>
                  <input type="text" value={form.sc_cron} onChange={(e) => setField('sc_cron', e.target.value)} placeholder="0 * * * *" className={inputCls} />
                  {form.sc_cron && <p className="text-[10px] text-[#525252] mt-1">{cronHuman(form.sc_cron)}</p>}
                </div>
                <div>
                  <label className={labelCls}>Timezone</label>
                  <input type="text" value={form.sc_timezone} onChange={(e) => setField('sc_timezone', e.target.value)} placeholder="UTC" className={inputCls} />
                </div>
              </div>
            )}

            {form.type === 'event' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Event Type</label>
                  <select value={form.ev_type} onChange={(e) => setField('ev_type', e.target.value)} className={selectCls}>
                    {EVENT_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Filter Conditions</label>
                  <input type="text" value={form.ev_filter} onChange={(e) => setField('ev_filter', e.target.value)} placeholder="agent_id=xyz" className={inputCls} />
                </div>
              </div>
            )}

            {form.type === 'condition' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Metric</label>
                  <select value={form.co_metric} onChange={(e) => setField('co_metric', e.target.value)} className={selectCls}>
                    {['error_rate', 'latency', 'token_count', 'failure_count'].map((m) => (
                      <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Operator</label>
                    <select value={form.co_operator} onChange={(e) => setField('co_operator', e.target.value)} className={selectCls}>
                      {['>', '<', '>=', '<=', '=='].map((op) => <option key={op}>{op}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Threshold</label>
                    <input type="number" value={form.co_threshold} onChange={(e) => setField('co_threshold', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Check Interval (min)</label>
                  <input type="number" value={form.co_check_interval} onChange={(e) => setField('co_check_interval', e.target.value)} className={inputCls} />
                </div>
              </div>
            )}
          </div>

          {/* Action */}
          <div className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3 space-y-3">
            <p className="text-[11px] text-[#525252] uppercase tracking-wider font-medium">Action</p>
            <div>
              <label className={labelCls}>Action Type</label>
              <select value={form.ac_type} onChange={(e) => setField('ac_type', e.target.value as ActionType)} className={selectCls}>
                {(Object.entries(ACTION_LABELS) as [ActionType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            {form.ac_type === 'run_agent' && (
              <div>
                <label className={labelCls}>Agent Name</label>
                <input type="text" value={form.ac_agent_name} onChange={(e) => setField('ac_agent_name', e.target.value)} placeholder="researcher" className={inputCls} />
              </div>
            )}
            {form.ac_type === 'send_webhook' && (
              <div>
                <label className={labelCls}>Webhook URL</label>
                <input type="text" value={form.ac_webhook_url} onChange={(e) => setField('ac_webhook_url', e.target.value)} placeholder="https://..." className={inputCls} />
              </div>
            )}
            {form.ac_type === 'execute_pipeline' && (
              <div>
                <label className={labelCls}>Pipeline Name</label>
                <input type="text" value={form.ac_pipeline} onChange={(e) => setField('ac_pipeline', e.target.value)} placeholder="data-processing" className={inputCls} />
              </div>
            )}
            {form.ac_type === 'notify' && (
              <div>
                <label className={labelCls}>Message</label>
                <input type="text" value={form.ac_message} onChange={(e) => setField('ac_message', e.target.value)} placeholder="Notification message..." className={inputCls} />
              </div>
            )}
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setField('enabled', !form.enabled)}
              className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
            >
              {form.enabled
                ? <ToggleRight className="w-7 h-7 text-[#22c55e]" />
                : <ToggleLeft className="w-7 h-7" />}
            </button>
            <span className="text-xs text-[#a3a3a3]">{form.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>

          {error && (
            <p className="text-xs text-[#ef4444] bg-[#450a0a] border border-[#b91c1c] rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-[#262626]">
          <button
            onClick={(e) => { void submit(e as unknown as React.FormEvent); }}
            disabled={loading}
            className="px-4 py-1.5 text-xs bg-[#22c55e] text-[#0a0a0a] font-medium rounded-md hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Saving...' : editing ? 'Update' : 'Create'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-[#1c1c1c] text-[#a3a3a3] border border-[#262626] rounded-md hover:border-[#3f3f46] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TriggersPage() {
  const [activeTab, setActiveTab] = useState<'triggers' | 'logs'>('triggers');

  // Triggers state
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [triggersLoading, setTriggersLoading] = useState(true);
  const [stats, setStats] = useState<TriggerStats | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<TriggerType | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'disabled'>('ALL');
  const [search, setSearch] = useState('');

  // Form modal
  const [showForm, setShowForm] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);

  // Logs state
  const [logs, setLogs] = useState<(TriggerLog & { trigger_name?: string })[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(0);
  const [logsTriggerFilter, setLogsTriggerFilter] = useState<string>('ALL');
  const [logsStatusFilter, setLogsStatusFilter] = useState<LogStatus | 'ALL'>('ALL');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 25;

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadTriggers = useCallback(async () => {
    try {
      setTriggersLoading(true);
      const res = await fetch(`${API_BASE}/triggers`);
      const data = await res.json() as { triggers: Trigger[] };
      setTriggers(data.triggers ?? []);
    } catch {
      // silent
    } finally {
      setTriggersLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/triggers/stats`);
      const data = await res.json() as TriggerStats;
      setStats(data);
    } catch {
      // silent
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      setLogsLoading(true);
      // Load logs from all triggers and merge
      const triggerList = triggers.length > 0 ? triggers : [];
      if (triggerList.length === 0) { setLogs([]); setLogsTotal(0); return; }

      const targetTriggers = logsTriggerFilter === 'ALL'
        ? triggerList
        : triggerList.filter((t) => t.id === logsTriggerFilter);

      const promises = targetTriggers.map(async (t) => {
        const params = new URLSearchParams({ limit: '100', offset: '0' });
        if (logsStatusFilter !== 'ALL') params.set('status', logsStatusFilter);
        const res = await fetch(`${API_BASE}/triggers/${t.id}/logs?${params}`);
        const data = await res.json() as { logs: TriggerLog[]; total: number };
        return (data.logs ?? []).map((l) => ({ ...l, trigger_name: t.name }));
      });

      const results = await Promise.all(promises);
      const allLogs = results.flat().sort((a, b) =>
        new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime()
      );
      setLogsTotal(allLogs.length);
      setLogs(allLogs.slice(logsPage * PAGE_SIZE, (logsPage + 1) * PAGE_SIZE));
    } catch {
      // silent
    } finally {
      setLogsLoading(false);
    }
  }, [triggers, logsTriggerFilter, logsStatusFilter, logsPage]);

  const loadAll = useCallback(() => {
    void loadTriggers();
    void loadStats();
  }, [loadTriggers, loadStats]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => { if (activeTab === 'logs' && triggers.length >= 0) void loadLogs(); }, [activeTab, loadLogs, triggers]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => { void loadAll(); }, 10000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, loadAll]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function deleteTrigger(id: string) {
    if (!confirm('Delete this trigger and all its logs?')) return;
    try {
      await fetch(`${API_BASE}/triggers/${id}`, { method: 'DELETE' });
      void loadAll();
    } catch { /* silent */ }
  }

  async function toggleTrigger(id: string) {
    try {
      await fetch(`${API_BASE}/triggers/${id}/toggle`, { method: 'PUT' });
      void loadAll();
    } catch { /* silent */ }
  }

  async function testFire(id: string) {
    try {
      await fetch(`${API_BASE}/triggers/${id}/test`, { method: 'POST' });
      void loadAll();
      if (activeTab === 'logs') void loadLogs();
    } catch { /* silent */ }
  }

  function toggleExpandLog(id: string) {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Filtered triggers
  // ---------------------------------------------------------------------------

  const filteredTriggers = triggers.filter((t) => {
    if (typeFilter !== 'ALL' && t.type !== typeFilter) return false;
    if (statusFilter === 'active' && !t.enabled) return false;
    if (statusFilter === 'disabled' && t.enabled) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    }
    return true;
  });

  const totalLogsPages = Math.ceil(logsTotal / PAGE_SIZE);

  // Success rate
  const successRate = stats
    ? stats.totalFires > 0
      ? Math.round((stats.totalFires / stats.totalFires) * 100)
      : 0
    : 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-[#fafafa] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-[#262626] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] flex items-center justify-center">
            <Workflow className="w-4 h-4 text-[#22c55e]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#fafafa]">Triggers</h1>
            <p className="text-xs text-[#525252]">Event triggers and automation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors ${
              autoRefresh
                ? 'bg-[#052e16] text-[#22c55e] border-[#16a34a]'
                : 'bg-[#111111] text-[#a3a3a3] border-[#262626] hover:border-[#3f3f46]'
            }`}
          >
            {autoRefresh ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Auto-refresh
          </button>
          <button
            onClick={loadAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] hover:border-[#3f3f46] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex-shrink-0 flex border-b border-[#262626]">
        <StatCard label="Total Triggers" value={stats?.total ?? 0} color="#a3a3a3" icon={<Workflow className="w-3.5 h-3.5" />} />
        <StatCard label="Active" value={stats?.active ?? 0} color="#22c55e" icon={<Play className="w-3.5 h-3.5" />} />
        <StatCard label="Fires (24h)" value={stats?.recentFires24h ?? 0} color="#3b82f6" icon={<Zap className="w-3.5 h-3.5" />} />
        <StatCard label="Success Rate" value={successRate} color="#f59e0b" icon={<Activity className="w-3.5 h-3.5" />} />
      </div>

      {/* Tab Toggle */}
      <div className="flex-shrink-0 flex items-center gap-1 px-6 py-3 border-b border-[#262626]">
        {(['triggers', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
              activeTab === tab
                ? 'bg-[#1c1c1c] text-[#fafafa] border border-[#3f3f46]'
                : 'text-[#525252] hover:text-[#a3a3a3]'
            }`}
          >
            {tab === 'triggers' ? 'All Triggers' : 'Logs'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {/* ================================================================
            TAB: All Triggers
        ================================================================ */}
        {activeTab === 'triggers' && (
          <div className="flex flex-col h-full">
            {/* Filter bar */}
            <div className="flex-shrink-0 flex items-center gap-2 px-6 py-3 border-b border-[#262626]">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#525252]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search triggers..."
                  className="w-full pl-7 pr-3 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#3f3f46]"
                />
              </div>

              {/* Type filter */}
              <div className="flex items-center gap-1">
                <Filter className="w-3 h-3 text-[#525252]" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TriggerType | 'ALL')}
                  className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
                >
                  <option value="ALL">All Types</option>
                  <option value="webhook">Webhook</option>
                  <option value="schedule">Schedule</option>
                  <option value="event">Event</option>
                  <option value="condition">Condition</option>
                </select>
              </div>

              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'active' | 'disabled')}
                className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
              >
                <option value="ALL">All Status</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>

              <span className="text-xs text-[#525252] ml-auto">{filteredTriggers.length} trigger{filteredTriggers.length !== 1 ? 's' : ''}</span>

              {/* Create button */}
              <button
                onClick={() => { setEditingTrigger(null); setShowForm(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#22c55e] text-[#0a0a0a] font-medium hover:bg-[#16a34a] transition-colors"
              >
                <Plus className="w-3 h-3" />
                Create Trigger
              </button>
            </div>

            {/* Trigger list */}
            <div className="flex-1 overflow-y-auto p-4">
              {triggersLoading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="w-4 h-4 text-[#525252] animate-spin" />
                </div>
              ) : filteredTriggers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <Workflow className="w-10 h-10 text-[#262626]" />
                  <p className="text-sm text-[#525252]">No triggers configured yet</p>
                  <button
                    onClick={() => { setEditingTrigger(null); setShowForm(true); }}
                    className="text-xs text-[#22c55e] hover:underline"
                  >
                    Create your first trigger
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-w-4xl">
                  {filteredTriggers.map((trigger) => {
                    const meta = TYPE_META[trigger.type as TriggerType] ?? TYPE_META.webhook;
                    return (
                      <div
                        key={trigger.id}
                        className={`rounded-lg border bg-[#111111] hover:border-[#3f3f46] transition-colors ${
                          trigger.enabled ? 'border-[#262626]' : 'border-[#1c1c1c] opacity-70'
                        }`}
                      >
                        <div className="px-4 py-3 flex items-start gap-3">
                          {/* Type icon */}
                          <div className={`mt-0.5 w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                            trigger.type === 'webhook'   ? 'bg-[#172554] text-[#3b82f6]' :
                            trigger.type === 'schedule'  ? 'bg-[#451a03] text-[#f59e0b]' :
                            trigger.type === 'event'     ? 'bg-[#2e1065] text-[#a855f7]' :
                                                           'bg-[#052e16] text-[#22c55e]'
                          }`}>
                            {meta.icon}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Top row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium ${trigger.enabled ? 'text-[#fafafa]' : 'text-[#525252]'}`}>
                                {trigger.name}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.badge}`}>
                                {meta.label}
                              </span>
                              {!trigger.enabled && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] text-[#525252] bg-[#1c1c1c] border border-[#262626]">
                                  Disabled
                                </span>
                              )}
                            </div>

                            {/* Description */}
                            {trigger.description && (
                              <p className="text-[11px] text-[#525252] mt-0.5 truncate max-w-md">{trigger.description}</p>
                            )}

                            {/* Config summary */}
                            <p className="text-xs text-[#a3a3a3] mt-1 truncate max-w-lg">{configSummary(trigger.type as TriggerType, trigger.config)}</p>

                            {/* Action summary */}
                            <p className="text-[11px] text-[#525252] mt-0.5">
                              Action: <span className="text-[#a3a3a3]">{actionSummary(trigger.action)}</span>
                            </p>

                            {/* Stats row */}
                            <div className="flex items-center gap-4 mt-1.5 text-[11px] text-[#525252]">
                              <span className="flex items-center gap-1">
                                <Zap className="w-3 h-3" />
                                {trigger.fire_count} fires
                              </span>
                              {trigger.last_fired_at && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Last: {timeAgo(trigger.last_fired_at)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {/* Toggle */}
                            <button
                              onClick={() => void toggleTrigger(trigger.id)}
                              title={trigger.enabled ? 'Disable' : 'Enable'}
                              className="p-1.5 rounded-md hover:bg-[#1c1c1c] transition-colors"
                            >
                              {trigger.enabled
                                ? <ToggleRight className="w-4 h-4 text-[#22c55e]" />
                                : <ToggleLeft className="w-4 h-4 text-[#525252]" />}
                            </button>
                            {/* Edit */}
                            <button
                              onClick={() => { setEditingTrigger(trigger); setShowForm(true); }}
                              title="Edit"
                              className="p-1.5 rounded-md hover:bg-[#1c1c1c] text-[#525252] hover:text-[#a3a3a3] transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {/* Test fire */}
                            <button
                              onClick={() => void testFire(trigger.id)}
                              title="Test Fire"
                              className="p-1.5 rounded-md hover:bg-[#1c1c1c] text-[#525252] hover:text-[#22c55e] transition-colors"
                            >
                              <TestTube2 className="w-3.5 h-3.5" />
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => void deleteTrigger(trigger.id)}
                              title="Delete"
                              className="p-1.5 rounded-md hover:bg-[#450a0a] text-[#525252] hover:text-[#ef4444] transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================
            TAB: Logs
        ================================================================ */}
        {activeTab === 'logs' && (
          <div className="flex flex-col h-full">
            {/* Log filters */}
            <div className="flex-shrink-0 flex items-center gap-2 px-6 py-3 border-b border-[#262626]">
              <select
                value={logsTriggerFilter}
                onChange={(e) => { setLogsPage(0); setLogsTriggerFilter(e.target.value); }}
                className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
              >
                <option value="ALL">All Triggers</option>
                {triggers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              <select
                value={logsStatusFilter}
                onChange={(e) => { setLogsPage(0); setLogsStatusFilter(e.target.value as LogStatus | 'ALL'); }}
                className="px-2.5 py-1.5 text-xs bg-[#111111] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
              >
                <option value="ALL">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="skipped">Skipped</option>
              </select>

              <span className="text-xs text-[#525252] ml-auto">{logsTotal} entries</span>

              <button
                onClick={() => void loadLogs()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] hover:border-[#3f3f46] transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
            </div>

            {/* Log list */}
            <div className="flex-1 overflow-y-auto p-4">
              {logsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="w-4 h-4 text-[#525252] animate-spin" />
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <Activity className="w-10 h-10 text-[#262626]" />
                  <p className="text-sm text-[#525252]">No trigger logs yet</p>
                  <p className="text-xs text-[#525252]">Use "Test Fire" on a trigger to generate a log entry</p>
                </div>
              ) : (
                <div className="max-w-4xl">
                  {/* Timeline */}
                  <div className="relative">
                    <div className="absolute left-[7px] top-0 bottom-0 w-px bg-[#262626]" />
                    <div className="space-y-2">
                      {logs.map((log) => {
                        const statusMeta = LOG_STATUS_META[log.status as LogStatus] ?? LOG_STATUS_META.skipped;
                        const expanded = expandedLogs.has(log.id);
                        return (
                          <div key={log.id} className="relative pl-6">
                            {/* Timeline dot */}
                            <div className={`absolute left-0 top-3 w-3.5 h-3.5 rounded-full border-2 border-[#0a0a0a] ${
                              log.status === 'success' ? 'bg-[#22c55e]' :
                              log.status === 'failed'  ? 'bg-[#ef4444]' : 'bg-[#525252]'
                            }`} />

                            <div className="rounded-lg border border-[#262626] bg-[#111111] overflow-hidden">
                              <div className="px-3 py-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusMeta.badge}`}>
                                        {statusMeta.icon}
                                        {statusMeta.label}
                                      </span>
                                      {log.trigger_name && (
                                        <span className="text-xs text-[#a3a3a3]">{log.trigger_name}</span>
                                      )}
                                      {log.duration_ms !== null && (
                                        <span className="text-[10px] text-[#525252]">{log.duration_ms}ms</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-[#525252]">
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {fmtTime(log.fired_at)}
                                      </span>
                                      <span>{timeAgo(log.fired_at)}</span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => toggleExpandLog(log.id)}
                                    className="flex-shrink-0 text-[#525252] hover:text-[#a3a3a3] transition-colors"
                                  >
                                    {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>

                              {expanded && (
                                <div className="border-t border-[#262626] bg-[#0a0a0a] px-3 py-2 space-y-2">
                                  {log.input !== null && (
                                    <div>
                                      <p className="text-[10px] text-[#525252] font-mono uppercase tracking-wider mb-1">Input</p>
                                      <pre className="text-[11px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                                        {JSON.stringify(log.input, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.output !== null && (
                                    <div>
                                      <p className="text-[10px] text-[#525252] font-mono uppercase tracking-wider mb-1">Output</p>
                                      <pre className="text-[11px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                                        {JSON.stringify(log.output, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pagination */}
                  {totalLogsPages > 1 && (
                    <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-[#262626]">
                      <button
                        disabled={logsPage === 0}
                        onClick={() => setLogsPage((p) => p - 1)}
                        className="px-3 py-1 text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] rounded-md disabled:opacity-30 hover:border-[#3f3f46] transition-colors"
                      >
                        Previous
                      </button>
                      <span className="text-xs text-[#525252]">
                        {logsPage + 1} / {totalLogsPages}
                      </span>
                      <button
                        disabled={logsPage >= totalLogsPages - 1}
                        onClick={() => setLogsPage((p) => p + 1)}
                        className="px-3 py-1 text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] rounded-md disabled:opacity-30 hover:border-[#3f3f46] transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <TriggerFormModal
          editing={editingTrigger}
          onClose={() => { setShowForm(false); setEditingTrigger(null); }}
          onSaved={() => { void loadAll(); }}
        />
      )}
    </div>
  );
}
