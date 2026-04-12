// ---------------------------------------------------------------------------
// Oscorpex — Project Settings (Integration Widgets)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle, TrendingUp, Plus, Trash2, Zap, Globe } from 'lucide-react';
import {
  fetchProjectSettings,
  saveProjectSettings,
  fetchProjectCosts,
  fetchWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  type SettingsMap,
  type ProjectCostSummary,
  type Webhook,
  type WebhookType,
  type WebhookEventType,
} from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WidgetField {
  key: string;
  label: string;
  type: 'toggle' | 'text' | 'password' | 'number' | 'select';
  options?: { label: string; value: string }[];
  placeholder?: string;
  defaultValue: string;
}

interface WidgetDef {
  category: string;
  title: string;
  icon: string;
  color: string;
  description: string;
  fields: WidgetField[];
}

// ---------------------------------------------------------------------------
// Widget definitions
// ---------------------------------------------------------------------------

const WIDGETS: WidgetDef[] = [
  {
    category: 'sonarqube',
    title: 'SonarQube',
    icon: '\u{1F6E1}',
    color: '#a78bfa',
    description: 'Kod kalitesi analizi ve quality gate kontrolu. Docker uzerinde calisir.',
    fields: [
      { key: 'enabled', label: 'Aktif', type: 'toggle', defaultValue: 'false' },
      { key: 'hostUrl', label: 'Host URL', type: 'text', placeholder: 'http://localhost:9000', defaultValue: 'http://localhost:9000' },
      { key: 'token', label: 'Token', type: 'password', placeholder: 'squ_...', defaultValue: '' },
    ],
  },
  {
    category: 'eslint',
    title: 'ESLint',
    icon: '\u{1F4DD}',
    color: '#60a5fa',
    description: 'Task tamamlandiginda otomatik eslint --fix calistirir.',
    fields: [
      { key: 'enabled', label: 'Aktif', type: 'toggle', defaultValue: 'true' },
      {
        key: 'preset',
        label: 'Kural Seti',
        type: 'select',
        options: [
          { label: 'Recommended', value: 'recommended' },
          { label: 'Strict', value: 'strict' },
          { label: 'Custom', value: 'custom' },
        ],
        defaultValue: 'recommended',
      },
    ],
  },
  {
    category: 'prettier',
    title: 'Prettier',
    icon: '\u{1F3A8}',
    color: '#f472b6',
    description: 'Task tamamlandiginda otomatik prettier --write calistirir.',
    fields: [
      { key: 'enabled', label: 'Aktif', type: 'toggle', defaultValue: 'true' },
      { key: 'printWidth', label: 'Print Width', type: 'number', placeholder: '100', defaultValue: '100' },
      {
        key: 'singleQuote',
        label: 'Single Quote',
        type: 'select',
        options: [
          { label: 'Evet', value: 'true' },
          { label: 'Hayir', value: 'false' },
        ],
        defaultValue: 'true',
      },
      {
        key: 'trailingComma',
        label: 'Trailing Comma',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'ES5', value: 'es5' },
          { label: 'None', value: 'none' },
        ],
        defaultValue: 'all',
      },
    ],
  },
  {
    category: 'ai_model',
    title: 'AI Model',
    icon: '\u{1F916}',
    color: '#34d399',
    description: 'Agent\'larin kullandigi AI model ve provider ayarlari.',
    fields: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        options: [
          { label: 'OpenAI', value: 'openai' },
          { label: 'Anthropic', value: 'anthropic' },
          { label: 'Google', value: 'google' },
          { label: 'Ollama', value: 'ollama' },
        ],
        defaultValue: 'openai',
      },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gpt-4o', defaultValue: '' },
      { key: 'maxRetries', label: 'Max Retries', type: 'number', placeholder: '8', defaultValue: '8' },
      { key: 'timeout', label: 'Timeout (dk)', type: 'number', placeholder: '5', defaultValue: '5' },
    ],
  },
  {
    category: 'auto_docs',
    title: 'Otomatik Dokumantasyon',
    icon: '\u{1F4C4}',
    color: '#fbbf24',
    description: 'Agent rollere gore docs/ dosyalarini otomatik doldurur.',
    fields: [
      { key: 'enabled', label: 'Aktif', type: 'toggle', defaultValue: 'true' },
      { key: 'projectMd', label: 'PROJECT.md (PM)', type: 'toggle', defaultValue: 'true' },
      { key: 'architectureMd', label: 'ARCHITECTURE.md (Architect)', type: 'toggle', defaultValue: 'true' },
      { key: 'apiContractMd', label: 'API_CONTRACT.md (Backend)', type: 'toggle', defaultValue: 'true' },
      { key: 'changelogMd', label: 'CHANGELOG.md (All)', type: 'toggle', defaultValue: 'true' },
    ],
  },
  {
    category: 'budget',
    title: 'Budget Limiti',
    icon: '\u{1F4B0}',
    color: '#f87171',
    description: 'Proje bazinda maliyet limiti. Limit asildiginda execution durur.',
    fields: [
      { key: 'enabled', label: 'Aktif', type: 'toggle', defaultValue: 'false' },
      { key: 'maxCostUsd', label: 'Max Maliyet ($)', type: 'number', placeholder: '10.00', defaultValue: '' },
      { key: 'warningThreshold', label: 'Uyari Esigi ($)', type: 'number', placeholder: '8.00', defaultValue: '' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Budget Status Bar — Mevcut harcama / limit görsel göstergesi
// ---------------------------------------------------------------------------

function BudgetStatusBar({
  currentCost,
  maxCost,
  warningThreshold,
}: {
  currentCost: number;
  maxCost: number;
  warningThreshold?: number;
}) {
  const pct = Math.min(100, (currentCost / maxCost) * 100);
  const isError = pct >= 100;
  // Uyarı eşiği: belirtilmişse o değer, yoksa %80
  const warnPct = warningThreshold ? (warningThreshold / maxCost) * 100 : 80;
  const isWarning = !isError && pct >= warnPct;

  const barColor = isError
    ? 'bg-[#ef4444]'
    : isWarning
      ? 'bg-[#f59e0b]'
      : 'bg-[#22c55e]';

  const textColor = isError
    ? 'text-[#ef4444]'
    : isWarning
      ? 'text-[#f59e0b]'
      : 'text-[#22c55e]';

  return (
    <div className="mt-3 space-y-1.5">
      {/* Progress bar */}
      <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Harcama durumu */}
      <div className="flex items-center justify-between text-[10px]">
        <span className={`font-medium ${textColor}`}>
          ${currentCost.toFixed(4)} harcandı
        </span>
        <span className="text-[#525252]">
          Limit: ${maxCost.toFixed(2)} ({Math.round(pct)}%)
        </span>
      </div>

      {/* Durum mesajı */}
      {isError && (
        <div className="flex items-center gap-1 text-[10px] text-[#ef4444] bg-[#ef4444]/5 border border-[#ef4444]/20 rounded px-2 py-1">
          <AlertCircle size={10} className="shrink-0" />
          Budget limiti aşıldı — execution durduruldu
        </div>
      )}
      {isWarning && (
        <div className="flex items-center gap-1 text-[10px] text-[#f59e0b] bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded px-2 py-1">
          <TrendingUp size={10} className="shrink-0" />
          Budget limitine yaklaşılıyor — dikkat
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle Component
// ---------------------------------------------------------------------------

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        value ? 'bg-[#22c55e]' : 'bg-[#333333]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          value ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Widget Card Component
// ---------------------------------------------------------------------------

function WidgetCard({
  widget,
  values,
  onChange,
  onSave,
  saving,
  saved,
}: {
  widget: WidgetDef;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  const isEnabled = values['enabled'] !== 'false';
  const hasEnabledToggle = widget.fields.some((f) => f.key === 'enabled');

  return (
    <div
      className={`bg-[#111111] border rounded-xl overflow-hidden transition-all ${
        hasEnabledToggle && !isEnabled ? 'border-[#1a1a1a] opacity-60' : 'border-[#262626]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
        <span className="text-base">{widget.icon}</span>
        <h3 className="text-[12px] font-semibold text-[#fafafa]">{widget.title}</h3>
        <span className="ml-auto flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-[10px] text-[#22c55e]">
              <CheckCircle2 size={10} /> Kaydedildi
            </span>
          )}
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
            Kaydet
          </button>
        </span>
      </div>

      {/* Description */}
      <div className="px-4 py-2">
        <p className="text-[10px] text-[#525252]">{widget.description}</p>
      </div>

      {/* Fields */}
      <div className="px-4 pb-3 space-y-2.5">
        {widget.fields.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-3">
            <label className="text-[11px] text-[#a3a3a3] shrink-0 min-w-[100px]">{field.label}</label>

            {field.type === 'toggle' && (
              <Toggle
                value={values[field.key] === 'true'}
                onChange={(v) => onChange(field.key, v ? 'true' : 'false')}
              />
            )}

            {field.type === 'text' && (
              <input
                type="text"
                value={values[field.key] || ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040] max-w-[200px]"
              />
            )}

            {field.type === 'password' && (
              <input
                type="password"
                value={values[field.key] || ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040] max-w-[200px]"
              />
            )}

            {field.type === 'number' && (
              <input
                type="number"
                value={values[field.key] || ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040] max-w-[120px]"
              />
            )}

            {field.type === 'select' && (
              <select
                value={values[field.key] || field.defaultValue}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] focus:outline-none focus:border-[#404040] max-w-[200px]"
              >
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Desteklenen Webhook Event Tipleri
// ---------------------------------------------------------------------------

const WEBHOOK_EVENTS: { value: WebhookEventType; label: string }[] = [
  { value: 'task_completed',         label: 'Görev Tamamlandı' },
  { value: 'task_failed',            label: 'Görev Başarısız' },
  { value: 'task_approval_required', label: 'Onay Bekliyor' },
  { value: 'task_approved',          label: 'Görev Onaylandı' },
  { value: 'task_rejected',          label: 'Görev Reddedildi' },
  { value: 'pipeline_completed',     label: 'Pipeline Bitti' },
  { value: 'execution_error',        label: 'Çalışma Hatası' },
  { value: 'budget_warning',         label: 'Bütçe Uyarısı' },
  { value: 'plan_approved',          label: 'Plan Onaylandı' },
  { value: 'agent_started',          label: 'Agent Başladı' },
  { value: 'agent_stopped',          label: 'Agent Durdu' },
];

const WEBHOOK_TYPE_LABELS: Record<WebhookType, { label: string; color: string }> = {
  slack:   { label: 'Slack',   color: '#e879f9' },
  discord: { label: 'Discord', color: '#818cf8' },
  generic: { label: 'Generic', color: '#60a5fa' },
};

// ---------------------------------------------------------------------------
// Webhook Modal — yeni webhook olustur / mevcut webhook'u duzenle
// ---------------------------------------------------------------------------

interface WebhookModalProps {
  projectId: string;
  initial?: Partial<Webhook>;
  onClose: () => void;
  onSaved: (webhook: Webhook) => void;
}

function WebhookModal({ projectId, initial, onClose, onSaved }: WebhookModalProps) {
  const [name, setName]       = useState(initial?.name ?? '');
  const [url, setUrl]         = useState(initial?.url ?? '');
  const [type, setType]       = useState<WebhookType>(initial?.type ?? 'generic');
  const [events, setEvents]   = useState<WebhookEventType[]>(initial?.events ?? []);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  // Event checkbox toggle
  const toggleEvent = (ev: WebhookEventType) => {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  };

  const handleSave = async () => {
    setErr(null);
    // URL doğrulaması
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      setErr('URL https:// ile baslamamali');
      return;
    }
    if (!name.trim()) {
      setErr('Webhook adi zorunludur');
      return;
    }

    setSaving(true);
    try {
      let saved: Webhook;
      if (initial?.id) {
        // Mevcut webhook'u guncelle
        saved = await updateWebhook(projectId, initial.id, { name, url, type, events });
      } else {
        // Yeni webhook olustur
        saved = await createWebhook(projectId, { name, url, type, events });
      }
      onSaved(saved);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kaydetme basarisiz');
    } finally {
      setSaving(false);
    }
  };

  return (
    /* Modal arka plan */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-[#111111] border border-[#262626] rounded-xl p-5 space-y-4 shadow-2xl">
        {/* Baslik */}
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#fafafa]">
            {initial?.id ? 'Webhook Duzenle' : 'Webhook Ekle'}
          </h3>
          <button
            onClick={onClose}
            className="text-[#525252] hover:text-[#a3a3a3] text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Hata mesaji */}
        {err && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#450a0a]/40 border border-[#7f1d1d] rounded-lg text-[11px] text-[#f87171]">
            <AlertCircle size={11} />
            {err}
          </div>
        )}

        {/* Webhook Adi */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-[#a3a3a3]">Ad</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Deploy bildirimleri"
            className="w-full bg-[#0a0a0a] border border-[#262626] rounded-md px-3 py-1.5 text-[12px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040]"
          />
        </div>

        {/* URL */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-[#a3a3a3]">Webhook URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full bg-[#0a0a0a] border border-[#262626] rounded-md px-3 py-1.5 text-[12px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040]"
          />
        </div>

        {/* Tur secimi */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-[#a3a3a3]">Tur</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as WebhookType)}
            className="w-full bg-[#0a0a0a] border border-[#262626] rounded-md px-3 py-1.5 text-[12px] text-[#fafafa] focus:outline-none focus:border-[#404040]"
          >
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="generic">Generic (JSON)</option>
          </select>
        </div>

        {/* Event secimi */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-[#a3a3a3]">Dinlenecek Event'ler</label>
          <div className="grid grid-cols-2 gap-1.5">
            {WEBHOOK_EVENTS.map(({ value, label }) => (
              <label
                key={value}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={events.includes(value)}
                  onChange={() => toggleEvent(value)}
                  className="w-3.5 h-3.5 accent-[#22c55e]"
                />
                <span className="text-[11px] text-[#a3a3a3]">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Butonlar */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            Iptal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-black text-[11px] font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WebhookRow — tek bir webhook satirini gosterir
// ---------------------------------------------------------------------------

function WebhookRow({
  webhook,
  projectId,
  onEdit,
  onDeleted,
}: {
  webhook: Webhook;
  projectId: string;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [testing, setTesting]   = useState(false);
  const [testMsg, setTestMsg]   = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await testWebhook(projectId, webhook.id);
      setTestMsg(res.success ? 'Test gonderildi!' : 'Test basarisiz');
      setTimeout(() => setTestMsg(null), 3000);
    } catch {
      setTestMsg('Test hatasi');
      setTimeout(() => setTestMsg(null), 3000);
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await updateWebhook(projectId, webhook.id, { active: !webhook.active });
      onDeleted(); // Listeyi yenile
    } catch {
      // sessiz hata
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`"${webhook.name}" webhook'u silinsin mi?`)) return;
    try {
      await deleteWebhook(projectId, webhook.id);
      onDeleted();
    } catch {
      // sessiz hata
    }
  };

  const typeInfo = WEBHOOK_TYPE_LABELS[webhook.type];

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg hover:border-[#262626] transition-colors">
      {/* Tur rozeti */}
      <span
        className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0"
        style={{ color: typeInfo.color, backgroundColor: typeInfo.color + '22' }}
      >
        {typeInfo.label}
      </span>

      {/* Isim ve URL */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-[#fafafa] truncate">{webhook.name}</p>
        <p className="text-[10px] text-[#525252] truncate">{webhook.url}</p>
      </div>

      {/* Event sayisi */}
      <span className="text-[10px] text-[#525252] shrink-0">
        {webhook.events.length} event
      </span>

      {/* Test mesaji */}
      {testMsg && (
        <span className="text-[10px] text-[#22c55e] shrink-0">{testMsg}</span>
      )}

      {/* Aktif/Pasif toggle */}
      {toggling ? (
        <Loader2 size={12} className="animate-spin text-[#525252]" />
      ) : (
        <button
          onClick={handleToggle}
          title={webhook.active ? 'Pasif yap' : 'Aktif yap'}
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${webhook.active ? 'bg-[#22c55e]' : 'bg-[#333333]'}`}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${webhook.active ? 'translate-x-[13px]' : 'translate-x-[2px]'}`}
          />
        </button>
      )}

      {/* Eylemler: Test / Duzenle / Sil */}
      <button
        onClick={handleTest}
        disabled={testing}
        title="Test bildirimi gonder"
        className="text-[#525252] hover:text-[#60a5fa] transition-colors disabled:opacity-50"
      >
        {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
      </button>
      <button
        onClick={onEdit}
        title="Duzenle"
        className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
      >
        <Save size={12} />
      </button>
      <button
        onClick={handleDelete}
        title="Sil"
        className="text-[#525252] hover:text-[#f87171] transition-colors"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WebhookSection — webhook listesi ve yonetim paneli
// ---------------------------------------------------------------------------

function WebhookSection({ projectId }: { projectId: string }) {
  const [webhooks, setWebhooks]         = useState<Webhook[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showModal, setShowModal]       = useState(false);
  const [editTarget, setEditTarget]     = useState<Webhook | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWebhooks(projectId);
      setWebhooks(data);
    } catch {
      // sessiz hata
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (wh: Webhook) => {
    setShowModal(false);
    setEditTarget(null);
    // Listeyi guncelle: var olan webhook'u degistir, yeniyse ekle
    setWebhooks((prev) => {
      const idx = prev.findIndex((w) => w.id === wh.id);
      return idx >= 0 ? prev.map((w) => (w.id === wh.id ? wh : w)) : [wh, ...prev];
    });
  };

  const handleEdit = (wh: Webhook) => {
    setEditTarget(wh);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditTarget(null);
    setShowModal(true);
  };

  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
      {/* Baslik */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
        <Globe size={14} className="text-[#22c55e]" />
        <h3 className="text-[12px] font-semibold text-[#fafafa]">Webhooks</h3>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            <Plus size={10} />
            Webhook Ekle
          </button>
        </span>
      </div>

      {/* Aciklama */}
      <div className="px-4 py-2">
        <p className="text-[10px] text-[#525252]">
          Slack, Discord veya herhangi bir sisteme event bildirimleri gonderin.
          Gorev tamamlanma, pipeline bitis ve hata durumlarini anlık takip edin.
        </p>
      </div>

      {/* Liste */}
      <div className="px-4 pb-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 size={14} className="animate-spin text-[#525252]" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="text-center py-6 text-[10px] text-[#525252]">
            Henuz webhook eklenmedi. &quot;Webhook Ekle&quot; butonuna tiklayin.
          </div>
        ) : (
          webhooks.map((wh) => (
            <WebhookRow
              key={wh.id}
              webhook={wh}
              projectId={projectId}
              onEdit={() => handleEdit(wh)}
              onDeleted={load}
            />
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <WebhookModal
          projectId={projectId}
          initial={editTarget ?? undefined}
          onClose={() => { setShowModal(false); setEditTarget(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  projectId: string;
}

export default function ProjectSettings({ projectId }: Props) {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [local, setLocal] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState<string | null>(null);
  const [savedCategory, setSavedCategory] = useState<string | null>(null);
  // Mevcut proje harcama özeti — budget widget'ında progress bar için kullanılır
  const [costSummary, setCostSummary] = useState<ProjectCostSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Ayarları ve maliyet özetini paralel olarak yükle
      const [data, costsResult] = await Promise.allSettled([
        fetchProjectSettings(projectId),
        fetchProjectCosts(projectId),
      ]);

      const settingsData = data.status === 'fulfilled' ? data.value : {};
      setSettings(settingsData);
      if (costsResult.status === 'fulfilled') setCostSummary(costsResult.value);

      // Build local state from saved settings + defaults
      const localMap: SettingsMap = {};
      for (const widget of WIDGETS) {
        localMap[widget.category] = {};
        for (const field of widget.fields) {
          localMap[widget.category][field.key] =
            settingsData[widget.category]?.[field.key] ?? field.defaultValue;
        }
      }
      setLocal(localMap);

      if (data.status === 'rejected') throw data.reason;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ayarlar yuklenemedi');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (category: string, key: string, value: string) => {
    setLocal((prev) => ({
      ...prev,
      [category]: { ...prev[category], [key]: value },
    }));
    // Clear "saved" indicator when user makes changes
    if (savedCategory === category) setSavedCategory(null);
  };

  const handleSave = async (category: string) => {
    setSavingCategory(category);
    try {
      await saveProjectSettings(projectId, category, local[category] || {});
      setSavedCategory(category);
      setTimeout(() => setSavedCategory((prev) => (prev === category ? null : prev)), 2000);
    } catch {
      setError(`${category} kaydedilemedi`);
    } finally {
      setSavingCategory(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-[#525252]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-[#fafafa]">Proje Ayarlari</h2>
          <p className="text-[11px] text-[#525252] mt-0.5">
            Entegrasyonlari ve arac ayarlarini yonetin
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#450a0a]/40 border border-[#7f1d1d] rounded-lg text-[11px] text-[#f87171]">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {WIDGETS.map((widget) => {
          const isBudget = widget.category === 'budget';
          const budgetValues = local['budget'] || {};
          const budgetEnabled = budgetValues['enabled'] === 'true';
          const maxCostUsd = parseFloat(budgetValues['maxCostUsd'] || '0');
          const warningThreshold = parseFloat(budgetValues['warningThreshold'] || '0');
          const showBudgetBar =
            isBudget &&
            budgetEnabled &&
            maxCostUsd > 0 &&
            costSummary !== null;

          return (
            <div key={widget.category}>
              <WidgetCard
                widget={widget}
                values={local[widget.category] || {}}
                onChange={(key, value) => handleChange(widget.category, key, value)}
                onSave={() => handleSave(widget.category)}
                saving={savingCategory === widget.category}
                saved={savedCategory === widget.category}
              />
              {/* Budget kategorisi için gerçek harcama progress bar'ı */}
              {showBudgetBar && costSummary && (
                <div className="px-4 pb-3 -mt-1 bg-[#111111] border border-[#262626] border-t-0 rounded-b-xl mx-0">
                  <BudgetStatusBar
                    currentCost={costSummary.totalCostUsd}
                    maxCost={maxCostUsd}
                    warningThreshold={warningThreshold > 0 ? warningThreshold : undefined}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Webhooks Bolumu */}
      <WebhookSection projectId={projectId} />
    </div>
  );
}
