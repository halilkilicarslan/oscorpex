import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Star,
  Eye,
  EyeOff,
  Zap,
  Loader2,
  X,
  CheckCircle2,
  XCircle,
  ToggleLeft,
  ToggleRight,
  Settings,
  ChevronUp,
  ChevronDown,
  ListOrdered,
} from 'lucide-react';
import {
  fetchProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  testProvider,
  fetchFallbackChain,
  updateFallbackOrder,
  type AIProvider,
  type AIProviderType,
} from '../../lib/studio-api';
import { MODEL_OPTIONS } from '../../lib/model-options';

// ---------------------------------------------------------------------------
// Provider type metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: string[];
  color: string;
}

const PROVIDER_META: Record<AIProviderType, ProviderMeta> = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: '',
    defaultModel: 'gpt-4o-mini',
    models: MODEL_OPTIONS.openai,
    color: 'text-[#10a37f]',
  },
  anthropic: {
    label: 'Anthropic',
    defaultBaseUrl: '',
    defaultModel: 'claude-sonnet-4-20250514',
    models: MODEL_OPTIONS.anthropic,
    color: 'text-[#d97706]',
  },
  google: {
    label: 'Google',
    defaultBaseUrl: '',
    defaultModel: 'gemini-2.0-flash',
    models: MODEL_OPTIONS.google,
    color: 'text-[#4285f4]',
  },
  ollama: {
    label: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
    models: MODEL_OPTIONS.ollama,
    color: 'text-[#a855f7]',
  },
  custom: {
    label: 'Custom',
    defaultBaseUrl: '',
    defaultModel: '',
    models: MODEL_OPTIONS.custom,
    color: 'text-[#a3a3a3]',
  },
};

// ---------------------------------------------------------------------------
// Type badge
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: AIProviderType }) {
  const meta = PROVIDER_META[type];
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#1f1f1f] border border-[#262626] ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Test result indicator
// ---------------------------------------------------------------------------

type TestState = 'idle' | 'testing' | 'success' | 'failure';

function TestIndicator({ state, message }: { state: TestState; message?: string }) {
  if (state === 'idle') return null;
  if (state === 'testing') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-[#a3a3a3]">
        <Loader2 size={11} className="animate-spin" />
        Testing...
      </span>
    );
  }
  if (state === 'success') {
    return (
      <span
        className="flex items-center gap-1 text-[11px] text-[#22c55e]"
        title={message}
      >
        <CheckCircle2 size={11} />
        Connected
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 text-[11px] text-[#ef4444]"
      title={message}
    >
      <XCircle size={11} />
      Failed
    </span>
  );
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  onEdit,
  onDelete,
  onSetDefault,
  onToggleActive,
  onTest,
  testState,
  testMessage,
}: {
  provider: AIProvider;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onToggleActive: () => void;
  onTest: () => void;
  testState: TestState;
  testMessage?: string;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div
      className={`bg-[#111111] border rounded-xl p-5 transition-colors group ${
        provider.isDefault ? 'border-[#22c55e]/40' : 'border-[#262626] hover:border-[#333]'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0">
            <Zap size={18} className="text-[#22c55e]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-[14px] font-semibold text-[#fafafa]">{provider.name}</h3>
              {provider.isDefault && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30">
                  <Star size={8} />
                  DEFAULT
                </span>
              )}
              {!provider.isActive && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20">
                  INACTIVE
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <TypeBadge type={provider.type} />
              {provider.model && (
                <span className="text-[10px] text-[#525252]">{provider.model}</span>
              )}
            </div>
          </div>
        </div>

        {/* Active toggle */}
        <button
          onClick={onToggleActive}
          className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
          title={provider.isActive ? 'Deactivate' : 'Activate'}
        >
          {provider.isActive ? (
            <ToggleRight size={22} className="text-[#22c55e]" />
          ) : (
            <ToggleLeft size={22} />
          )}
        </button>
      </div>

      {/* API Key */}
      {provider.apiKey && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-[#525252] font-mono flex-1 truncate">
            {showKey ? provider.apiKey : provider.apiKey}
          </span>
          <button
            onClick={() => setShowKey((v) => !v)}
            className="text-[#525252] hover:text-[#a3a3a3] transition-colors shrink-0"
            title={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      )}

      {/* Base URL */}
      {provider.baseUrl && (
        <p className="text-[11px] text-[#525252] mb-3 truncate">{provider.baseUrl}</p>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-3 border-t border-[#1f1f1f]">
        <TestIndicator state={testState} message={testMessage} />

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={onTest}
            disabled={testState === 'testing'}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#a3a3a3] hover:text-[#fafafa] hover:bg-[#1f1f1f] transition-colors disabled:opacity-50"
            title="Test connection"
          >
            <Zap size={11} />
            Test
          </button>

          {!provider.isDefault && (
            <button
              onClick={onSetDefault}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#a3a3a3] hover:text-[#22c55e] hover:bg-[#1f1f1f] transition-colors"
              title="Set as default"
            >
              <Star size={11} />
              Default
            </button>
          )}

          <button
            onClick={onEdit}
            className="p-1.5 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
            title="Edit"
          >
            <Edit2 size={13} />
          </button>

          <button
            onClick={onDelete}
            disabled={provider.isDefault}
            className="p-1.5 rounded text-[#525252] hover:text-[#ef4444] hover:bg-[#1f1f1f] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={provider.isDefault ? 'Cannot delete the default provider' : 'Delete'}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit modal
// ---------------------------------------------------------------------------

interface FormState {
  name: string;
  type: AIProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o-mini',
  isActive: true,
};

function ProviderModal({
  provider,
  onClose,
  onSaved,
}: {
  provider?: AIProvider;
  onClose: () => void;
  onSaved: (p: AIProvider) => void;
}) {
  const isEdit = !!provider;

  const [form, setForm] = useState<FormState>(() => {
    if (provider) {
      return {
        name: provider.name,
        type: provider.type,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: provider.model,
        isActive: provider.isActive,
      };
    }
    return { ...EMPTY_FORM };
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // When type changes, fill in defaults for baseUrl and model
  const handleTypeChange = (type: AIProviderType) => {
    const meta = PROVIDER_META[type];
    setForm((prev) => ({
      ...prev,
      type,
      baseUrl: meta.defaultBaseUrl,
      model: meta.defaultModel,
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    setLoading(true);

    try {
      let saved: AIProvider;
      if (isEdit && provider) {
        saved = await updateProvider(provider.id, {
          name: form.name.trim(),
          type: form.type,
          // Only send apiKey if user changed it (non-masked)
          ...(form.apiKey !== provider.apiKey ? { apiKey: form.apiKey } : {}),
          baseUrl: form.baseUrl,
          model: form.model,
          isActive: form.isActive,
        });
      } else {
        saved = await createProvider({
          name: form.name.trim(),
          type: form.type,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl,
          model: form.model,
          isActive: form.isActive,
        });
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider');
    } finally {
      setLoading(false);
    }
  };

  const requiresBaseUrl = form.type === 'ollama' || form.type === 'custom';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-semibold text-[#fafafa]">
            {isEdit ? 'Edit Provider' : 'Add Provider'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">
              Name <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My OpenAI Provider"
              autoFocus
              className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">
              Provider Type
            </label>
            <select
              value={form.type}
              onChange={(e) => handleTypeChange(e.target.value as AIProviderType)}
              className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none appearance-none"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="ollama">Ollama (local)</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">
              API Key
              {form.type === 'ollama' && (
                <span className="ml-1 text-[#525252]">(not required for Ollama)</span>
              )}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) => set('apiKey', e.target.value)}
                placeholder={isEdit ? 'Leave blank to keep existing key' : 'sk-...'}
                className="w-full px-3 py-2 pr-10 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#525252] hover:text-[#a3a3a3] transition-colors"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">
              Base URL
              {requiresBaseUrl && <span className="ml-1 text-[#ef4444]">*</span>}
              {!requiresBaseUrl && <span className="ml-1 text-[#525252]">(optional)</span>}
            </label>
            <input
              type="text"
              value={form.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              placeholder={
                form.type === 'ollama'
                  ? 'http://localhost:11434'
                  : 'https://api.openai.com/v1'
              }
              className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
            />
          </div>

          {/* Model */}
          <div>
            <label className="text-[12px] text-[#737373] font-medium block mb-1.5">
              Model
            </label>
            {PROVIDER_META[form.type].models.length > 0 ? (
              <select
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none appearance-none"
              >
                {PROVIDER_META[form.type].models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="model-name"
                className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
              />
            )}
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[#737373] font-medium">Active</span>
            <button
              type="button"
              onClick={() => set('isActive', !form.isActive)}
              className="transition-colors"
            >
              {form.isActive ? (
                <ToggleRight size={24} className="text-[#22c55e]" />
              ) : (
                <ToggleLeft size={24} className="text-[#525252]" />
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="mt-3 text-[12px] text-[#ef4444]">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name.trim() || loading}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Provider'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fallback Order panel — sürükle bırak yerine basit up/down butonları
// ---------------------------------------------------------------------------

function FallbackOrderPanel({
  chain,
  onMoveUp,
  onMoveDown,
  saving,
}: {
  chain: AIProvider[];
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  saving: boolean;
}) {
  if (chain.length === 0) {
    return (
      <div className="text-[12px] text-[#525252] py-4 text-center">
        Henüz aktif provider yok
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {chain.map((provider, index) => {
        const meta = PROVIDER_META[provider.type];
        return (
          <div
            key={provider.id}
            className="flex items-center gap-3 bg-[#111111] border border-[#262626] rounded-lg px-3 py-2.5"
          >
            {/* Sıra numarası */}
            <span className="text-[11px] font-mono text-[#525252] w-5 shrink-0 text-center">
              {index + 1}
            </span>

            {/* Provider bilgisi */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className={`text-[10px] font-semibold ${meta.color}`}>
                {meta.label}
              </span>
              <span className="text-[12px] text-[#fafafa] truncate">{provider.name}</span>
              {provider.model && (
                <span className="text-[10px] text-[#525252] truncate">{provider.model}</span>
              )}
              {provider.isDefault && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30 shrink-0">
                  <Star size={7} />
                  PRIMARY
                </span>
              )}
            </div>

            {/* Taşıma butonları */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => onMoveUp(index)}
                disabled={index === 0 || saving}
                className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Yukarı taşı"
              >
                <ChevronUp size={14} />
              </button>
              <button
                onClick={() => onMoveDown(index)}
                disabled={index === chain.length - 1 || saving}
                className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Aşağı taşı"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProvidersPage() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | undefined>();
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});

  // Fallback zinciri state'leri
  const [fallbackChain, setFallbackChain] = useState<AIProvider[]>([]);
  const [fallbackSaving, setFallbackSaving] = useState(false);

  const load = async () => {
    try {
      const [data, chain] = await Promise.all([fetchProviders(), fetchFallbackChain()]);
      setProviders(data);
      setFallbackChain(chain);
    } catch {
      // API not ready yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaved = (saved: AIProvider) => {
    setProviders((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setShowModal(false);
    setEditingProvider(undefined);
    // Reload to get updated isDefault flags
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this provider?')) return;
    try {
      await deleteProvider(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete provider');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultProvider(id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to set default provider');
    }
  };

  const handleToggleActive = async (provider: AIProvider) => {
    try {
      const updated = await updateProvider(provider.id, { isActive: !provider.isActive });
      setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update provider');
    }
  };

  const handleTest = async (id: string) => {
    setTestStates((prev) => ({ ...prev, [id]: 'testing' }));
    setTestMessages((prev) => ({ ...prev, [id]: '' }));
    try {
      const result = await testProvider(id);
      setTestStates((prev) => ({ ...prev, [id]: result.valid ? 'success' : 'failure' }));
      setTestMessages((prev) => ({ ...prev, [id]: result.message }));
    } catch (err) {
      setTestStates((prev) => ({ ...prev, [id]: 'failure' }));
      setTestMessages((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Test failed',
      }));
    }
  };

  // Fallback sıralamasında bir provider'ı yukarı taşı
  const handleFallbackMoveUp = async (index: number) => {
    if (index === 0 || fallbackSaving) return;
    const newChain = [...fallbackChain];
    // Elemanları yer değiştir
    [newChain[index - 1], newChain[index]] = [newChain[index], newChain[index - 1]];
    setFallbackChain(newChain);
    setFallbackSaving(true);
    try {
      const updated = await updateFallbackOrder(newChain.map((p) => p.id));
      setFallbackChain(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sıralama güncellenemedi');
      // Hata durumunda eski sırayı geri yükle
      load();
    } finally {
      setFallbackSaving(false);
    }
  };

  // Fallback sıralamasında bir provider'ı aşağı taşı
  const handleFallbackMoveDown = async (index: number) => {
    if (index === fallbackChain.length - 1 || fallbackSaving) return;
    const newChain = [...fallbackChain];
    // Elemanları yer değiştir
    [newChain[index], newChain[index + 1]] = [newChain[index + 1], newChain[index]];
    setFallbackChain(newChain);
    setFallbackSaving(true);
    try {
      const updated = await updateFallbackOrder(newChain.map((p) => p.id));
      setFallbackChain(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sıralama güncellenemedi');
      // Hata durumunda eski sırayı geri yükle
      load();
    } finally {
      setFallbackSaving(false);
    }
  };

  const openAdd = () => {
    setEditingProvider(undefined);
    setShowModal(true);
  };

  const openEdit = (provider: AIProvider) => {
    setEditingProvider(provider);
    setShowModal(true);
  };

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#fafafa]">AI Providers</h1>
          <p className="text-sm text-[#737373] mt-1">
            Manage API keys and model settings for AI providers
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
        >
          <Plus size={16} />
          Add Provider
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-[#525252] animate-spin" />
        </div>
      ) : providers.length === 0 ? (
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-16 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#1f1f1f] flex items-center justify-center mb-4">
            <Settings size={28} className="text-[#333]" />
          </div>
          <h3 className="text-[15px] font-medium text-[#a3a3a3] mb-1">No providers yet</h3>
          <p className="text-[13px] text-[#525252] max-w-sm mb-4">
            Add an AI provider to connect your OpenAI, Anthropic, Google, or Ollama account.
          </p>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
          >
            <Plus size={14} />
            Add Provider
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Provider kartları grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onEdit={() => openEdit(provider)}
                onDelete={() => handleDelete(provider.id)}
                onSetDefault={() => handleSetDefault(provider.id)}
                onToggleActive={() => handleToggleActive(provider)}
                onTest={() => handleTest(provider.id)}
                testState={testStates[provider.id] ?? 'idle'}
                testMessage={testMessages[provider.id]}
              />
            ))}
          </div>

          {/* Fallback Order paneli — sadece en az 2 aktif provider varsa göster */}
          {fallbackChain.length >= 2 && (
            <div className="bg-[#0a0a0a] border border-[#262626] rounded-xl p-5">
              {/* Panel başlığı */}
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0">
                  <ListOrdered size={15} className="text-[#22c55e]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[14px] font-semibold text-[#fafafa]">Fallback Order</h2>
                  <p className="text-[11px] text-[#525252]">
                    Birincil model hata verirse sıradaki provider'a geçilir. Sıralamayı up/down butonları ile değiştirin.
                  </p>
                </div>
                {fallbackSaving && (
                  <Loader2 size={14} className="text-[#525252] animate-spin shrink-0" />
                )}
              </div>

              <FallbackOrderPanel
                chain={fallbackChain}
                onMoveUp={handleFallbackMoveUp}
                onMoveDown={handleFallbackMoveDown}
                saving={fallbackSaving}
              />
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <ProviderModal
          provider={editingProvider}
          onClose={() => {
            setShowModal(false);
            setEditingProvider(undefined);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
