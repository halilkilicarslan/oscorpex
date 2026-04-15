import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Calendar, Target, TrendingUp, ChevronDown, CheckCircle2, Clock, Play, Square, XCircle } from 'lucide-react';

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
}

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

export default function SprintBoard({ projectId }: { projectId: string }) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch(`${BASE}/api/studio/projects/${projectId}/sprints`)
      .then((r) => r.json())
      .then((data) => {
        const list: Sprint[] = Array.isArray(data) ? data : (data.sprints ?? []);
        setSprints(list);
        if (list.length > 0 && !selectedId) {
          const active = list.find((s) => s.status === 'active');
          setSelectedId(active?.id ?? list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateSprint = async () => {
    setCreating(true);
    try {
      await fetch(`${BASE}/api/studio/projects/${projectId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Sprint ${sprints.length + 1}` }),
      });
      load();
    } catch {}
    setCreating(false);
  };

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
      load();
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
          onClick={handleCreateSprint}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
        >
          <Plus size={12} />
          {creating ? 'Creating...' : 'Create Sprint'}
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

                {/* Progress bar */}
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
              <div className="grid grid-cols-3 gap-3">
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
                    <TrendingUp size={10} /> Velocity
                  </span>
                  <span className="text-[20px] font-bold text-[#3b82f6]">
                    {selected.velocity ?? '—'}
                  </span>
                  <span className="text-[10px] text-[#525252]">points</span>
                </div>
              </div>

              {/* Burndown placeholder */}
              <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={14} className="text-[#3b82f6]" />
                  <h3 className="text-[12px] font-semibold text-[#fafafa]">Burndown Chart</h3>
                </div>
                <div className="flex items-center justify-center h-32 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]">
                  <span className="text-[12px] text-[#333]">Burndown Chart</span>
                </div>
              </div>

              {/* Work items list */}
              <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
                  <Clock size={14} className="text-[#f59e0b]" />
                  <h3 className="text-[12px] font-semibold text-[#fafafa]">Work Items</h3>
                  <span className="ml-auto text-[10px] text-[#525252]">{totalCount} items</span>
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
                        className="flex items-center gap-3 px-4 py-2.5 border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors"
                      >
                        <span className={`text-[11px] font-medium ${ITEM_STATUS_COLORS[item.status] ?? 'text-[#525252]'}`}>
                          •
                        </span>
                        <span className="text-[12px] text-[#e5e5e5] flex-1">{item.title}</span>
                        <span className="text-[10px] text-[#525252] bg-[#1a1a1a] px-1.5 py-0.5 rounded border border-[#262626]">
                          {item.type}
                        </span>
                        <span className="text-[10px] text-[#525252] w-16 text-right capitalize">
                          {item.status.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
