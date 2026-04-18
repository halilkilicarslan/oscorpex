import { useState, useEffect, useCallback } from 'react';
import { Plus, Filter, Bug, Lightbulb, Shield, Zap, Wrench, Loader2, X, ArrowRight, ChevronDown, Trash2 } from 'lucide-react';
import ModalOverlay from './ModalOverlay';

const BASE = import.meta.env.VITE_API_BASE ?? '';

type WorkItemType = 'feature' | 'bug' | 'defect' | 'security' | 'hotfix' | 'improvement';
type WorkItemStatus = 'open' | 'planned' | 'in_progress' | 'done' | 'closed' | 'wontfix';
type Priority = 'critical' | 'high' | 'medium' | 'low';

interface WorkItem {
  id: string;
  title: string;
  description?: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: Priority;
  labels?: string[];
  source?: string;
  sprintId?: string | null;
  createdAt: string;
}

interface SprintOption {
  id: string;
  name: string;
  status: string;
}

const COLUMNS: { key: WorkItemStatus; label: string; color: string }[] = [
  { key: 'open', label: 'Open', color: 'border-[#525252]' },
  { key: 'planned', label: 'Planned', color: 'border-[#3b82f6]' },
  { key: 'in_progress', label: 'In Progress', color: 'border-[#f59e0b]' },
  { key: 'done', label: 'Done', color: 'border-[#22c55e]' },
  { key: 'closed', label: 'Closed', color: 'border-[#737373]' },
  { key: 'wontfix', label: "Won't Fix", color: 'border-[#991b1b]' },
];

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: 'bg-[#7f1d1d] text-[#fca5a5] border-[#991b1b]',
  high: 'bg-[#7c2d12] text-[#fdba74] border-[#9a3412]',
  medium: 'bg-[#713f12] text-[#fde68a] border-[#854d0e]',
  low: 'bg-[#1a2e1a] text-[#86efac] border-[#166534]',
};

const TYPE_ICONS: Record<WorkItemType, React.ReactNode> = {
  feature: <Lightbulb size={12} className="text-[#a78bfa]" />,
  bug: <Bug size={12} className="text-[#ef4444]" />,
  defect: <Bug size={12} className="text-[#f97316]" />,
  security: <Shield size={12} className="text-[#38bdf8]" />,
  hotfix: <Zap size={12} className="text-[#f59e0b]" />,
  improvement: <Wrench size={12} className="text-[#22c55e]" />,
};

interface NewItemForm {
  title: string;
  type: WorkItemType;
  priority: Priority;
  description: string;
}

function NewItemModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (form: NewItemForm) => void }) {
  const [form, setForm] = useState<NewItemForm>({ title: '', type: 'feature', priority: 'medium', description: '' });

  return (
    <ModalOverlay onClose={onClose} className="bg-black/70">
      <div className="bg-[#111111] border border-[#262626] rounded-xl p-5 w-[400px] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[13px] font-semibold text-[#fafafa]">New Work Item</h2>
          <button type="button" onClick={onClose} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-[11px] text-[#737373] mb-1">Title</label>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Work item title..."
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] placeholder-[#3a3a3a] focus:outline-none focus:border-[#22c55e]/50 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#737373] mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as WorkItemType }))}
                className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] focus:outline-none focus:border-[#22c55e]/50 transition-colors"
              >
                <option value="feature">Feature</option>
                <option value="bug">Bug</option>
                <option value="defect">Defect</option>
                <option value="security">Security</option>
                <option value="hotfix">Hotfix</option>
                <option value="improvement">Improvement</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#737373] mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
                className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] focus:outline-none focus:border-[#22c55e]/50 transition-colors"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-[#737373] mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description..."
              rows={3}
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] placeholder-[#3a3a3a] resize-none focus:outline-none focus:border-[#22c55e]/50 transition-colors"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-[#737373] hover:text-[#a3a3a3] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => form.title.trim() && onSubmit(form)}
            disabled={!form.title.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
            Create
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function WorkItemCard({
  item,
  sprints,
  onConvert,
  onAssignSprint,
  onStatusChange,
  onDelete,
}: {
  item: WorkItem;
  sprints: SprintOption[];
  onConvert: (id: string) => void;
  onAssignSprint: (id: string, sprintId: string | null) => void;
  onStatusChange: (id: string, status: WorkItemStatus) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-lg p-3 hover:border-[#333] transition-colors group">
      <div className="flex items-start gap-2 mb-2">
        <span className="mt-0.5 shrink-0">{TYPE_ICONS[item.type]}</span>
        <p className="text-[12px] text-[#e5e5e5] leading-snug flex-1">{item.title}</p>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="opacity-0 group-hover:opacity-100 text-[#525252] hover:text-[#f87171] transition-all shrink-0 mt-0.5"
          title="Sil"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[item.priority]}`}>
          {item.priority}
        </span>
        {item.labels?.map((label) => (
          <span key={label} className="text-[10px] text-[#525252] bg-[#1a1a1a] border border-[#262626] px-1.5 py-0.5 rounded">
            {label}
          </span>
        ))}
        {item.source && (
          <span className="text-[10px] text-[#525252] ml-auto">{item.source}</span>
        )}
      </div>

      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#1a1a1a] flex-wrap">
        <select
          value={item.status}
          onChange={(e) => onStatusChange(item.id, e.target.value as WorkItemStatus)}
          className="text-[10px] bg-[#0a0a0a] border border-[#262626] rounded px-1.5 py-0.5 text-[#a3a3a3] hover:border-[#333] focus:outline-none focus:border-[#22c55e]"
          aria-label="Status"
        >
          {COLUMNS.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <select
          value={item.sprintId ?? ''}
          onChange={(e) => onAssignSprint(item.id, e.target.value || null)}
          className="text-[10px] bg-[#0a0a0a] border border-[#262626] rounded px-1.5 py-0.5 text-[#a3a3a3] hover:border-[#333] focus:outline-none focus:border-[#22c55e]"
          aria-label="Sprint"
        >
          <option value="">Sprint yok</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {item.status === 'open' && (
          <button
            type="button"
            onClick={() => onConvert(item.id)}
            className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#22c55e] transition-colors ml-auto"
          >
            <ArrowRight size={10} />
            Convert
          </button>
        )}
      </div>
    </div>
  );
}

export default function BacklogBoard({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [sprints, setSprints] = useState<SprintOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterType, setFilterType] = useState<WorkItemType | ''>('');
  const [filterPriority, setFilterPriority] = useState<Priority | ''>('');
  const [filterSource, setFilterSource] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch(`${BASE}/api/studio/projects/${projectId}/work-items`).then((r) => r.json()),
      fetch(`${BASE}/api/studio/projects/${projectId}/sprints`).then((r) => r.json()).catch(() => []),
    ])
      .then(([wi, sp]) => {
        setItems(Array.isArray(wi) ? wi : (wi.items ?? []));
        setSprints(Array.isArray(sp) ? sp : (sp.sprints ?? []));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (form: NewItemForm) => {
    setShowModal(false);
    try {
      await fetch(`${BASE}/api/studio/projects/${projectId}/work-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      load();
    } catch {}
  };

  const handleConvert = async (itemId: string) => {
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}/plan`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? 'Convert failed');
        return;
      }
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Convert failed');
    }
  };

  const handleAssignSprint = async (itemId: string, sprintId: string | null) => {
    try {
      await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprintId }),
      });
      load();
    } catch {}
  };

  const handleStatusChange = async (itemId: string, status: WorkItemStatus) => {
    try {
      await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      load();
    } catch {}
  };

  const handleDelete = async (itemId: string) => {
    try {
      await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, {
        method: 'DELETE',
      });
      load();
    } catch {}
  };

  const filtered = items.filter((i) => {
    if (filterType && i.type !== filterType) return false;
    if (filterPriority && i.priority !== filterPriority) return false;
    if (filterSource && i.source !== filterSource) return false;
    return true;
  });

  const grouped = new Map<WorkItemStatus, WorkItem[]>();
  for (const col of COLUMNS) grouped.set(col.key, []);
  for (const item of filtered) {
    const list = grouped.get(item.status);
    if (list) list.push(item);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <>
      {showModal && <NewItemModal onClose={() => setShowModal(false)} onSubmit={handleCreate} />}

      <div className="flex flex-col h-full p-5 gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-[#fafafa]">Backlog</h2>
            <p className="text-[11px] text-[#525252] mt-0.5">{items.length} work items</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                showFilters || filterType || filterPriority || filterSource
                  ? 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]'
                  : 'text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414] border-[#262626]'
              }`}
            >
              <Filter size={12} />
              Filter
              <ChevronDown size={10} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
            >
              <Plus size={12} />
              New Work Item
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="flex items-center gap-3 p-3 bg-[#111111] border border-[#262626] rounded-lg flex-wrap">
            <span className="text-[11px] text-[#525252]">Type:</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as WorkItemType | '')}
              className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1 text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e]/50"
            >
              <option value="">All</option>
              <option value="feature">Feature</option>
              <option value="bug">Bug</option>
              <option value="defect">Defect</option>
              <option value="security">Security</option>
              <option value="hotfix">Hotfix</option>
              <option value="improvement">Improvement</option>
            </select>

            <span className="text-[11px] text-[#525252]">Priority:</span>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as Priority | '')}
              className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1 text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e]/50"
            >
              <option value="">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <span className="text-[11px] text-[#525252]">Source:</span>
            <input
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              placeholder="Filter by source..."
              className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1 text-[11px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none focus:border-[#22c55e]/50 w-36"
            />

            {(filterType || filterPriority || filterSource) && (
              <button
                type="button"
                onClick={() => { setFilterType(''); setFilterPriority(''); setFilterSource(''); }}
                className="text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors ml-auto"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Columns */}
        <div className="flex gap-4 flex-1 overflow-x-auto min-w-0">
          {COLUMNS.map((col) => {
            const colItems = grouped.get(col.key) ?? [];
            return (
              <div key={col.key} className="w-[280px] shrink-0 flex flex-col">
                <div className={`flex items-center gap-2 px-3 py-2 mb-3 border-t-2 ${col.color} rounded-t-sm`}>
                  <span className="text-[12px] font-semibold uppercase text-[#a3a3a3]">{col.label}</span>
                  <span className="text-[11px] text-[#525252] bg-[#1f1f1f] px-1.5 py-0.5 rounded-full">
                    {colItems.length}
                  </span>
                </div>
                <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                  {colItems.map((item) => (
                    <WorkItemCard
                      key={item.id}
                      item={item}
                      sprints={sprints}
                      onConvert={handleConvert}
                      onAssignSprint={handleAssignSprint}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                    />
                  ))}
                  {colItems.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-[11px] text-[#333]">
                      No items
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
