import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ScrollText,
  FileCode,
  Copy,
  Plus,
  Trash2,
  Edit3,
  History,
  Tag,
  Search,
  ChevronDown,
  Check,
  X,
  BarChart2,
  Clock,
  Layers,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category = 'system' | 'user' | 'agent' | 'tool' | 'general';
type SortOrder = 'recent' | 'most_used' | 'alpha';

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: Category;
  content: string;
  variables: string[];
  tags: string[];
  version: number;
  parent_id: string | null;
  is_active: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

interface TemplateDetail {
  template: PromptTemplate;
  history: PromptTemplate[];
}

interface PromptStats {
  totalTemplates: number;
  byCategory: Record<string, number>;
  totalVersions: number;
  mostUsed: Array<{ id: string; name: string; usage_count: number }>;
  recentlyUpdated: Array<{ id: string; name: string; updated_at: string }>;
}

interface TemplateListResponse {
  templates: PromptTemplate[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3141/api/observability/prompts';

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' },
  { value: 'agent', label: 'Agent' },
  { value: 'tool', label: 'Tool' },
  { value: 'general', label: 'General' },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  system:  { bg: 'bg-[#3b82f6]/10', text: 'text-[#3b82f6]', border: 'border-[#3b82f6]/30' },
  user:    { bg: 'bg-[#22c55e]/10', text: 'text-[#22c55e]', border: 'border-[#22c55e]/30' },
  agent:   { bg: 'bg-[#a855f7]/10', text: 'text-[#a855f7]', border: 'border-[#a855f7]/30' },
  tool:    { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]', border: 'border-[#f59e0b]/30' },
  general: { bg: 'bg-[#525252]/10', text: 'text-[#a3a3a3]', border: 'border-[#525252]/30' },
};

function categoryClass(cat: string): string {
  const c = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general;
  return `${c.bg} ${c.text} ${c.border}`;
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

function extractVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g);
  const vars = new Set<string>();
  for (const match of matches) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}

function previewLines(content: string, maxLines = 3): string {
  const lines = content.split('\n').slice(0, maxLines);
  const joined = lines.join('\n');
  const full = content.split('\n').length;
  return full > maxLines ? joined + '\n...' : joined;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string;
}

function StatCard({ label, value, icon, sub }: StatCardProps) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-[#525252] font-medium">{label}</div>
        <div className="text-lg font-bold text-[#fafafa] leading-tight truncate">{value}</div>
        {sub && <div className="text-[10px] text-[#525252] truncate mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category badge
// ---------------------------------------------------------------------------

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${categoryClass(category)}`}>
      {category}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tag pill
// ---------------------------------------------------------------------------

function TagPill({
  tag,
  onRemove,
}: {
  tag: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1f1f1f] border border-[#333] text-[10px] text-[#a3a3a3]">
      <Tag size={8} className="shrink-0" />
      {tag}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 hover:text-[#ef4444] transition-colors"
        >
          <X size={8} />
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// VariablePill
// ---------------------------------------------------------------------------

function VariablePill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#22c55e]/10 border border-[#22c55e]/20 text-[10px] text-[#22c55e] font-mono">
      {`{{${name}}}`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

interface TemplateCardProps {
  template: PromptTemplate;
  onEdit: (t: PromptTemplate) => void;
  onDuplicate: (t: PromptTemplate) => void;
  onDelete: (t: PromptTemplate) => void;
  onCopy: (t: PromptTemplate) => void;
  onViewHistory: (t: PromptTemplate) => void;
}

function TemplateCard({
  template,
  onEdit,
  onDuplicate,
  onDelete,
  onCopy,
  onViewHistory,
}: TemplateCardProps) {
  const [copied, setCopied] = useState(false);
  const preview = previewLines(template.content, 3);

  const handleCopy = () => {
    navigator.clipboard.writeText(template.content).then(() => {
      setCopied(true);
      onCopy(template);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden hover:border-[#333] transition-colors group flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#fafafa] truncate">{template.name}</h3>
            <CategoryBadge category={template.category} />
          </div>
          {template.description && (
            <p className="text-[12px] text-[#737373] line-clamp-2 leading-relaxed">
              {template.description}
            </p>
          )}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            title="Copy content"
            className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors"
          >
            {copied ? (
              <Check size={13} className="text-[#22c55e]" />
            ) : (
              <Copy size={13} className="text-[#525252] hover:text-[#a3a3a3]" />
            )}
          </button>
          <button
            onClick={() => onViewHistory(template)}
            title="Version history"
            className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors"
          >
            <History size={13} className="text-[#525252] hover:text-[#a3a3a3]" />
          </button>
          <button
            onClick={() => onEdit(template)}
            title="Edit"
            className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors"
          >
            <Edit3 size={13} className="text-[#525252] hover:text-[#a3a3a3]" />
          </button>
          <button
            onClick={() => onDuplicate(template)}
            title="Duplicate"
            className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors"
          >
            <FileCode size={13} className="text-[#525252] hover:text-[#a3a3a3]" />
          </button>
          <button
            onClick={() => onDelete(template)}
            title="Delete"
            className="p-1.5 rounded-lg hover:bg-[#ef4444]/10 transition-colors"
          >
            <Trash2 size={13} className="text-[#525252] hover:text-[#ef4444]" />
          </button>
        </div>
      </div>

      {/* Content preview */}
      <div className="mx-4 mb-3 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg p-3 flex-1">
        <pre className="text-[11px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-words leading-relaxed line-clamp-3">
          {preview}
        </pre>
      </div>

      {/* Variables */}
      {template.variables.length > 0 && (
        <div className="px-4 mb-3 flex flex-wrap gap-1.5">
          {template.variables.map((v) => (
            <VariablePill key={v} name={v} />
          ))}
        </div>
      )}

      {/* Tags */}
      {template.tags.length > 0 && (
        <div className="px-4 mb-3 flex flex-wrap gap-1.5">
          {template.tags.map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 pb-3 flex items-center gap-3 text-[10px] text-[#525252] border-t border-[#1a1a1a] pt-2 mt-auto">
        <span className="flex items-center gap-1">
          <Layers size={9} />
          v{template.version}
        </span>
        <span className="flex items-center gap-1">
          <BarChart2 size={9} />
          {template.usage_count} uses
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <Clock size={9} />
          {relativeTime(template.updated_at)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TagInput component
// ---------------------------------------------------------------------------

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim().toLowerCase().replace(/\s+/g, '-');
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="min-h-[38px] bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 flex flex-wrap gap-1.5 focus-within:border-[#333]">
      {tags.map((t) => (
        <TagPill key={t} tag={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={tags.length === 0 ? 'Add tags...' : ''}
        className="flex-1 min-w-[80px] bg-transparent text-[12px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TemplateEditor modal
// ---------------------------------------------------------------------------

interface EditorFormState {
  name: string;
  description: string;
  category: Category;
  content: string;
  variables: string[];
  tags: string[];
}

interface TemplateEditorProps {
  initial?: PromptTemplate | null;
  onClose: () => void;
  onSave: (data: EditorFormState) => Promise<void>;
}

function TemplateEditor({ initial, onClose, onSave }: TemplateEditorProps) {
  const [form, setForm] = useState<EditorFormState>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    category: (initial?.category as Category) ?? 'general',
    content: initial?.content ?? '',
    variables: initial?.variables ?? [],
    tags: initial?.tags ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-detect variables from content
  const detectedVars = extractVariables(form.content);

  const handleContentChange = (content: string) => {
    const vars = extractVariables(content);
    setForm((f) => ({ ...f, content, variables: vars }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.content.trim()) {
      setError('Name and content are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...form, variables: detectedVars });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f1f1f] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#22c55e]/10 flex items-center justify-center">
              <ScrollText size={15} className="text-[#22c55e]" />
            </div>
            <h2 className="text-[15px] font-semibold text-[#fafafa]">
              {initial ? 'Edit Template' : 'Create Template'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors"
          >
            <X size={16} className="text-[#525252]" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 flex-1">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-medium text-[#737373] mb-1.5">
              Name <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. System Prompt - Helpful Assistant"
              className="w-full bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 text-[13px] text-[#fafafa] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333]"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-medium text-[#737373] mb-1.5">
              Category
            </label>
            <div className="relative">
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
                className="w-full appearance-none bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 text-[13px] text-[#a3a3a3] focus:outline-none focus:border-[#333] pr-8"
              >
                {CATEGORIES.filter((c) => c.value !== 'all').map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-medium text-[#737373] mb-1.5">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of what this prompt does..."
              rows={2}
              className="w-full bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 text-[13px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333] resize-none leading-relaxed"
            />
          </div>

          {/* Content */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-[#737373]">
                Content <span className="text-[#ef4444]">*</span>
              </label>
              {detectedVars.length > 0 && (
                <span className="text-[10px] text-[#525252]">
                  {detectedVars.length} variable{detectedVars.length !== 1 ? 's' : ''} detected
                </span>
              )}
            </div>
            <textarea
              value={form.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={"You are a helpful assistant.\n\nUser context: {{context}}\nTask: {{task}}"}
              rows={10}
              className="w-full bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2.5 text-[12px] text-[#d4d4d4] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333] resize-none font-mono leading-relaxed"
            />
            {/* Detected variables preview */}
            {detectedVars.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detectedVars.map((v) => (
                  <VariablePill key={v} name={v} />
                ))}
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[11px] font-medium text-[#737373] mb-1.5">
              Tags
            </label>
            <TagInput
              tags={form.tags}
              onChange={(tags) => setForm((f) => ({ ...f, tags }))}
            />
            <p className="text-[10px] text-[#525252] mt-1">
              Press Enter or comma to add a tag
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg">
              <AlertCircle size={13} className="text-[#ef4444] shrink-0" />
              <p className="text-[12px] text-[#ef4444]">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-[#262626] text-[13px] text-[#a3a3a3] hover:border-[#333] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[13px] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving ? (
                <div className="w-4 h-4 rounded-full border-2 border-[#22c55e]/30 border-t-[#22c55e] animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {initial ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VersionHistoryPanel
// ---------------------------------------------------------------------------

interface VersionHistoryPanelProps {
  templateId: string;
  onClose: () => void;
}

function diffText(a: string, b: string): Array<{ type: 'same' | 'add' | 'remove'; line: string }> {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const result: Array<{ type: 'same' | 'add' | 'remove'; line: string }> = [];

  const aSet = new Set(aLines);
  const bSet = new Set(bLines);

  // Simple line-level diff: removed from a, added in b
  for (const line of aLines) {
    if (!bSet.has(line)) {
      result.push({ type: 'remove', line });
    } else {
      result.push({ type: 'same', line });
    }
  }
  for (const line of bLines) {
    if (!aSet.has(line)) {
      result.push({ type: 'add', line });
    }
  }

  return result;
}

function VersionHistoryPanel({ templateId, onClose }: VersionHistoryPanelProps) {
  const [data, setData] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPair, setSelectedPair] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<TemplateDetail>(`/${templateId}`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [templateId]);

  const versions = data
    ? [data.template, ...data.history].sort((a, b) => b.version - a.version)
    : [];

  const diffPair = selectedPair !== null && versions.length > selectedPair + 1
    ? diffText(versions[selectedPair + 1].content, versions[selectedPair].content)
    : null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f1f1f] shrink-0">
          <div className="flex items-center gap-2">
            <History size={16} className="text-[#a3a3a3]" />
            <h2 className="text-[15px] font-semibold text-[#fafafa]">Version History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors"
          >
            <X size={16} className="text-[#525252]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-[#ef4444] text-[13px]">
              <AlertCircle size={14} />
              {error}
            </div>
          ) : versions.length === 0 ? (
            <p className="text-[13px] text-[#525252] text-center py-8">No version history.</p>
          ) : (
            <div className="space-y-3">
              {versions.map((v, idx) => (
                <div key={v.id} className="border border-[#1f1f1f] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-[#0d0d0d]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[#fafafa] bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] px-2 py-0.5 rounded">
                        v{v.version}
                      </span>
                      {idx === 0 && (
                        <span className="text-[10px] text-[#525252] font-medium bg-[#1f1f1f] border border-[#333] px-2 py-0.5 rounded">
                          current
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-[#525252] flex items-center gap-1">
                        <Clock size={10} />
                        {relativeTime(v.updated_at)}
                      </span>
                      {idx < versions.length - 1 && (
                        <button
                          onClick={() => setSelectedPair(selectedPair === idx ? null : idx)}
                          className="text-[10px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors flex items-center gap-1"
                        >
                          <RotateCcw size={10} />
                          {selectedPair === idx ? 'Hide diff' : 'Diff'}
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedPair === idx && diffPair && (
                    <div className="border-t border-[#1f1f1f] bg-[#080808] p-4 max-h-64 overflow-y-auto">
                      <pre className="text-[11px] font-mono leading-relaxed">
                        {diffPair.map((d, i) => (
                          <div
                            key={i}
                            className={
                              d.type === 'add'
                                ? 'text-[#22c55e] bg-[#22c55e]/5'
                                : d.type === 'remove'
                                ? 'text-[#ef4444] bg-[#ef4444]/5'
                                : 'text-[#525252]'
                            }
                          >
                            {d.type === 'add' ? '+ ' : d.type === 'remove' ? '- ' : '  '}
                            {d.line}
                          </div>
                        ))}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteConfirmModal
// ---------------------------------------------------------------------------

function DeleteConfirmModal({
  template,
  onConfirm,
  onCancel,
  deleting,
}: {
  template: PromptTemplate;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
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
            <h3 className="text-[14px] font-semibold text-[#fafafa]">Delete template</h3>
            <p className="text-[11px] text-[#525252]">This cannot be undone</p>
          </div>
        </div>
        <p className="text-[12px] text-[#a3a3a3] mb-5 leading-relaxed">
          Delete <span className="text-[#fafafa] font-medium">{template.name}</span>? The template will be soft-deleted and no longer visible.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg border border-[#262626] text-[12px] text-[#a3a3a3] hover:border-[#333] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 px-3 py-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30 text-[12px] text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {deleting ? (
              <div className="w-3 h-3 rounded-full border border-[#ef4444]/30 border-t-[#ef4444] animate-spin" />
            ) : null}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PromptsPage
// ---------------------------------------------------------------------------

export default function PromptsPage() {
  const [stats, setStats] = useState<PromptStats | null>(null);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  // Filters
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('recent');
  const [tagFilter, setTagFilter] = useState('');
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // Modals
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [historyTemplateId, setHistoryTemplateId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  // All tags from loaded templates
  const allTags = Array.from(new Set(templates.flatMap((t) => t.tags))).sort();

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    apiFetch<PromptStats>('/stats')
      .then(setStats)
      .catch(console.error)
      .finally(() => setStatsLoading(false));
  }, []);

  const loadTemplates = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('sort', sort);
    if (category !== 'all') params.set('category', category);
    if (search) params.set('search', search);
    if (tagFilter) params.set('tag', tagFilter);

    apiFetch<TemplateListResponse>(`?${params.toString()}`)
      .then((data) => {
        setTemplates(data.templates);
        setTotal(data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [category, search, sort, tagFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Close tag dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCreate = async (data: EditorFormState) => {
    await apiFetch<{ template: PromptTemplate }>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setEditorOpen(false);
    loadTemplates();
    loadStats();
  };

  const handleEdit = async (data: EditorFormState) => {
    if (!editingTemplate) return;
    await apiFetch<{ template: PromptTemplate }>(`/${editingTemplate.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setEditingTemplate(null);
    loadTemplates();
    loadStats();
  };

  const handleDuplicate = async (t: PromptTemplate) => {
    await apiFetch<{ template: PromptTemplate }>(`/${t.id}/duplicate`, { method: 'POST' });
    loadTemplates();
    loadStats();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch<{ success: boolean }>(`/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      loadTemplates();
      loadStats();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyUsage = async (t: PromptTemplate) => {
    try {
      await apiFetch(`/${t.id}/use`, { method: 'POST' });
      // Silently update usage count in local state
      setTemplates((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, usage_count: x.usage_count + 1 } : x)),
      );
    } catch {
      // ignore
    }
  };

  const mostUsedName = stats?.mostUsed?.[0]?.name ?? '—';
  const categoriesCount = stats
    ? Object.values(stats.byCategory).filter((v) => v > 0).length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#fafafa]">Prompts</h1>
            <p className="text-sm text-[#737373] mt-0.5">
              Manage and version prompt templates for your agents
            </p>
          </div>
          <button
            onClick={() => { setEditingTemplate(null); setEditorOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[13px] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
          >
            <Plus size={14} />
            Create Template
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-6 py-4 border-b border-[#1a1a1a] shrink-0">
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Total Templates"
            value={statsLoading ? '...' : (stats?.totalTemplates ?? 0)}
            icon={<ScrollText size={16} className="text-[#22c55e]" />}
          />
          <StatCard
            label="Categories"
            value={statsLoading ? '...' : categoriesCount}
            icon={<Tag size={16} className="text-[#3b82f6]" />}
            sub={statsLoading ? undefined : Object.entries(stats?.byCategory ?? {})
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')}
          />
          <StatCard
            label="Most Used"
            value={statsLoading ? '...' : mostUsedName}
            icon={<BarChart2 size={16} className="text-[#a855f7]" />}
            sub={statsLoading ? undefined : stats?.mostUsed?.[0] ? `${stats.mostUsed[0].usage_count} uses` : undefined}
          />
          <StatCard
            label="Total Versions"
            value={statsLoading ? '...' : (stats?.totalVersions ?? 0)}
            icon={<Layers size={16} className="text-[#f59e0b]" />}
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-[#1a1a1a] flex items-center gap-3 flex-wrap shrink-0">
        {/* Category pills */}
        <div className="flex items-center gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`px-3 py-1 rounded-lg text-[12px] font-medium transition-colors ${
                category === c.value
                  ? 'bg-[#1f1f1f] text-[#fafafa] border border-[#333]'
                  : 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#141414]'
              }`}
            >
              {c.label}
              {c.value !== 'all' && stats?.byCategory?.[c.value] !== undefined && (
                <span className="ml-1 text-[10px] text-[#525252]">
                  {stats.byCategory[c.value]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]" />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-[#111111] border border-[#262626] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none focus:border-[#333] w-52"
          />
        </div>

        {/* Tag filter */}
        <div className="relative" ref={tagDropdownRef}>
          <button
            onClick={() => setTagDropdownOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${
              tagFilter
                ? 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]'
                : 'bg-[#111111] border-[#262626] text-[#a3a3a3] hover:border-[#333]'
            }`}
          >
            <Tag size={11} />
            {tagFilter || 'Tag'}
            <ChevronDown size={11} />
          </button>
          {tagDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-[#111111] border border-[#262626] rounded-xl shadow-2xl z-20 overflow-hidden">
              <div className="py-1">
                <button
                  onClick={() => { setTagFilter(''); setTagDropdownOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2 ${
                    !tagFilter ? 'text-[#fafafa] bg-[#1f1f1f]' : 'text-[#a3a3a3] hover:bg-[#141414]'
                  }`}
                >
                  {!tagFilter && <Check size={11} className="text-[#22c55e]" />}
                  <span className={!tagFilter ? 'ml-0' : 'ml-[19px]'}>All tags</span>
                </button>
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTagFilter(t); setTagDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2 ${
                      tagFilter === t ? 'text-[#fafafa] bg-[#1f1f1f]' : 'text-[#a3a3a3] hover:bg-[#141414]'
                    }`}
                  >
                    {tagFilter === t && <Check size={11} className="text-[#22c55e]" />}
                    <span className={tagFilter === t ? 'ml-0' : 'ml-[19px]'}>{t}</span>
                  </button>
                ))}
                {allTags.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-[#525252]">No tags yet</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
            className="appearance-none bg-[#111111] border border-[#262626] rounded-lg pl-3 pr-7 py-1.5 text-[12px] text-[#a3a3a3] focus:outline-none focus:border-[#333]"
          >
            <option value="recent">Recent</option>
            <option value="most_used">Most Used</option>
            <option value="alpha">Alphabetical</option>
          </select>
          <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
        </div>
      </div>

      {/* Template grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-7 h-7 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-2xl bg-[#111111] border border-[#262626] flex items-center justify-center mb-5">
              <ScrollText size={36} className="text-[#333]" />
            </div>
            <h2 className="text-[16px] font-semibold text-[#a3a3a3] mb-2">No templates found</h2>
            <p className="text-[13px] text-[#525252] max-w-sm leading-relaxed mb-5">
              {search || tagFilter || category !== 'all'
                ? 'Try adjusting your filters or search query.'
                : 'Create your first prompt template to get started.'}
            </p>
            {!search && !tagFilter && category === 'all' && (
              <button
                onClick={() => { setEditingTemplate(null); setEditorOpen(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[13px] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
              >
                <Plus size={14} />
                Create Template
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[12px] text-[#525252]">
                {total} template{total !== 1 ? 's' : ''}
                {tagFilter && (
                  <span className="ml-1">
                    tagged <span className="text-[#a3a3a3]">{tagFilter}</span>
                  </span>
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onEdit={(tmpl) => { setEditingTemplate(tmpl); setEditorOpen(true); }}
                  onDuplicate={handleDuplicate}
                  onDelete={setDeleteTarget}
                  onCopy={handleCopyUsage}
                  onViewHistory={(tmpl) => setHistoryTemplateId(tmpl.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Template editor modal */}
      {editorOpen && (
        <TemplateEditor
          initial={editingTemplate}
          onClose={() => { setEditorOpen(false); setEditingTemplate(null); }}
          onSave={editingTemplate ? handleEdit : handleCreate}
        />
      )}

      {/* Version history panel */}
      {historyTemplateId && (
        <VersionHistoryPanel
          templateId={historyTemplateId}
          onClose={() => setHistoryTemplateId(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteConfirmModal
          template={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
