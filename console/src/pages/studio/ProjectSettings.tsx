// ---------------------------------------------------------------------------
// AI Dev Studio — Project Settings (Integration Widgets)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  fetchProjectSettings,
  saveProjectSettings,
  type SettingsMap,
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProjectSettings(projectId);
      setSettings(data);

      // Build local state from saved settings + defaults
      const localMap: SettingsMap = {};
      for (const widget of WIDGETS) {
        localMap[widget.category] = {};
        for (const field of widget.fields) {
          localMap[widget.category][field.key] =
            data[widget.category]?.[field.key] ?? field.defaultValue;
        }
      }
      setLocal(localMap);
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
        {WIDGETS.map((widget) => (
          <WidgetCard
            key={widget.category}
            widget={widget}
            values={local[widget.category] || {}}
            onChange={(key, value) => handleChange(widget.category, key, value)}
            onSave={() => handleSave(widget.category)}
            saving={savingCategory === widget.category}
            saved={savedCategory === widget.category}
          />
        ))}
      </div>
    </div>
  );
}
