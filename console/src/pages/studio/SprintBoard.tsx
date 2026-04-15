import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Plus,
  Calendar,
  Target,
  TrendingUp,
  ChevronDown,
  CheckCircle2,
  Clock,
  Play,
  Square,
  XCircle,
  X,
  Users,
} from 'lucide-react';

const BASE = import.meta.env.VITE_API_BASE ?? '';

type SprintStatus = 'planned' | 'active' | 'completed' | 'cancelled';

interface Sprint {
  id: string;
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  status: SprintStatus;
  velocity?: number;
  workItems?: SprintWorkItem[];
}

interface SprintWorkItem {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  sprintId?: string | null;
}

interface BurndownPoint {
  date: string;
  remaining: number;
}

// ---------------------------------------------------------------------------
// Burndown chart
// ---------------------------------------------------------------------------

function BurndownChart({ points, totalItems }: { points: BurndownPoint[]; totalItems: number }) {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]">
        <span className="text-[12px] text-[#333]">Henüz veri yok</span>
      </div>
    );
  }

  const W = 400;
  const H = 110;
  const P = 16; // padding
  const maxY = Math.max(totalItems, ...points.map((p) => p.remaining), 1);
  const step = points.length > 1 ? (W - P * 2) / (points.length - 1) : 0;
  const toX = (i: number) => P + i * step;
  const toY = (v: number) => H - P - (v / maxY) * (H - P * 2);

  const actualPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.remaining)}`)
    .join(' ');

  const idealStart = toY(totalItems);
  const idealEnd = toY(0);
  const idealPath = `M ${P} ${idealStart} L ${W - P} ${idealEnd}`;

  return (
    <div className="rounded-lg bg-[#0d0d0d] border border-[#1a1a1a] p-2 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-32"
        role="img"
        aria-label="Burndown chart"
      >
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#1a1a1a" strokeWidth={1} />
        <path d={idealPath} stroke="#525252" strokeWidth={1} strokeDasharray="3,3" fill="none" />
        <path d={actualPath} stroke="#3b82f6" strokeWidth={1.5} fill="none" />
        {points.map((p, i) => (
          <circle key={`${p.date}-${i}`} cx={toX(i)} cy={toY(p.remaining)} r={2} fill="#3b82f6" />
        ))}
      </svg>
      <div className="flex items-center justify-between text-[10px] text-[#525252] px-2 pt-1">
        <span>{points[0]?.date}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#3b82f6]" /> Gerçek</span>
          <span className="flex items-center gap-1"><span className="w-2 h-px border-t border-dashed border-[#525252]" /> İdeal</span>
        </span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<SprintStatus, string> = {
  planned: 'bg-[#1e3a5f] text-[#93c5fd] border-[#2563eb]',
  active: 'bg-[#052e16] text-[#86efac] border-[#166534]',
  completed: 'bg-[#1a1a1a] text-[#a3a3a3] border-[#262626]',
  cancelled: 'bg-[#450a0a] text-[#fca5a5] border-[#991b1b]',
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  open: 'text-[#525252]',
  planned: 'text-[#3b82f6]',
  in_progress: 'text-[#f59e0b]',
  done: 'text-[#22c55e]',
};

function defaultSprintDates(): { startDate: string; endDate: string } {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Create Sprint Modal
// ---------------------------------------------------------------------------

interface CreateSprintModalProps {
  projectId: string;
  defaultName: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreateSprintModal({ projectId, defaultName, onClose, onCreated }: CreateSprintModalProps) {
  const defaults = defaultSprintDates();
  const [name, setName] = useState(defaultName);
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('İsim zorunlu');
      return;
    }
    if (endDate < startDate) {
      setError('Bitiş tarihi başlangıçtan önce olamaz');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          goal: goal.trim() || undefined,
          startDate,
          endDate,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Sprint oluşturulamadı');
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] bg-[#111111] border border-[#262626] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
          <h3 className="text-[13px] font-semibold text-[#fafafa]">Yeni Sprint</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
            aria-label="Kapat"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">
              İsim
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
              placeholder="Sprint 1"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">
              Hedef (opsiyonel)
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
              placeholder="Auth akışını tamamla"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">
                Başlangıç
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#525252] mb-1">
                Bitiş
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-2 py-1.5 text-[12px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
              />
            </div>
          </div>

          {error && (
            <div className="px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1a1a1a]">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-[11px] text-[#a3a3a3] hover:text-[#fafafa] transition-colors disabled:opacity-50"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Oluştur
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work item picker (unassigned items → sprint)
// ---------------------------------------------------------------------------

interface AddWorkItemPickerProps {
  unassigned: SprintWorkItem[];
  onAdd: (itemId: string) => void;
  disabled?: boolean;
}

function AddWorkItemPicker({ unassigned, onAdd, disabled }: AddWorkItemPickerProps) {
  const [open, setOpen] = useState(false);
  if (unassigned.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[#22c55e] border border-[#22c55e]/30 rounded hover:bg-[#22c55e]/10 transition-colors disabled:opacity-40"
      >
        <Plus size={10} /> Item ekle ({unassigned.length})
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 max-h-56 overflow-y-auto bg-[#0d0d0d] border border-[#262626] rounded-lg shadow-xl z-10">
          {unassigned.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                onAdd(it.id);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-[11px] text-[#e5e5e5] hover:bg-[#1a1a1a] transition-colors border-b border-[#1a1a1a] last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-[#525252] bg-[#1a1a1a] px-1 rounded border border-[#262626]">
                  {it.type}
                </span>
                <span className="truncate">{it.title}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SprintBoard({ projectId }: { projectId: string }) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [burndown, setBurndown] = useState<BurndownPoint[]>([]);
  const [teamVelocity, setTeamVelocity] = useState<number | null>(null);
  const [allItems, setAllItems] = useState<SprintWorkItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const loadSprints = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/sprints`);
      const data = await res.json();
      const list: Sprint[] = Array.isArray(data) ? data : (data.sprints ?? []);
      setSprints(list);
      setSelectedId((current) => {
        if (current && list.some((s) => s.id === current)) return current;
        const active = list.find((s) => s.status === 'active');
        return active?.id ?? list[0]?.id ?? '';
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadAllItems = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/work-items`);
      const data = await res.json();
      const list: SprintWorkItem[] = Array.isArray(data) ? data : (data.items ?? data.workItems ?? []);
      setAllItems(list);
    } catch {
      setAllItems([]);
    }
  }, [projectId]);

  const loadTeamVelocity = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/velocity`);
      if (!res.ok) return;
      const body = await res.json();
      setTeamVelocity(typeof body.velocity === 'number' ? body.velocity : null);
    } catch {
      setTeamVelocity(null);
    }
  }, [projectId]);

  useEffect(() => {
    loadSprints();
    loadAllItems();
    loadTeamVelocity();
  }, [loadSprints, loadAllItems, loadTeamVelocity]);

  useEffect(() => {
    if (!selectedId) {
      setBurndown([]);
      return;
    }
    fetch(`${BASE}/api/studio/sprints/${selectedId}/burndown`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => setBurndown(Array.isArray(body?.data) ? body.data : []))
      .catch(() => setBurndown([]));
  }, [selectedId]);

  const handleLifecycleAction = async (sprintId: string, action: 'start' | 'complete' | 'cancel') => {
    try {
      const res = await fetch(`${BASE}/api/studio/sprints/${sprintId}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? `Sprint ${action} failed`);
        return;
      }
      await loadSprints();
      await loadTeamVelocity();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleAssignToSprint = async (itemId: string, sprintId: string | null) => {
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/work-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprintId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? 'Assign failed');
        return;
      }
      await loadSprints();
      await loadAllItems();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const selected = sprints.find((s) => s.id === selectedId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  const formatDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const doneCount = selected?.workItems?.filter((i) => i.status === 'done').length ?? 0;
  const totalCount = selected?.workItems?.length ?? 0;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const unassigned = allItems.filter((i) => !i.sprintId);

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#fafafa]">Sprint Board</h2>
          <p className="text-[11px] text-[#525252] mt-0.5">{sprints.length} sprint{sprints.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
        >
          <Plus size={12} />
          Yeni Sprint
        </button>
      </div>

      {sprints.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <Calendar size={32} className="text-[#333] mb-3" />
          <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Sprints Yet</h3>
          <p className="text-[12px] text-[#525252]">Create a sprint to start planning work.</p>
        </div>
      ) : (
        <>
          {/* Sprint selector */}
          <div className="relative">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full appearance-none bg-[#111111] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] focus:outline-none focus:border-[#22c55e]/50 transition-colors pr-8"
            >
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252] pointer-events-none" />
          </div>

          {selected && (
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
              {/* Sprint info card */}
              <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#fafafa]">{selected.name}</h3>
                    {selected.goal && (
                      <p className="text-[12px] text-[#737373] mt-1 flex items-start gap-1.5">
                        <Target size={12} className="text-[#22c55e] mt-0.5 shrink-0" />
                        {selected.goal}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_BADGE[selected.status]}`}>
                      {selected.status}
                    </span>
                    {selected.status === 'planned' && (
                      <button
                        type="button"
                        onClick={() => handleLifecycleAction(selected.id, 'start')}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold bg-[#052e16] text-[#86efac] border-[#166534] hover:bg-[#083b1d] transition-colors"
                      >
                        <Play size={10} /> Start
                      </button>
                    )}
                    {selected.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => handleLifecycleAction(selected.id, 'complete')}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold bg-[#1e3a5f] text-[#93c5fd] border-[#2563eb] hover:bg-[#254877] transition-colors"
                      >
                        <Square size={10} /> Complete
                      </button>
                    )}
                    {(selected.status === 'planned' || selected.status === 'active') && (
                      <button
                        type="button"
                        onClick={() => handleLifecycleAction(selected.id, 'cancel')}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold bg-[#450a0a] text-[#fca5a5] border-[#991b1b] hover:bg-[#5a0e0e] transition-colors"
                      >
                        <XCircle size={10} /> Cancel
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-6 text-[11px] text-[#525252]">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={11} />
                    {formatDate(selected.startDate)} — {formatDate(selected.endDate)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={11} className="text-[#22c55e]" />
                    {doneCount} / {totalCount} items done
                  </span>
                </div>

                {totalCount > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#525252]">Progress</span>
                      <span className="text-[10px] font-semibold text-[#22c55e]">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <div
                        className="h-1.5 rounded-full bg-[#22c55e] transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-[#525252] uppercase tracking-wider">Items</span>
                  <span className="text-[20px] font-bold text-[#fafafa]">{totalCount}</span>
                  <span className="text-[10px] text-[#525252]">in sprint</span>
                </div>
                <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-[#525252] uppercase tracking-wider">Completed</span>
                  <span className="text-[20px] font-bold text-[#22c55e]">{doneCount}</span>
                  <span className="text-[10px] text-[#525252]">work items</span>
                </div>
                <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-[#525252] uppercase tracking-wider flex items-center gap-1">
                    <TrendingUp size={10} /> Sprint Vel.
                  </span>
                  <span className="text-[20px] font-bold text-[#3b82f6]">
                    {selected.velocity ?? doneCount}
                  </span>
                  <span className="text-[10px] text-[#525252]">done in sprint</span>
                </div>
                <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] text-[#525252] uppercase tracking-wider flex items-center gap-1">
                    <Users size={10} /> Team Vel.
                  </span>
                  <span className="text-[20px] font-bold text-[#a855f7]">
                    {teamVelocity ?? '—'}
                  </span>
                  <span className="text-[10px] text-[#525252]">avg / sprint</span>
                </div>
              </div>

              {/* Burndown chart */}
              <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={14} className="text-[#3b82f6]" />
                  <h3 className="text-[12px] font-semibold text-[#fafafa]">Burndown Chart</h3>
                  <span className="ml-auto text-[10px] text-[#525252]">{burndown.length} gün</span>
                </div>
                <BurndownChart points={burndown} totalItems={totalCount} />
              </div>

              {/* Work items list */}
              <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
                  <Clock size={14} className="text-[#f59e0b]" />
                  <h3 className="text-[12px] font-semibold text-[#fafafa]">Work Items</h3>
                  <span className="text-[10px] text-[#525252]">{totalCount} items</span>
                  <span className="ml-auto">
                    <AddWorkItemPicker
                      unassigned={unassigned}
                      onAdd={(id) => handleAssignToSprint(id, selected.id)}
                    />
                  </span>
                </div>
                {!selected.workItems || selected.workItems.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-[12px] text-[#525252]">
                    No work items assigned to this sprint
                  </div>
                ) : (
                  <div>
                    {selected.workItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 px-4 py-2.5 border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors group"
                      >
                        <span className={`text-[11px] font-medium ${ITEM_STATUS_COLORS[item.status] ?? 'text-[#525252]'}`}>
                          •
                        </span>
                        <span className="text-[12px] text-[#e5e5e5] flex-1 truncate">{item.title}</span>
                        <span className="text-[10px] text-[#525252] bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#262626]">
                          {item.type}
                        </span>
                        <span className="text-[10px] text-[#525252] w-16 text-right capitalize">
                          {item.status.replace('_', ' ')}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAssignToSprint(item.id, null)}
                          className="opacity-0 group-hover:opacity-100 text-[#525252] hover:text-[#f87171] transition-all"
                          title="Sprint'ten çıkar"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateSprintModal
          projectId={projectId}
          defaultName={`Sprint ${sprints.length + 1}`}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            loadSprints();
            loadTeamVelocity();
          }}
        />
      )}
    </div>
  );
}
