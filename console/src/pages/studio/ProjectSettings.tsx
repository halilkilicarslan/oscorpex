// ---------------------------------------------------------------------------
// Oscorpex — Project Settings (Integration Widgets)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle, TrendingUp, Plus, Trash2, Zap, Globe, Shield, Lock, Edit2, X } from 'lucide-react';
import {
  fetchProjectSettings,
  saveProjectSettings,
  fetchProjectCosts,
  fetchWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  fetchCustomPolicyRules,
  saveCustomPolicyRules,
  type SettingsMap,
  type ProjectCostSummary,
  type Webhook,
  type WebhookType,
  type WebhookEventType,
  type PolicyRule,
  type PolicyAction,
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
  {
    category: 'scoring',
    title: 'Ajan Puanlama',
    icon: '\u{2B50}',
    color: '#facc15',
    description: 'Ajan performans skoru agirlik ve baseline ayarlari.',
    fields: [
      { key: 'w_success', label: 'Basari Orani Agirligi (%)', type: 'number', placeholder: '30', defaultValue: '30' },
      { key: 'w_firstPass', label: 'Ilk Gecis Agirligi (%)', type: 'number', placeholder: '25', defaultValue: '25' },
      { key: 'w_review', label: 'Review Onay Agirligi (%)', type: 'number', placeholder: '20', defaultValue: '20' },
      { key: 'w_time', label: 'Hiz Agirligi (%)', type: 'number', placeholder: '15', defaultValue: '15' },
      { key: 'w_cost', label: 'Maliyet Agirligi (%)', type: 'number', placeholder: '10', defaultValue: '10' },
      { key: 'baselineTimeMin', label: 'Hiz Baseline (dk)', type: 'number', placeholder: '30', defaultValue: '30' },
      { key: 'baselineCostUsd', label: 'Maliyet Baseline ($)', type: 'number', placeholder: '0.50', defaultValue: '0.50' },
    ],
  },
  {
    category: 'model_routing',
    title: 'Model Routing',
    icon: '\u{1F9E0}',
    color: '#38bdf8',
    description: 'Task karmasikligina gore AI model atamasi (S/M/L/XL). Bos birakirsan varsayilan kullanilir.',
    fields: [
      { key: 'S', label: 'S (Kucuk)', type: 'text', placeholder: 'claude-haiku-4-5-20251001', defaultValue: '' },
      { key: 'M', label: 'M (Orta)', type: 'text', placeholder: 'claude-sonnet-4-6', defaultValue: '' },
      { key: 'L', label: 'L (Buyuk)', type: 'text', placeholder: 'claude-sonnet-4-6', defaultValue: '' },
      { key: 'XL', label: 'XL (Cok Buyuk)', type: 'text', placeholder: 'claude-opus-4-6', defaultValue: '' },
    ],
  },
  {
    category: 'policy',
    title: 'Governance Policy',
    icon: '\u{1F6E1}',
    color: '#fb923c',
    description: 'Task dispatch oncesi politika kontrolu. Asim durumunda task bloklanir veya uyari verilir.',
    fields: [
      { key: 'task_budget_usd', label: 'Task Basina Maks Maliyet ($)', type: 'number', placeholder: '5.00', defaultValue: '' },
      { key: 'multi_reviewer_pattern', label: 'Coklu Reviewer Pattern (regex)', type: 'text', placeholder: 'src/auth/.*', defaultValue: '' },
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
// Policy Section (v3.7) — Built-in + custom governance rules
// ---------------------------------------------------------------------------

const POLICY_ACTIONS: { value: PolicyAction; label: string; color: string }[] = [
  { value: 'block', label: 'Block', color: 'text-[#f87171] border-[#7f1d1d] bg-[#450a0a]/40' },
  { value: 'warn', label: 'Warn', color: 'text-[#fbbf24] border-[#78350f] bg-[#451a03]/40' },
  { value: 'require_approval', label: 'Require Approval', color: 'text-[#60a5fa] border-[#1e3a8a] bg-[#0c1e3f]/40' },
];

type ConditionPattern = 'complexity' | 'title_contains' | 'branch' | 'description_contains';

const CONDITION_PATTERNS: { value: ConditionPattern; label: string; placeholder: string }[] = [
  { value: 'complexity',           label: 'complexity ==',      placeholder: 'S | M | L | XL' },
  { value: 'title_contains',       label: 'title contains',     placeholder: 'auth, migration...' },
  { value: 'branch',               label: 'branch ==',          placeholder: 'main, develop...' },
  { value: 'description_contains', label: 'description contains', placeholder: 'security, hotfix...' },
];

const BUILTIN_RULES_INFO: { id: string; name: string; description: string; setting: string }[] = [
  {
    id: 'max_cost_per_task',
    name: 'Max cost per task',
    description: 'Tek bir gorevin toplam maliyeti butce tavanini asarsa bloklar.',
    setting: 'budget.maxCostUsd > 0 iken aktif',
  },
  {
    id: 'require_approval_for_large',
    name: 'Require approval for large tasks',
    description: 'Complexity L veya XL olan tum gorevler onay ister.',
    setting: 'Daima aktif',
  },
  {
    id: 'multi_reviewer',
    name: 'Multi-reviewer for sensitive files',
    description: 'Hassas dosyalara dokunan gorevlerde birden fazla reviewer uyarisi.',
    setting: 'Daima aktif (warn)',
  },
];

function parseCondition(condition: string): { pattern: ConditionPattern; value: string } {
  const trimmed = condition.trim();
  const complexityMatch = trimmed.match(/^complexity\s*==\s*(.+)$/i);
  if (complexityMatch) return { pattern: 'complexity', value: complexityMatch[1].trim() };
  const titleMatch = trimmed.match(/^title\s+contains\s+(.+)$/i);
  if (titleMatch) return { pattern: 'title_contains', value: titleMatch[1].trim() };
  const branchMatch = trimmed.match(/^branch\s*==\s*(.+)$/i);
  if (branchMatch) return { pattern: 'branch', value: branchMatch[1].trim() };
  const descMatch = trimmed.match(/^description\s+contains\s+(.+)$/i);
  if (descMatch) return { pattern: 'description_contains', value: descMatch[1].trim() };
  return { pattern: 'complexity', value: '' };
}

function buildCondition(pattern: ConditionPattern, value: string): string {
  const v = value.trim();
  switch (pattern) {
    case 'complexity':           return `complexity == ${v}`;
    case 'title_contains':       return `title contains ${v}`;
    case 'branch':               return `branch == ${v}`;
    case 'description_contains': return `description contains ${v}`;
  }
}

interface PolicyRuleModalProps {
  projectId: string;
  initial: PolicyRule | null;
  onClose: () => void;
  onSave: (rule: PolicyRule) => void;
}

function PolicyRuleModal({ projectId, initial, onClose, onSave }: PolicyRuleModalProps) {
  const parsed = initial ? parseCondition(initial.condition) : { pattern: 'complexity' as ConditionPattern, value: '' };
  const [name, setName]       = useState(initial?.name ?? '');
  const [pattern, setPattern] = useState<ConditionPattern>(parsed.pattern);
  const [value, setValue]     = useState(parsed.value);
  const [action, setAction]   = useState<PolicyAction>((initial?.action as PolicyAction) ?? 'warn');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError]     = useState<string | null>(null);

  const handleSave = () => {
    if (!name.trim()) { setError('Kural adi zorunludur'); return; }
    if (!value.trim()) { setError('Kosul degeri zorunludur'); return; }
    const rule: PolicyRule = {
      id: initial?.id ?? `custom-${Date.now()}`,
      projectId,
      name: name.trim(),
      condition: buildCondition(pattern, value),
      action,
      enabled,
    };
    onSave(rule);
  };

  const placeholder = CONDITION_PATTERNS.find((p) => p.value === pattern)?.placeholder ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
          <h3 className="text-[12px] font-semibold text-[#fafafa]">
            {initial ? 'Kurali Duzenle' : 'Yeni Kural'}
          </h3>
          <button onClick={onClose} className="text-[#525252] hover:text-[#a3a3a3]">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
              <AlertCircle size={10} />
              {error}
            </div>
          )}

          <div>
            <label className="block text-[10px] text-[#a3a3a3] mb-1">Kural Adi</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ornegin: Security-sensitive path gate"
              className="w-full px-2.5 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] placeholder-[#404040] focus:outline-none focus:border-[#22c55e]"
            />
          </div>

          <div>
            <label className="block text-[10px] text-[#a3a3a3] mb-1">Kosul</label>
            <div className="flex gap-2">
              <select
                value={pattern}
                onChange={(e) => setPattern(e.target.value as ConditionPattern)}
                className="px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
              >
                {CONDITION_PATTERNS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                className="flex-1 px-2.5 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] placeholder-[#404040] focus:outline-none focus:border-[#22c55e]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-[#a3a3a3] mb-1">Aksiyon</label>
            <div className="flex gap-1.5">
              {POLICY_ACTIONS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => setAction(a.value)}
                  className={`flex-1 px-2 py-1.5 text-[10px] border rounded transition-colors ${
                    action === a.value
                      ? a.color
                      : 'text-[#525252] border-[#262626] hover:border-[#404040]'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-[10px] text-[#a3a3a3]">Aktif</label>
            <Toggle value={enabled} onChange={setEnabled} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1a1a1a]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[10px] text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
          >
            Iptal
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-[10px] bg-[#22c55e] text-black font-medium rounded hover:bg-[#16a34a] transition-colors"
          >
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function actionBadgeClass(action: string): string {
  const found = POLICY_ACTIONS.find((a) => a.value === action);
  return found?.color ?? 'text-[#a3a3a3] border-[#262626] bg-[#0a0a0a]';
}

function PolicySection({ projectId }: { projectId: string }) {
  const [rules, setRules]         = useState<PolicyRule[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<PolicyRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCustomPolicyRules(projectId);
      setRules(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Policy yuklenemedi');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const persist = async (next: PolicyRule[]) => {
    setSaving(true);
    setError(null);
    try {
      await saveCustomPolicyRules(projectId, next);
      setRules(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRule = (rule: PolicyRule) => {
    const idx = rules.findIndex((r) => r.id === rule.id);
    const next = idx >= 0 ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
    setShowModal(false);
    setEditTarget(null);
    void persist(next);
  };

  const handleToggle = (rule: PolicyRule) => {
    void persist(rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
  };

  const handleDelete = (rule: PolicyRule) => {
    if (!confirm(`"${rule.name}" kuralini sil?`)) return;
    void persist(rules.filter((r) => r.id !== rule.id));
  };

  const handleAdd = () => {
    setEditTarget(null);
    setShowModal(true);
  };

  const handleEdit = (rule: PolicyRule) => {
    setEditTarget(rule);
    setShowModal(true);
  };

  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
      {/* Baslik */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
        <Shield size={14} className="text-[#22c55e]" />
        <h3 className="text-[12px] font-semibold text-[#fafafa]">Policy Rules</h3>
        <span className="ml-auto flex items-center gap-3">
          {saving && <Loader2 size={12} className="animate-spin text-[#525252]" />}
          {saved && (
            <span className="flex items-center gap-1 text-[10px] text-[#22c55e]">
              <CheckCircle2 size={10} />
              Kaydedildi
            </span>
          )}
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
          >
            <Plus size={10} />
            Kural Ekle
          </button>
        </span>
      </div>

      {/* Aciklama */}
      <div className="px-4 py-2">
        <p className="text-[10px] text-[#525252]">
          Gorev baslatilmadan once kosullari degerlendirir; bloklama, uyari veya onay isteyebilir.
          Yerlesik kurallar daima aktiftir; kendi ozel kurallarinizi ekleyebilirsiniz.
        </p>
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-center gap-2 px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
          <AlertCircle size={10} />
          {error}
        </div>
      )}

      {/* Built-in rules */}
      <div className="px-4 pb-3">
        <div className="text-[9px] uppercase tracking-wider text-[#525252] mb-1.5">
          Yerlesik Kurallar
        </div>
        <div className="space-y-1.5">
          {BUILTIN_RULES_INFO.map((r) => (
            <div
              key={r.id}
              className="flex items-start gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded"
            >
              <Lock size={11} className="text-[#525252] mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#fafafa] font-medium">{r.name}</span>
                  <span className="text-[9px] text-[#525252]">({r.setting})</span>
                </div>
                <div className="text-[10px] text-[#a3a3a3] mt-0.5">{r.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom rules */}
      <div className="px-4 pb-4">
        <div className="text-[9px] uppercase tracking-wider text-[#525252] mb-1.5">
          Ozel Kurallar
        </div>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 size={14} className="animate-spin text-[#525252]" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-4 text-[10px] text-[#525252] bg-[#0a0a0a] border border-[#1a1a1a] rounded">
            Henuz ozel kural yok. &quot;Kural Ekle&quot; butonuna tiklayin.
          </div>
        ) : (
          <div className="space-y-1.5">
            {rules.map((r) => (
              <div
                key={r.id}
                className={`flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded ${!r.enabled ? 'opacity-50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-[#fafafa] font-medium">{r.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 border rounded ${actionBadgeClass(r.action)}`}>
                      {r.action}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#a3a3a3] mt-0.5 font-mono">{r.condition}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Toggle value={r.enabled} onChange={() => handleToggle(r)} />
                  <button
                    onClick={() => handleEdit(r)}
                    className="p-1 text-[#525252] hover:text-[#a3a3a3] transition-colors"
                    title="Duzenle"
                  >
                    <Edit2 size={11} />
                  </button>
                  <button
                    onClick={() => handleDelete(r)}
                    className="p-1 text-[#525252] hover:text-[#f87171] transition-colors"
                    title="Sil"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <PolicyRuleModal
          projectId={projectId}
          initial={editTarget}
          onClose={() => { setShowModal(false); setEditTarget(null); }}
          onSave={handleSaveRule}
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
  const [, setSettings] = useState<SettingsMap>({});
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

      {/* Policy Rules (v3.7) */}
      <PolicySection projectId={projectId} />
    </div>
  );
}
