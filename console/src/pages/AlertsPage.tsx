import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell,
  BellRing,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Settings,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  Activity,
  Zap,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type AlertType = 'error_rate' | 'latency' | 'token_budget' | 'agent_failure' | 'custom';
type AlertStatus = 'triggered' | 'resolved' | 'acknowledged';
type ConditionOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

interface AlertCondition {
  metric: string;
  operator: ConditionOperator;
  threshold: number;
  window_minutes: number;
}

interface AlertRule {
  id: string;
  name: string;
  description: string;
  type: AlertType;
  condition: AlertCondition;
  channels: string[];
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertHistoryItem {
  id: string;
  rule_id: string;
  rule_name: string | null;
  status: AlertStatus;
  message: string;
  context: Record<string, unknown> | null;
  triggered_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

interface AlertStats {
  totalRules: number;
  activeRules: number;
  totalAlerts: number;
  unresolvedAlerts: number;
  recentAlerts: number;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3141/api/observability';

// Alert tipi renkleri
const TYPE_STYLES: Record<AlertType, { label: string; badge: string; dot: string }> = {
  error_rate:    { label: 'Error Rate',    badge: 'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]',    dot: 'bg-[#ef4444]' },
  latency:       { label: 'Latency',       badge: 'text-[#f59e0b] bg-[#451a03] border border-[#b45309]',    dot: 'bg-[#f59e0b]' },
  token_budget:  { label: 'Token Budget',  badge: 'text-[#3b82f6] bg-[#172554] border border-[#1d4ed8]',   dot: 'bg-[#3b82f6]' },
  agent_failure: { label: 'Agent Failure', badge: 'text-[#a855f7] bg-[#2e1065] border border-[#7c3aed]',   dot: 'bg-[#a855f7]' },
  custom:        { label: 'Custom',        badge: 'text-[#a3a3a3] bg-[#1c1c1c] border border-[#3f3f46]',   dot: 'bg-[#a3a3a3]' },
};

// Durum stilleri
const STATUS_STYLES: Record<AlertStatus, { label: string; badge: string }> = {
  triggered:    { label: 'Triggered',    badge: 'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]' },
  resolved:     { label: 'Resolved',     badge: 'text-[#22c55e] bg-[#052e16] border border-[#16a34a]' },
  acknowledged: { label: 'Acknowledged', badge: 'text-[#f59e0b] bg-[#451a03] border border-[#b45309]' },
};

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  gt:  '>',
  lt:  '<',
  gte: '>=',
  lte: '<=',
  eq:  '=',
};

const METRIC_OPTIONS = [
  { value: 'error_rate',     label: 'Error Rate (%)' },
  { value: 'latency_ms',     label: 'Latency (ms)' },
  { value: 'token_count',    label: 'Token Count' },
  { value: 'failure_count',  label: 'Failure Count' },
  { value: 'request_count',  label: 'Request Count' },
];

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
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

function conditionSummary(cond: AlertCondition | null): string {
  if (!cond) return '—';
  const metric = METRIC_OPTIONS.find((m) => m.value === cond.metric)?.label ?? cond.metric;
  const op = OPERATOR_LABELS[cond.operator] ?? cond.operator;
  return `${metric} ${op} ${cond.threshold} in ${cond.window_minutes}min`;
}

// ---------------------------------------------------------------------------
// Form başlangıç değerleri
// ---------------------------------------------------------------------------

interface RuleFormValues {
  name: string;
  description: string;
  type: AlertType;
  metric: string;
  operator: ConditionOperator;
  threshold: string;
  window_minutes: string;
  cooldown_minutes: string;
  enabled: boolean;
}

const EMPTY_FORM: RuleFormValues = {
  name: '',
  description: '',
  type: 'error_rate',
  metric: 'error_rate',
  operator: 'gt',
  threshold: '10',
  window_minutes: '5',
  cooldown_minutes: '15',
  enabled: true,
};

// ---------------------------------------------------------------------------
// Ana bileşen
// ---------------------------------------------------------------------------

export default function AlertsPage() {
  // Kurallar
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);

  // İstatistikler
  const [stats, setStats] = useState<AlertStats | null>(null);

  // Geçmiş
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<AlertStatus | 'ALL'>('ALL');
  const [historyPage, setHistoryPage] = useState(0);
  const PAGE_SIZE = 20;

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [form, setForm] = useState<RuleFormValues>(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Genişletilmiş context
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  // Otomatik yenileme
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // Veri yükleme
  // ---------------------------------------------------------------------------

  const loadRules = useCallback(async () => {
    try {
      setRulesLoading(true);
      const res = await fetch(`${API_BASE}/alerts`);
      const data = await res.json() as { rules: AlertRule[] };
      setRules(data.rules ?? []);
    } catch {
      // sessizce devam et
    } finally {
      setRulesLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/alerts/stats`);
      const data = await res.json() as AlertStats;
      setStats(data);
    } catch {
      // sessizce devam et
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(historyPage * PAGE_SIZE),
      });
      if (historyStatusFilter !== 'ALL') params.set('status', historyStatusFilter);

      const res = await fetch(`${API_BASE}/alerts/history?${params}`);
      const data = await res.json() as { history: AlertHistoryItem[]; total: number };
      setHistory(data.history ?? []);
      setHistoryTotal(data.total ?? 0);
    } catch {
      // sessizce devam et
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, historyStatusFilter]);

  const loadAll = useCallback(() => {
    void loadRules();
    void loadStats();
    void loadHistory();
  }, [loadRules, loadStats, loadHistory]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Otomatik yenileme
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => { void loadAll(); }, 10000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, loadAll]);

  // ---------------------------------------------------------------------------
  // Form işlemleri
  // ---------------------------------------------------------------------------

  function openCreate() {
    setEditingRule(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(rule: AlertRule) {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      description: rule.description,
      type: rule.type as AlertType,
      metric: (rule.condition as AlertCondition)?.metric ?? 'error_rate',
      operator: (rule.condition as AlertCondition)?.operator ?? 'gt',
      threshold: String((rule.condition as AlertCondition)?.threshold ?? 10),
      window_minutes: String((rule.condition as AlertCondition)?.window_minutes ?? 5),
      cooldown_minutes: String(rule.cooldown_minutes),
      enabled: rule.enabled,
    });
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingRule(null);
    setFormError(null);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('Kural adı zorunludur.');
      return;
    }
    setFormLoading(true);
    setFormError(null);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      type: form.type,
      condition: {
        metric: form.metric,
        operator: form.operator,
        threshold: parseFloat(form.threshold) || 0,
        window_minutes: parseInt(form.window_minutes, 10) || 5,
      },
      cooldown_minutes: parseInt(form.cooldown_minutes, 10) || 15,
      enabled: form.enabled,
    };

    try {
      const url = editingRule
        ? `${API_BASE}/alerts/${editingRule.id}`
        : `${API_BASE}/alerts`;
      const method = editingRule ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setFormError(err.error ?? 'İşlem başarısız oldu.');
        return;
      }
      closeForm();
      void loadRules();
      void loadStats();
    } catch {
      setFormError('Sunucuya bağlanılamadı.');
    } finally {
      setFormLoading(false);
    }
  }

  async function deleteRule(id: string) {
    if (!confirm('Bu kuralı silmek istediğinizden emin misiniz?')) return;
    try {
      await fetch(`${API_BASE}/alerts/${id}`, { method: 'DELETE' });
      void loadRules();
      void loadStats();
      void loadHistory();
    } catch {
      // sessizce devam et
    }
  }

  async function toggleRule(id: string) {
    try {
      await fetch(`${API_BASE}/alerts/${id}/toggle`, { method: 'PUT' });
      void loadRules();
      void loadStats();
    } catch {
      // sessizce devam et
    }
  }

  async function acknowledgeAlert(id: string) {
    try {
      await fetch(`${API_BASE}/alerts/history/${id}/acknowledge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged_by: 'console-user' }),
      });
      void loadHistory();
      void loadStats();
    } catch {
      // sessizce devam et
    }
  }

  function toggleExpandHistory(id: string) {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const totalHistoryPages = Math.ceil(historyTotal / PAGE_SIZE);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-[#fafafa] overflow-hidden">
      {/* Başlık */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-[#262626] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] flex items-center justify-center">
            <Bell className="w-4 h-4 text-[#22c55e]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#fafafa]">Alerts</h1>
            <p className="text-xs text-[#525252]">Uyarı kuralları ve geçmiş</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Otomatik yenileme toggle */}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors ${
              autoRefresh
                ? 'bg-[#052e16] text-[#22c55e] border-[#16a34a]'
                : 'bg-[#111111] text-[#a3a3a3] border-[#262626] hover:border-[#3f3f46]'
            }`}
          >
            {autoRefresh ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {autoRefresh ? 'Auto-refresh: ON' : 'Auto-refresh: OFF'}
          </button>
          <button
            onClick={loadAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] hover:border-[#3f3f46] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Yenile
          </button>
        </div>
      </div>

      {/* Ana içerik */}
      <div className="flex-1 overflow-hidden flex gap-0">
        {/* SOL PANEL: Kurallar (%55) */}
        <div className="w-[55%] flex flex-col border-r border-[#262626] overflow-hidden">
          {/* Stats satırı */}
          <div className="flex-shrink-0 grid grid-cols-4 border-b border-[#262626]">
            <StatCell
              label="Active Rules"
              value={stats?.activeRules ?? 0}
              total={stats?.totalRules}
              color="#22c55e"
              icon={<Shield className="w-3.5 h-3.5" />}
            />
            <StatCell
              label="Alerts (24h)"
              value={stats?.recentAlerts ?? 0}
              color="#3b82f6"
              icon={<Activity className="w-3.5 h-3.5" />}
            />
            <StatCell
              label="Unresolved"
              value={stats?.unresolvedAlerts ?? 0}
              color="#ef4444"
              icon={<BellRing className="w-3.5 h-3.5" />}
            />
            <StatCell
              label="Total Alerts"
              value={stats?.totalAlerts ?? 0}
              color="#a3a3a3"
              icon={<Zap className="w-3.5 h-3.5" />}
            />
          </div>

          {/* Kurallar başlığı + Create butonu */}
          <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-[#262626]">
            <span className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wider">
              Alert Rules ({rules.length})
            </span>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-[#22c55e] text-[#0a0a0a] font-medium hover:bg-[#16a34a] transition-colors"
            >
              <Plus className="w-3 h-3" />
              Create Rule
            </button>
          </div>

          {/* Kural oluşturma / düzenleme formu */}
          {showForm && (
            <div className="flex-shrink-0 mx-4 my-3 rounded-lg border border-[#262626] bg-[#111111] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
                <span className="text-xs font-medium text-[#fafafa]">
                  {editingRule ? 'Kuralı Düzenle' : 'Yeni Kural Oluştur'}
                </span>
                <button onClick={closeForm} className="text-[#525252] hover:text-[#a3a3a3]">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <form onSubmit={(e) => { void submitForm(e); }} className="p-4 space-y-3">
                {/* Ad */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-[#525252] mb-1">Kural Adı *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Örn: High Error Rate"
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#525252] mb-1">Tip *</label>
                    <select
                      value={form.type}
                      onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AlertType }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
                    >
                      {Object.entries(TYPE_STYLES).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Açıklama */}
                <div>
                  <label className="block text-[11px] text-[#525252] mb-1">Açıklama</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Opsiyonel açıklama..."
                    className="w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]"
                  />
                </div>

                {/* Condition */}
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#525252] mb-1">Metrik</label>
                    <select
                      value={form.metric}
                      onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
                    >
                      {METRIC_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#525252] mb-1">Operatör</label>
                    <select
                      value={form.operator}
                      onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value as ConditionOperator }))}
                      className="w-full px-2 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
                    >
                      {Object.entries(OPERATOR_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#525252] mb-1">Eşik</label>
                    <input
                      type="number"
                      value={form.threshold}
                      onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#525252] mb-1">Pencere (dk)</label>
                    <input
                      type="number"
                      value={form.window_minutes}
                      onChange={(e) => setForm((f) => ({ ...f, window_minutes: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
                    />
                  </div>
                </div>

                {/* Cooldown + Enabled */}
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="block text-[11px] text-[#525252] mb-1">Cooldown (dk)</label>
                    <input
                      type="number"
                      value={form.cooldown_minutes}
                      onChange={(e) => setForm((f) => ({ ...f, cooldown_minutes: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-0.5">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                      className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
                    >
                      {form.enabled
                        ? <ToggleRight className="w-6 h-6 text-[#22c55e]" />
                        : <ToggleLeft className="w-6 h-6" />}
                    </button>
                    <span className="text-xs text-[#a3a3a3]">
                      {form.enabled ? 'Etkin' : 'Devre dışı'}
                    </span>
                  </div>
                </div>

                {/* Hata mesajı */}
                {formError && (
                  <p className="text-xs text-[#ef4444] bg-[#450a0a] border border-[#b91c1c] rounded-md px-3 py-2">
                    {formError}
                  </p>
                )}

                {/* Butonlar */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={formLoading}
                    className="px-4 py-1.5 text-xs bg-[#22c55e] text-[#0a0a0a] font-medium rounded-md hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
                  >
                    {formLoading ? 'Kaydediliyor...' : editingRule ? 'Güncelle' : 'Oluştur'}
                  </button>
                  <button
                    type="button"
                    onClick={closeForm}
                    className="px-4 py-1.5 text-xs bg-[#1c1c1c] text-[#a3a3a3] border border-[#262626] rounded-md hover:border-[#3f3f46] transition-colors"
                  >
                    İptal
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Kural listesi */}
          <div className="flex-1 overflow-y-auto">
            {rulesLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-4 h-4 text-[#525252] animate-spin" />
              </div>
            ) : rules.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <Bell className="w-8 h-8 text-[#262626]" />
                <p className="text-sm text-[#525252]">Henüz uyarı kuralı yok</p>
                <button
                  onClick={openCreate}
                  className="text-xs text-[#22c55e] hover:underline"
                >
                  İlk kuralı oluştur
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-2">
                {rules.map((rule) => {
                  const typeStyle = TYPE_STYLES[rule.type as AlertType] ?? TYPE_STYLES.custom;
                  const cond = rule.condition as AlertCondition;
                  return (
                    <div
                      key={rule.id}
                      className="rounded-lg border border-[#262626] bg-[#111111] hover:border-[#3f3f46] transition-colors"
                    >
                      <div className="px-4 py-3 flex items-start gap-3">
                        {/* Renkli nokta */}
                        <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${typeStyle.dot} ${rule.enabled ? '' : 'opacity-30'}`} />

                        <div className="flex-1 min-w-0">
                          {/* Üst satır */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${rule.enabled ? 'text-[#fafafa]' : 'text-[#525252]'}`}>
                              {rule.name}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeStyle.badge}`}>
                              {typeStyle.label}
                            </span>
                            {!rule.enabled && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] text-[#525252] bg-[#1c1c1c] border border-[#262626]">
                                Disabled
                              </span>
                            )}
                          </div>

                          {/* Condition özeti */}
                          <p className="text-xs text-[#a3a3a3] mt-1">{conditionSummary(cond)}</p>

                          {/* Açıklama */}
                          {rule.description && (
                            <p className="text-[11px] text-[#525252] mt-0.5 truncate">{rule.description}</p>
                          )}

                          {/* Alt meta */}
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-[#525252]">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {rule.cooldown_minutes}dk cooldown
                            </span>
                            {rule.last_triggered_at && (
                              <span className="flex items-center gap-1 text-[#f59e0b]">
                                <AlertTriangle className="w-3 h-3" />
                                {timeAgo(rule.last_triggered_at)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Aksiyonlar */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* Toggle */}
                          <button
                            onClick={() => void toggleRule(rule.id)}
                            title={rule.enabled ? 'Devre dışı bırak' : 'Etkinleştir'}
                            className="p-1.5 rounded-md hover:bg-[#1c1c1c] text-[#525252] hover:text-[#a3a3a3] transition-colors"
                          >
                            {rule.enabled
                              ? <ToggleRight className="w-4 h-4 text-[#22c55e]" />
                              : <ToggleLeft className="w-4 h-4" />}
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => openEdit(rule)}
                            title="Düzenle"
                            className="p-1.5 rounded-md hover:bg-[#1c1c1c] text-[#525252] hover:text-[#a3a3a3] transition-colors"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => void deleteRule(rule.id)}
                            title="Sil"
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

        {/* SAG PANEL: Geçmiş (%45) */}
        <div className="w-[45%] flex flex-col overflow-hidden">
          {/* Başlık + filtreler */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-[#262626] flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wider">
              Alert History
            </span>
            <div className="flex items-center gap-2">
              <select
                value={historyStatusFilter}
                onChange={(e) => {
                  setHistoryPage(0);
                  setHistoryStatusFilter(e.target.value as AlertStatus | 'ALL');
                }}
                className="px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded-md text-[#a3a3a3] focus:outline-none focus:border-[#3f3f46]"
              >
                <option value="ALL">Tümü</option>
                <option value="triggered">Triggered</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
              <span className="text-[11px] text-[#525252]">{historyTotal} toplam</span>
            </div>
          </div>

          {/* Timeline listesi */}
          <div className="flex-1 overflow-y-auto">
            {historyLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-4 h-4 text-[#525252] animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <CheckCircle2 className="w-8 h-8 text-[#262626]" />
                <p className="text-sm text-[#525252]">Henüz uyarı yok</p>
              </div>
            ) : (
              <div className="p-4">
                {/* Timeline çizgisi */}
                <div className="relative">
                  <div className="absolute left-[7px] top-0 bottom-0 w-px bg-[#262626]" />
                  <div className="space-y-3">
                    {history.map((item) => {
                      const statusStyle = STATUS_STYLES[item.status as AlertStatus] ?? STATUS_STYLES.triggered;
                      const expanded = expandedHistory.has(item.id);
                      const isTriggered = item.status === 'triggered';
                      return (
                        <div key={item.id} className="relative pl-6">
                          {/* Timeline nokta */}
                          <div className={`absolute left-0 top-2.5 w-3.5 h-3.5 rounded-full border-2 border-[#0a0a0a] flex-shrink-0 ${
                            isTriggered ? 'bg-[#ef4444] animate-pulse' :
                            item.status === 'resolved' ? 'bg-[#22c55e]' : 'bg-[#f59e0b]'
                          }`} />

                          <div className="rounded-lg border border-[#262626] bg-[#111111] overflow-hidden">
                            <div className="px-3 py-2.5">
                              {/* Üst satır */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.badge}`}>
                                      {statusStyle.label}
                                    </span>
                                    {item.rule_name && (
                                      <span className="text-xs text-[#a3a3a3] truncate">{item.rule_name}</span>
                                    )}
                                  </div>
                                  <p className="text-xs text-[#fafafa] mt-1 leading-relaxed">{item.message}</p>
                                </div>
                                <button
                                  onClick={() => toggleExpandHistory(item.id)}
                                  className="flex-shrink-0 text-[#525252] hover:text-[#a3a3a3] transition-colors"
                                >
                                  {expanded
                                    ? <ChevronUp className="w-3.5 h-3.5" />
                                    : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                              </div>

                              {/* Zaman bilgisi */}
                              <div className="flex items-center gap-3 mt-2 text-[11px] text-[#525252]">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {fmtTime(item.triggered_at)}
                                </span>
                                {item.acknowledged_at && (
                                  <span className="text-[#f59e0b]">
                                    Ack: {timeAgo(item.acknowledged_at)}
                                  </span>
                                )}
                                {item.resolved_at && (
                                  <span className="text-[#22c55e]">
                                    Resolved: {timeAgo(item.resolved_at)}
                                  </span>
                                )}
                              </div>

                              {/* Acknowledge butonu */}
                              {isTriggered && (
                                <button
                                  onClick={() => void acknowledgeAlert(item.id)}
                                  className="mt-2 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] bg-[#451a03] text-[#f59e0b] border border-[#b45309] hover:bg-[#78350f] transition-colors"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  Acknowledge
                                </button>
                              )}
                            </div>

                            {/* Genişletilmiş context */}
                            {expanded && item.context && (
                              <div className="border-t border-[#262626] bg-[#0a0a0a] px-3 py-2">
                                <p className="text-[10px] text-[#525252] font-mono uppercase tracking-wider mb-1">Context</p>
                                <pre className="text-[11px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                                  {JSON.stringify(item.context, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Pagination */}
                {totalHistoryPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-[#262626]">
                    <button
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage((p) => p - 1)}
                      className="px-3 py-1 text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] rounded-md disabled:opacity-30 hover:border-[#3f3f46] transition-colors"
                    >
                      Önceki
                    </button>
                    <span className="text-xs text-[#525252]">
                      {historyPage + 1} / {totalHistoryPages}
                    </span>
                    <button
                      disabled={historyPage >= totalHistoryPages - 1}
                      onClick={() => setHistoryPage((p) => p + 1)}
                      className="px-3 py-1 text-xs bg-[#111111] text-[#a3a3a3] border border-[#262626] rounded-md disabled:opacity-30 hover:border-[#3f3f46] transition-colors"
                    >
                      Sonraki
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// İstatistik kartı bileşeni
// ---------------------------------------------------------------------------

function StatCell({
  label,
  value,
  total,
  color,
  icon,
}: {
  label: string;
  value: number;
  total?: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-r border-[#262626] last:border-r-0">
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="text-[11px] text-[#525252]">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-semibold text-[#fafafa]">{value}</span>
        {total !== undefined && (
          <span className="text-xs text-[#525252]">/ {total}</span>
        )}
      </div>
    </div>
  );
}
