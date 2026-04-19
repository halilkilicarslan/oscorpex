import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Kanban, Zap, AlertCircle, X, ShieldAlert, XCircle } from 'lucide-react';
import {
  fetchTasks,
  retryTask,
  fetchAutoStartStatus,
  fetchProjectAgents,
  approveTask,
  rejectTask,
  type Task,
  type AutoStartStatus,
  type ProjectAgent,
} from '../../lib/studio-api';
import TaskCard from './TaskCard';
import TaskDetailModal from './TaskDetailModal';
import TerminalSheet from './TerminalSheet';
import ModalOverlay from './ModalOverlay';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';

const KANBAN_WS_EVENTS = ['task:completed', 'task:failed', 'task:started', 'task:assigned', 'task:retry'];

const COLUMNS: { key: Task['status']; label: string; color: string }[] = [
  { key: 'queued', label: 'Queued', color: 'border-[#525252]' },
  { key: 'assigned', label: 'Assigned', color: 'border-[#3b82f6]' },
  { key: 'running', label: 'Running', color: 'border-[#f59e0b]' },
  { key: 'review', label: 'Review', color: 'border-[#a855f7]' },
  { key: 'revision', label: 'Revision', color: 'border-[#f97316]' },
  // Human-in-the-Loop: Onay bekleyen task'lar için özel sütun
  { key: 'waiting_approval', label: 'Awaiting Approval', color: 'border-[#f59e0b]' },
  { key: 'done', label: 'Done', color: 'border-[#22c55e]' },
  { key: 'failed', label: 'Failed', color: 'border-[#ef4444]' },
];

// Pipeline durum renk ve etiket eslemesi
const PIPELINE_STATUS_COLORS: Record<string, string> = {
  idle: 'text-[#525252]',
  running: 'text-[#22c55e]',
  paused: 'text-[#f59e0b]',
  completed: 'text-[#3b82f6]',
  failed: 'text-[#ef4444]',
};

const PIPELINE_STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

// Pipeline auto-start durum cubugu
function PipelineAutoStartBadge({ status }: { status: AutoStartStatus }) {
  if (!status.planApproved || !status.pipeline) return null;

  const pipelineStatus = status.pipeline.status;
  const colorClass = PIPELINE_STATUS_COLORS[pipelineStatus] ?? 'text-[#525252]';
  const label = PIPELINE_STATUS_LABELS[pipelineStatus] ?? pipelineStatus;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-4 rounded-lg bg-[#22c55e]/5 border border-[#22c55e]/15 text-[11px]">
      <Zap size={12} className="text-[#22c55e] shrink-0" />
      <span className="text-[#a3a3a3]">Pipeline auto-start:</span>
      <span className={`font-medium ${colorClass}`}>{label}</span>
      {status.pipeline.totalStages > 0 && (
        <span className="text-[#525252] ml-auto">
          Stage {status.pipeline.currentStage + 1} / {status.pipeline.totalStages}
        </span>
      )}
    </div>
  );
}

// ---- Toast bildirimi --------------------------------------------------------

interface ToastMessage {
  id: number;
  message: string;
  type?: 'error' | 'success';
}

let toastCounter = 0;

function ErrorToast({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            'flex items-start gap-2 text-[12px] px-3 py-2 rounded-lg shadow-lg pointer-events-auto max-w-[320px]',
            t.type === 'success'
              ? 'bg-[#0a1a0a] border border-[#22c55e]/30 text-[#22c55e]'
              : 'bg-[#1a0a0a] border border-[#ef4444]/30 text-[#ef4444]',
          ].join(' ')}
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="opacity-60 hover:opacity-100 transition-colors ml-1"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- Red sebebi modal -------------------------------------------------------

interface RejectModalProps {
  taskTitle: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function RejectModal({ taskTitle, onConfirm, onCancel }: RejectModalProps) {
  const [reason, setReason] = useState('');

  return (
    <ModalOverlay onClose={onCancel} className="bg-black/70">
      <div className="bg-[#111] border border-[#262626] rounded-xl p-5 w-[360px] shadow-2xl">
        {/* Baslik */}
        <div className="flex items-center gap-2 mb-3">
          <XCircle size={16} className="text-[#ef4444]" />
          <h2 className="text-[13px] font-semibold text-[#e5e5e5]">Reject Task</h2>
        </div>

        {/* Task adi */}
        <p className="text-[11px] text-[#737373] mb-3 leading-snug">
          You are about to reject <span className="text-[#a3a3a3] font-medium">"{taskTitle}"</span>.
        </p>

        {/* Red sebebi */}
        <label className="block text-[11px] text-[#737373] mb-1.5">
          Rejection reason (optional)
        </label>
        <textarea
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you rejecting this task?"
          rows={3}
          className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] placeholder-[#3a3a3a] resize-none focus:outline-none focus:border-[#ef4444]/50 transition-colors"
        />

        {/* Butonlar */}
        <div className="flex gap-2 mt-4 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] text-[#737373] hover:text-[#a3a3a3] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/20 rounded-lg transition-colors"
          >
            <XCircle size={12} />
            Reject
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ---- KanbanBoard ------------------------------------------------------------

export default function KanbanBoard({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoStartStatus, setAutoStartStatus] = useState<AutoStartStatus | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // Red modal için seçili task
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  // Terminal sheet için seçili task
  const [terminalTask, setTerminalTask] = useState<Task | null>(null);
  // Detay modal için seçili task
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  const load = useCallback(() => {
    Promise.all([fetchTasks(projectId), fetchProjectAgents(projectId)])
      .then(([t, a]) => { setTasks(t); setAgents(a); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const loadAutoStartStatus = useCallback(() => {
    fetchAutoStartStatus(projectId)
      .then(setAutoStartStatus)
      .catch(() => {});
  }, [projectId]);

  // WS-driven refresh — task olaylarında yeniden yükler
  const { isWsActive } = useWsEventRefresh(projectId, KANBAN_WS_EVENTS, () => {
    load();
    loadAutoStartStatus();
  }, { debounceMs: 500 });

  // İlk yükleme
  useEffect(() => {
    load();
    loadAutoStartStatus();
  }, [load, loadAutoStartStatus]);

  // Polling — yalnızca WS bağlantısı yoksa çalışır
  useEffect(() => {
    if (isWsActive) return;
    const interval = setInterval(() => {
      load();
      loadAutoStartStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [isWsActive, load, loadAutoStartStatus]);

  const handleRetry = async (taskId: string): Promise<void> => {
    // Optimistik guncelleme: task'i queued'a tasiyalim
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'queued' as const } : t,
      ),
    );
    try {
      await retryTask(projectId, taskId);
      load();
    } catch (err) {
      load();
      const message =
        err instanceof Error
          ? `Retry basarisiz: ${err.message}`
          : 'Retry sirasinda beklenmeyen bir hata olustu.';
      showToast(message);
    }
  };

  // Onay ver — task'i queued'a geri alir, execution baslar
  const handleApprove = async (taskId: string): Promise<void> => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'queued' as const, approvalStatus: 'approved' } : t,
      ),
    );
    try {
      await approveTask(projectId, taskId);
      load();
      showToast('Task onaylandi — execution basliyor.', 'success');
    } catch (err) {
      load();
      const message = err instanceof Error ? `Onay basarisiz: ${err.message}` : 'Onay sirasinda hata olustu.';
      showToast(message);
    }
  };

  // Red modal acma
  const handleOpenReject = (task: Task) => {
    setRejectingTask(task);
  };

  // Red onayi — sebep ile birlikte API'ye gonder
  const handleConfirmReject = async (reason: string) => {
    if (!rejectingTask) return;
    const taskId = rejectingTask.id;
    const taskTitle = rejectingTask.title;
    setRejectingTask(null);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'failed' as const, approvalStatus: 'rejected' } : t,
      ),
    );
    try {
      await rejectTask(projectId, taskId, reason || undefined);
      load();
      showToast(`"${taskTitle}" reddedildi.`, 'error');
    } catch (err) {
      load();
      const message = err instanceof Error ? `Red basarisiz: ${err.message}` : 'Red sirasinda hata olustu.';
      showToast(message);
    }
  };

  // Sub-task map: parentTaskId -> sub-task listesi
  const subTaskMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.parentTaskId) {
        if (!map.has(task.parentTaskId)) map.set(task.parentTaskId, []);
        map.get(task.parentTaskId)!.push(task);
      }
    }
    return map;
  }, [tasks]);

  // Task'ları status'e göre grupla
  const grouped = useMemo(() => {
    const map = new Map<Task['status'], Task[]>();
    for (const col of COLUMNS) map.set(col.key, []);
    for (const task of tasks) {
      const list = map.get(task.status);
      if (list) list.push(task);
    }
    return map;
  }, [tasks]);

  // Yalnizca task olan veya her zaman görünen sütunlari göster
  const activeColumns = useMemo(
    () => COLUMNS.filter(
      (col) => (grouped.get(col.key)?.length ?? 0) > 0 || ['queued', 'running', 'done'].includes(col.key),
    ),
    [grouped],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <Kanban size={32} className="text-[#333] mb-3" />
        <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Tasks Yet</h3>
        <p className="text-[12px] text-[#525252] max-w-sm">
          Tasks will appear here after you create and approve a project plan in the Planner.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Red modal */}
      {rejectingTask && (
        <RejectModal
          taskTitle={rejectingTask.title}
          onConfirm={handleConfirmReject}
          onCancel={() => setRejectingTask(null)}
        />
      )}

      {/* Terminal sheet */}
      {terminalTask && (() => {
        const assigned = terminalTask.assignedAgent ?? terminalTask.assignedAgentId;
        const aLower = (assigned ?? '').toLowerCase();
        const agent = agents.find(
          (a) => a.id === assigned
            || a.role.toLowerCase() === aLower
            || a.name.toLowerCase() === aLower
            || a.role.toLowerCase().startsWith(aLower + '-')
            || a.role.toLowerCase().endsWith('-' + aLower),
        ) ?? null;
        return (
          <TerminalSheet
            projectId={projectId}
            taskId={terminalTask.id}
            taskTitle={terminalTask.title}
            agent={agent}
            isRunning={terminalTask.status === 'running'}
            onClose={() => setTerminalTask(null)}
          />
        );
      })()}

      <ErrorToast toasts={toasts} onDismiss={dismissToast} />
      <div className="p-6 h-full overflow-x-auto flex flex-col">
        {/* Pipeline auto-start durum cubugu */}
        {autoStartStatus && <PipelineAutoStartBadge status={autoStartStatus} />}

        {/* Bekleyen onay bildirimi — waiting_approval task varsa göster */}
        {(() => {
          const pendingCount = tasks.filter((t) => t.status === 'waiting_approval').length;
          if (pendingCount === 0) return null;
          return (
            <div className="flex items-center gap-2.5 px-3 py-2 mb-4 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/25 text-[11px]">
              <ShieldAlert size={13} className="text-[#f59e0b] shrink-0" />
              <span className="text-[#f59e0b] font-semibold">
                {pendingCount} task onay bekliyor
              </span>
              <span className="text-[#737373]">—</span>
              <span className="text-[#737373]">
                Awaiting Approval kolonundaki task'ları inceleyip onaylayın veya reddedin.
              </span>
              <span className="ml-auto bg-[#f59e0b]/15 text-[#f59e0b] font-bold text-[10px] px-2 py-0.5 rounded-full border border-[#f59e0b]/30">
                {pendingCount}
              </span>
            </div>
          );
        })()}

        <div className="flex gap-4 min-w-min flex-1">
          {activeColumns.map((col) => {
            const colTasks = grouped.get(col.key) ?? [];
            const isApprovalCol = col.key === 'waiting_approval';

            return (
              <div
                key={col.key}
                className="w-[280px] shrink-0 flex flex-col"
              >
                {/* Column header */}
                <div className={`flex items-center gap-2 px-3 py-2 mb-3 border-t-2 ${col.color} rounded-t-sm`}>
                  {isApprovalCol && <ShieldAlert size={12} className="text-[#f59e0b]" />}
                  <span className={`text-[12px] font-semibold uppercase ${isApprovalCol ? 'text-[#f59e0b]' : 'text-[#a3a3a3]'}`}>
                    {col.label}
                  </span>
                  <span className="text-[11px] text-[#525252] bg-[#1f1f1f] px-1.5 py-0.5 rounded-full">
                    {colTasks.length}
                  </span>
                </div>

                {/* Tasks */}
                <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                  {colTasks.map((task) => {
                    const subTasks = subTaskMap.get(task.id) ?? [];
                    const doneSubTasks = subTasks.filter((st) => st.status === 'done').length;
                    return (
                      <div key={task.id} className="relative">
                        {task.parentTaskId && (
                          <span className="absolute -top-1.5 right-2 z-10 text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30">
                            Sub-task
                          </span>
                        )}
                        {subTasks.length > 0 && (
                          <span className="absolute -top-1.5 left-2 z-10 text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-[#1f1f1f] text-[#737373] border border-[#262626]">
                            {doneSubTasks}/{subTasks.length} sub-tasks
                          </span>
                        )}
                        <TaskCard
                          task={task}
                          agents={agents}
                          onRetry={task.status === 'failed' ? () => handleRetry(task.id) : undefined}
                          onApprove={isApprovalCol ? () => handleApprove(task.id) : undefined}
                          onReject={isApprovalCol ? () => handleOpenReject(task) : undefined}
                          onTerminal={() => setTerminalTask(task)}
                          onClick={() => setDetailTask(task)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task Detay Modal */}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          agents={agents}
          projectId={projectId}
          allTasks={tasks}
          onNavigateTask={(t) => setDetailTask(t)}
          onClose={() => setDetailTask(null)}
          onRefresh={load}
        />
      )}
    </>
  );
}
