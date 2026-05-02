import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  FileText,
  Globe,
  Code2,
  Table2,
  Search,
  Plus,
  Trash2,
  Edit3,
  Layers,
  Zap,
  Clock,
  ChevronDown,
  X,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useModalState } from '../hooks/useModalState.js';
import { StatsCards, type StatCardDef } from '../components/StatsCards.js';
import {
  type KnowledgeBase,
  type RagDocument,
  type RagQuery,
  type Stats,
} from './studio/settings/rag-types.js';
import { observabilityDelete, observabilityGet, observabilityPost, observabilityPut } from '../lib/observability-api.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  text: { label: 'Text', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', Icon: FileText },
  pdf: { label: 'PDF', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', Icon: FileText },
  web: { label: 'Web', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', Icon: Globe },
  code: { label: 'Code', color: '#22c55e', bg: 'rgba(34,197,94,0.15)', Icon: Code2 },
  csv: { label: 'CSV', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', Icon: Table2 },
};

const EMBEDDING_MODELS = [
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-embedding-ada-002',
];

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  indexing: '#f59e0b',
  error: '#ef4444',
  pending: '#525252',
  indexed: '#22c55e',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n) + '...' : str;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.text;
  const { Icon, label, color, bg } = cfg;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ color, backgroundColor: bg }}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#525252';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
      <span
        className="w-2 h-2 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: status === 'indexing' ? `0 0 0 2px ${color}40` : undefined,
          animation: status === 'indexing' ? 'pulse 1.5s infinite' : undefined,
        }}
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#525252';
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ color, backgroundColor: `${color}20` }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KB Form Modal
// ---------------------------------------------------------------------------

interface KBFormData {
  name: string;
  description: string;
  type: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
}

function KBFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: KnowledgeBase | null;
  onClose: () => void;
  onSave: (data: KBFormData) => Promise<void>;
}) {
  const [form, setForm] = useState<KBFormData>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    type: initial?.type ?? 'text',
    embedding_model: initial?.embedding_model ?? 'text-embedding-3-small',
    chunk_size: initial?.chunk_size ?? 512,
    chunk_overlap: initial?.chunk_overlap ?? 50,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#262626]">
          <h2 className="text-[#fafafa] font-semibold text-base">
            {initial ? 'Edit Knowledge Base' : 'Create Knowledge Base'}
          </h2>
          <button onClick={onClose} className="text-[#525252] hover:text-[#fafafa] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="My Knowledge Base"
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe this knowledge base..."
              rows={2}
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Type</label>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                const { Icon, label, color } = cfg;
                const active = form.type === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: key }))}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all text-xs font-medium"
                    style={{
                      borderColor: active ? color : '#262626',
                      backgroundColor: active ? `${color}15` : '#1a1a1a',
                      color: active ? color : '#525252',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Embedding Model</label>
            <div className="relative">
              <select
                value={form.embedding_model}
                onChange={e => setForm(f => ({ ...f, embedding_model: e.target.value }))}
                className="w-full appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
              >
                {EMBEDDING_MODELS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">
                Chunk Size <span className="text-[#525252]">({form.chunk_size})</span>
              </label>
              <input
                type="range"
                min={128}
                max={2048}
                step={64}
                value={form.chunk_size}
                onChange={e => setForm(f => ({ ...f, chunk_size: parseInt(e.target.value) }))}
                className="w-full accent-[#22c55e]"
              />
              <div className="flex justify-between text-xs text-[#525252] mt-0.5">
                <span>128</span><span>2048</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">
                Chunk Overlap <span className="text-[#525252]">({form.chunk_overlap})</span>
              </label>
              <input
                type="range"
                min={0}
                max={200}
                step={10}
                value={form.chunk_overlap}
                onChange={e => setForm(f => ({ ...f, chunk_overlap: parseInt(e.target.value) }))}
                className="w-full accent-[#22c55e]"
              />
              <div className="flex justify-between text-xs text-[#525252] mt-0.5">
                <span>0</span><span>200</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded-lg hover:text-[#fafafa] hover:border-[#404040] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : initial ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Document Modal
// ---------------------------------------------------------------------------

function AddDocumentModal({
  knowledgeBases,
  defaultKbId,
  onClose,
  onSave,
}: {
  knowledgeBases: KnowledgeBase[];
  defaultKbId?: string;
  onClose: () => void;
  onSave: (kbId: string, data: { name: string; source: string; content: string; chunk_count: number }) => Promise<void>;
}) {
  const [kbId, setKbId] = useState(defaultKbId ?? knowledgeBases[0]?.id ?? '');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [content, setContent] = useState('');
  const [chunkCount, setChunkCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kbId) { setError('Select a knowledge base'); return; }
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(kbId, { name: name.trim(), source: source.trim(), content, chunk_count: chunkCount });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#262626]">
          <h2 className="text-[#fafafa] font-semibold text-base">Add Document</h2>
          <button onClick={onClose} className="text-[#525252] hover:text-[#fafafa] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Knowledge Base</label>
            <div className="relative">
              <select
                value={kbId}
                onChange={e => setKbId(e.target.value)}
                className="w-full appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
              >
                {knowledgeBases.map(kb => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Document Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. company-policy.pdf"
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Source (URL or path)</label>
            <input
              type="text"
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder="https://example.com/doc or /path/to/file"
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste document content here..."
              rows={5}
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] font-mono placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a3a3a3] mb-1.5">Chunk Count</label>
            <input
              type="number"
              min={0}
              value={chunkCount}
              onChange={e => setChunkCount(parseInt(e.target.value) || 0)}
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded-lg hover:text-[#fafafa] hover:border-[#404040] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
            >
              {saving ? 'Adding...' : 'Add Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Knowledge Bases
// ---------------------------------------------------------------------------

function KBTab({
  kbs,
  onRefresh,
}: {
  kbs: KnowledgeBase[];
  onRefresh: () => void;
}) {
  const createModal = useModalState<KnowledgeBase>();
  const editModal = useModalState<KnowledgeBase>();
  const docsModal = useModalState<KnowledgeBase>();

  async function handleCreate(data: KBFormData) {
    await observabilityPost('/rag/knowledge-bases', data);
    onRefresh();
  }

  async function handleUpdate(data: KBFormData) {
    if (!editModal.selectedItem) return;
    await observabilityPut(`/rag/knowledge-bases/${editModal.selectedItem.id}`, data);
    onRefresh();
  }

  async function handleDelete(kb: KnowledgeBase) {
    if (!confirm(`Delete "${kb.name}"? This will also delete all documents.`)) return;
    await observabilityDelete(`/rag/knowledge-bases/${kb.id}`);
    onRefresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#525252]">{kbs.length} knowledge base{kbs.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => createModal.open()}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Knowledge Base
        </button>
      </div>

      {kbs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Database className="w-12 h-12 text-[#262626] mb-4" />
          <p className="text-[#525252] text-sm">No knowledge bases yet</p>
          <p className="text-[#404040] text-xs mt-1">Create one to start indexing documents</p>
          <button
            onClick={() => createModal.open()}
            className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Knowledge Base
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {kbs.map(kb => {
            return (
              <div key={kb.id} className="bg-[#111111] border border-[#262626] rounded-xl p-5 hover:border-[#404040] transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[#fafafa] font-semibold text-sm">{kb.name}</span>
                    <TypeBadge type={kb.type} />
                  </div>
                  <StatusDot status={kb.status} />
                </div>

                {kb.description && (
                  <p className="text-xs text-[#525252] mb-3 leading-relaxed">{truncate(kb.description, 120)}</p>
                )}

                <div className="flex items-center gap-4 text-xs text-[#a3a3a3] mb-3">
                  <span className="flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-[#525252]" />
                    {kb.document_count} docs
                  </span>
                  <span className="flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-[#525252]" />
                    {kb.total_chunks.toLocaleString()} chunks
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#525252]" />
                    {formatRelTime(kb.last_indexed_at)}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap mb-4">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626]">
                    <Zap className="w-3 h-3 text-[#525252]" />
                    {kb.embedding_model}
                  </span>
                  <span className="text-xs text-[#525252] bg-[#1a1a1a] border border-[#262626] rounded px-2 py-0.5">
                    size: {kb.chunk_size}
                  </span>
                  <span className="text-xs text-[#525252] bg-[#1a1a1a] border border-[#262626] rounded px-2 py-0.5">
                    overlap: {kb.chunk_overlap}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-[#1e1e1e]">
                  <button
                    onClick={() => docsModal.open(kb)}
                    className="flex-1 text-xs font-medium text-[#a3a3a3] hover:text-[#fafafa] bg-[#1a1a1a] hover:bg-[#222] border border-[#262626] rounded-lg py-1.5 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    View Documents
                  </button>
                  <button
                    onClick={() => editModal.open(kb)}
                    className="p-1.5 text-[#525252] hover:text-[#a3a3a3] bg-[#1a1a1a] hover:bg-[#222] border border-[#262626] rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(kb)}
                    className="p-1.5 text-[#525252] hover:text-red-400 bg-[#1a1a1a] hover:bg-red-400/10 border border-[#262626] hover:border-red-400/30 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createModal.isOpen && (
        <KBFormModal onClose={createModal.close} onSave={handleCreate} />
      )}
      {editModal.isOpen && editModal.selectedItem && (
        <KBFormModal initial={editModal.selectedItem} onClose={editModal.close} onSave={handleUpdate} />
      )}
      {docsModal.isOpen && docsModal.selectedItem && (
        <KBDocsModal kb={docsModal.selectedItem} onClose={() => { docsModal.close(); onRefresh(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KB Documents Mini Modal
// ---------------------------------------------------------------------------

function KBDocsModal({ kb, onClose }: { kb: KnowledgeBase; onClose: () => void }) {
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await observabilityGet<{ documents?: RagDocument[] }>(`/rag/knowledge-bases/${kb.id}`);
      setDocs(data.documents ?? []);
    } finally {
      setLoading(false);
    }
  }, [kb.id]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  async function handleDelete(docId: string) {
    if (!confirm('Delete this document?')) return;
    await observabilityDelete(`/rag/knowledge-bases/${kb.id}/documents/${docId}`);
    loadDocs();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#111111] border border-[#262626] rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#262626]">
          <div>
            <h2 className="text-[#fafafa] font-semibold text-base">{kb.name}</h2>
            <p className="text-xs text-[#525252] mt-0.5">Documents in this knowledge base</p>
          </div>
          <button onClick={onClose} className="text-[#525252] hover:text-[#fafafa] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading ? (
            <div className="text-center py-8 text-[#525252] text-sm">Loading...</div>
          ) : docs.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-10 h-10 text-[#262626] mx-auto mb-3" />
              <p className="text-[#525252] text-sm">No documents yet</p>
            </div>
          ) : (
            docs.map(doc => (
              <div key={doc.id} className="bg-[#161616] border border-[#262626] rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-[#fafafa]">{doc.name}</span>
                      <StatusBadge status={doc.status} />
                    </div>
                    {doc.source && (
                      <p className="text-xs text-[#525252] mb-1 truncate">{doc.source}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-[#525252] mb-2">
                      <span>{doc.chunk_count} chunks</span>
                      <span>{formatBytes(doc.size_bytes)}</span>
                      <span>{formatRelTime(doc.created_at)}</span>
                    </div>
                    {doc.content_preview && (
                      <pre className="text-xs text-[#a3a3a3] font-mono bg-[#0a0a0a] rounded p-2 overflow-hidden" style={{ maxHeight: '2.8em', lineHeight: '1.4' }}>
                        {doc.content_preview.split('\n').slice(0, 2).join('\n')}
                      </pre>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="p-1.5 text-[#525252] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Documents
// ---------------------------------------------------------------------------

function DocumentsTab({ knowledgeBases, onRefresh }: { knowledgeBases: KnowledgeBase[]; onRefresh: () => void }) {
  const [selectedKbId, setSelectedKbId] = useState<string>('all');
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [kbMap, setKbMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const m: Record<string, string> = {};
    for (const kb of knowledgeBases) m[kb.id] = kb.name;
    setKbMap(m);
  }, [knowledgeBases]);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedKbId === 'all') {
        const all: RagDocument[] = [];
        for (const kb of knowledgeBases) {
          const data = await observabilityGet<{ documents?: RagDocument[] }>(`/rag/knowledge-bases/${kb.id}`);
          if (data.documents) all.push(...data.documents);
        }
        setDocs(all.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      } else {
        const data = await observabilityGet<{ documents?: RagDocument[] }>(`/rag/knowledge-bases/${selectedKbId}`);
        setDocs(data.documents ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedKbId, knowledgeBases]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  async function handleDelete(doc: RagDocument) {
    if (!confirm('Delete this document?')) return;
    await observabilityDelete(`/rag/knowledge-bases/${doc.kb_id}/documents/${doc.id}`);
    loadDocs();
    onRefresh();
  }

  async function handleAddDoc(kbId: string, data: { name: string; source: string; content: string; chunk_count: number }) {
    await observabilityPost(`/rag/knowledge-bases/${kbId}/documents`, data);
    onRefresh();
    loadDocs();
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-shrink-0">
          <select
            value={selectedKbId}
            onChange={e => setSelectedKbId(e.target.value)}
            className="appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
          >
            <option value="all">All Knowledge Bases</option>
            {knowledgeBases.map(kb => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
        </div>
        <span className="text-xs text-[#525252]">{docs.length} document{docs.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => setShowAdd(true)}
          disabled={knowledgeBases.length === 0}
          className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-40 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Document
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#525252] text-sm">Loading documents...</div>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileText className="w-12 h-12 text-[#262626] mb-4" />
          <p className="text-[#525252] text-sm">No documents found</p>
          {knowledgeBases.length > 0 && (
            <button
              onClick={() => setShowAdd(true)}
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-black bg-[#22c55e] rounded-lg hover:bg-[#16a34a] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Document
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} className="bg-[#111111] border border-[#262626] rounded-xl p-4 hover:border-[#404040] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-[#fafafa]">{doc.name}</span>
                    <StatusBadge status={doc.status} />
                    {kbMap[doc.kb_id] && (
                      <span className="text-xs text-[#525252] bg-[#1a1a1a] border border-[#262626] rounded px-1.5 py-0.5">
                        {kbMap[doc.kb_id]}
                      </span>
                    )}
                  </div>
                  {doc.source && (
                    <p className="text-xs text-[#525252] mb-2 truncate">{doc.source}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-[#525252] mb-2">
                    <span className="flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      {doc.chunk_count} chunks
                    </span>
                    <span>{formatBytes(doc.size_bytes)}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelTime(doc.created_at)}
                    </span>
                  </div>
                  {doc.content_preview && (
                    <pre className="text-xs text-[#a3a3a3] font-mono bg-[#0a0a0a] border border-[#1e1e1e] rounded p-2 overflow-hidden" style={{ maxHeight: '2.8em', lineHeight: '1.4' }}>
                      {doc.content_preview.split('\n').slice(0, 2).join('\n')}
                    </pre>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(doc)}
                  className="p-2 text-[#525252] hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 rounded-lg transition-colors flex-shrink-0"
                  title="Delete document"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddDocumentModal
          knowledgeBases={knowledgeBases}
          defaultKbId={selectedKbId !== 'all' ? selectedKbId : undefined}
          onClose={() => setShowAdd(false)}
          onSave={handleAddDoc}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Query Log
// ---------------------------------------------------------------------------

function QueryLogTab({ knowledgeBases }: { knowledgeBases: KnowledgeBase[] }) {
  const [queries, setQueries] = useState<RagQuery[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterKb, setFilterKb] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (filterKb) params.set('kb_id', filterKb);
      const data = await observabilityGet<{ queries?: RagQuery[]; total?: number }>(`/rag/queries?${params}`);
      setQueries(data.queries ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [filterKb, page]);

  useEffect(() => { load(); }, [load]);

  const todayCutoff = new Date();
  todayCutoff.setHours(0, 0, 0, 0);
  const queriesToday = queries.filter(q => new Date(q.created_at) >= todayCutoff).length;
  const latencies = queries.filter(q => q.latency_ms != null).map(q => q.latency_ms!);
  const avgLat = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const kbCounts: Record<string, number> = {};
  for (const q of queries) if (q.kb_name) kbCounts[q.kb_name] = (kbCounts[q.kb_name] ?? 0) + 1;
  const topKb = Object.entries(kbCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#111111] border border-[#262626] rounded-lg p-3 text-center">
          <p className="text-xs text-[#525252] mb-1">Queries Today</p>
          <p className="text-lg font-semibold text-[#fafafa]">{queriesToday}</p>
        </div>
        <div className="bg-[#111111] border border-[#262626] rounded-lg p-3 text-center">
          <p className="text-xs text-[#525252] mb-1">Avg Latency</p>
          <p className="text-lg font-semibold text-[#fafafa]">{avgLat > 0 ? `${avgLat}ms` : '—'}</p>
        </div>
        <div className="bg-[#111111] border border-[#262626] rounded-lg p-3 text-center">
          <p className="text-xs text-[#525252] mb-1">Top Queried KB</p>
          <p className="text-sm font-semibold text-[#fafafa] truncate">{topKb}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <select
            value={filterKb}
            onChange={e => { setFilterKb(e.target.value); setPage(0); }}
            className="appearance-none bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 pr-8 text-sm text-[#fafafa] focus:outline-none focus:border-[#22c55e]/50"
          >
            <option value="">All KBs</option>
            {knowledgeBases.map(kb => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525252] pointer-events-none" />
        </div>
        <span className="text-xs text-[#525252]">{total} total queries</span>
        <button onClick={load} className="ml-auto p-1.5 text-[#525252] hover:text-[#a3a3a3] transition-colors" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#525252] text-sm">Loading queries...</div>
      ) : queries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Search className="w-12 h-12 text-[#262626] mb-4" />
          <p className="text-[#525252] text-sm">No queries logged yet</p>
        </div>
      ) : (
        <>
          <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#262626]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide">Query</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden md:table-cell">KB</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden sm:table-cell">Results</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden sm:table-cell">Latency</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide hidden md:table-cell">Agent</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#525252] uppercase tracking-wide">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e1e]">
                {queries.map(q => (
                  <tr key={q.id} className="hover:bg-[#161616] transition-colors">
                    <td className="px-4 py-3 text-[#a3a3a3] max-w-xs">
                      <span className="truncate block" title={q.query}>{truncate(q.query, 60)}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {q.kb_name ? (
                        <span className="text-xs text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded px-1.5 py-0.5">{q.kb_name}</span>
                      ) : <span className="text-[#525252]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#a3a3a3] hidden sm:table-cell">{q.results_count}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {q.latency_ms != null ? (
                        <span className="text-[#22c55e] text-xs font-mono">{q.latency_ms}ms</span>
                      ) : <span className="text-[#525252]">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-[#525252] text-xs">
                      {q.agent_id ? truncate(q.agent_id, 20) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#525252] text-xs whitespace-nowrap">
                      {formatRelTime(q.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-[#525252]">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-xs font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded-lg disabled:opacity-40 hover:border-[#404040] transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  className="px-3 py-1.5 text-xs font-medium text-[#a3a3a3] bg-[#1a1a1a] border border-[#262626] rounded-lg disabled:opacity-40 hover:border-[#404040] transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function RagPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [activeTab, setActiveTab] = useState<'kbs' | 'documents' | 'queries'>('kbs');
  const [statsLoading, setStatsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [statsData, kbsData] = await Promise.all([
        observabilityGet<Stats>('/rag/knowledge-bases/stats'),
        observabilityGet<{ knowledgeBases?: KnowledgeBase[] }>('/rag/knowledge-bases'),
      ]);
      setStats(statsData);
      setKbs(kbsData.knowledgeBases ?? []);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const TABS = [
    { key: 'kbs' as const, label: 'Knowledge Bases', count: stats?.totalKBs },
    { key: 'documents' as const, label: 'Documents', count: stats?.totalDocuments },
    { key: 'queries' as const, label: 'Query Log', count: stats?.totalQueries },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#fafafa]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Database className="w-6 h-6 text-[#22c55e]" />
              <h1 className="text-xl font-bold text-[#fafafa]">RAG</h1>
            </div>
            <p className="text-sm text-[#525252]">Retrieval Augmented Generation — manage knowledge bases, documents, and query logs</p>
          </div>
          <button
            onClick={loadData}
            disabled={statsLoading}
            className="p-2 text-[#525252] hover:text-[#a3a3a3] bg-[#111111] border border-[#262626] rounded-lg hover:border-[#404040] transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${statsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Stats Row */}
        <StatsCards
          columns={5}
          className="mb-6"
          stats={[
            { label: 'Knowledge Bases', value: statsLoading ? '—' : (stats?.totalKBs ?? 0), icon: <Database className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
            { label: 'Total Documents',  value: statsLoading ? '—' : (stats?.totalDocuments ?? 0), icon: <FileText className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
            { label: 'Total Chunks',     value: statsLoading ? '—' : (stats?.totalChunks ?? 0).toLocaleString(), icon: <Layers className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
            { label: 'Queries',          value: statsLoading ? '—' : (stats?.totalQueries ?? 0), sub: 'all time', icon: <Search className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
            { label: 'Avg Latency',      value: statsLoading ? '—' : stats?.avgLatency ? `${stats.avgLatency}ms` : '—', icon: <Zap className="w-5 h-5 text-[#22c55e]" />, iconBg: 'bg-[#1a1a1a]' },
          ] satisfies StatCardDef[]}
        />

        {/* Type distribution */}
        {stats && Object.values(stats.byType).some(v => v > 0) && (
          <div className="flex items-center gap-3 flex-wrap mb-6">
            <span className="text-xs text-[#525252]">By type:</span>
            {Object.entries(stats.byType).filter(([, v]) => v > 0).map(([type, count]) => (
              <span key={type} className="inline-flex items-center gap-1">
                <TypeBadge type={type} />
                <span className="text-xs text-[#525252]">{count}</span>
              </span>
            ))}
          </div>
        )}

        {/* Tab Toggle */}
        <div className="flex items-center gap-1 mb-6 bg-[#111111] border border-[#262626] rounded-xl p-1 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'bg-[#1a1a1a] text-[#fafafa] border border-[#262626]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#1a1a1a] text-[#525252]'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'kbs' && (
          <KBTab kbs={kbs} onRefresh={loadData} />
        )}
        {activeTab === 'documents' && (
          <DocumentsTab knowledgeBases={kbs} onRefresh={loadData} />
        )}
        {activeTab === 'queries' && (
          <QueryLogTab knowledgeBases={kbs} />
        )}
      </div>
    </div>
  );
}
