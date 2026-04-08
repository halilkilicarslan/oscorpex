import { useState, useEffect, useCallback } from 'react';
import { Loader2, Kanban, Zap, AlertCircle, X, ShieldAlert, Check, XCircle } from 'lucide-react';
import {
  fetchTasks,
  retryTask,
  fetchAutoStartStatus,
  fetchProjectAgents,
  approveTask,
  rejectTask,
  roleLabel,
  type Task,
  type AutoStartStatus,
  type ProjectAgent,
} from '../../lib/studio-api';
import TaskCard from './TaskCard';

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
  idle: 'Beklemede',
  running: 'Calisiyor',
  paused: 'Duraklatildi',
  completed: 'Tamamlandi',
  failed: 'Hata',
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
          Asama {status.pipeline.currentStage + 1} / {status.pipeline.totalStages}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#111] border border-[#262626] rounded-xl p-5 w-[360px] shadow-2xl">
        {/* Baslik */}
        <div className="flex items-center gap-2 mb-3">
          <XCircle size={16} className="text-[#ef4444]" />
          <h2 className="text-[13px] font-semibold text-[#e5e5e5]">Task'ı Reddet</h2>
        </div>

        {/* Task adi */}
        <p className="text-[11px] text-[#737373] mb-3 leading-snug">
          <span className="text-[#a3a3a3] font-medium">"{taskTitle}"</span> task'ini reddetmek istiyorsunuz.
        </p>

        {/* Red sebebi */}
        <label className="block text-[11px] text-[#737373] mb-1.5">
          Red sebebi (isteğe bağlı)
        </label>
        <textarea
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Neden reddediyorsunuz?"
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
            Vazgec
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/20 rounded-lg transition-colors"
          >
            <XCircle size={12} />
            Reddet
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Onay bekleyen task kartı -----------------------------------------------

interface ApprovalTaskCardProps {
  task: Task;
  agents: ProjectAgent[];
  onApprove: () => Promise<void>;
  onReject: () => void;
}

function ApprovalTaskCard({ task, agents, onApprove, onReject }: ApprovalTaskCardProps) {
  const [approving, setApproving] = useState(false);

  const agent = agents.find(
    (a) => a.role.toLowerCase() === task.assignedAgent.toLowerCase()
      || a.name.toLowerCase() === task.assignedAgent.toLowerCase(),
  );

  const handleApprove = async () => {
    if (approving) return;
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="bg-[#111111] border-2 border-[#f59e0b]/40 rounded-lg p-3 hover:border-[#f59e0b]/70 transition-colors">
      {/* Awaiting Approval badge */}
      <div className="flex items-center gap-1.5 mb-2">
        <ShieldAlert size={12} className="text-[#f59e0b]" />
        <span className="text-[10px] font-semibold text-[#f59e0b] uppercase tracking-wide">
          Awaiting Approval
        </span>
        {task.complexity && (
          <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b]">
            {task.complexity}
          </span>
        )}
      </div>

      {/* Task baslik */}
      <p className="text-[12px] font-medium text-[#e5e5e5] mb-1.5 leading-snug">
        {task.title}
      </p>

      {/* Aciklama */}
      {task.description && (
        <p className="text-[11px] text-[#525252] mb-2 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Agent bilgisi */}
      {agent && (
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[10px] text-[#737373]">{roleLabel(agent.role)}</span>
          <span className="text-[10px] font-medium text-[#a3a3a3]">{agent.name}</span>
        </div>
      )}

      {/* Onay / Red butonları */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={approving}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 hover:border-[#22c55e]/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {approving ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Check size={11} />
          )}
          {approving ? 'Onaylaniyor...' : 'Onayla'}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={approving}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/20 hover:border-[#ef4444]/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X size={11} />
          Reddet
        </button>
      </div>
    </div>
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

  useEffect(() => {
    load();
    loadAutoStartStatus();

    const interval = setInterval(() => {
      load();
      loadAutoStartStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [projectId, load, loadAutoStartStatus]);

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

  // Task'ları status'e göre grupla
  const grouped = new Map<Task['status'], Task[]>();
  for (const col of COLUMNS) grouped.set(col.key, []);
  for (const task of tasks) {
    const list = grouped.get(task.status);
    if (list) list.push(task);
  }

  // Yalnizca task olan veya her zaman görünen sütunlari göster
  const activeColumns = COLUMNS.filter(
    (col) => (grouped.get(col.key)?.length ?? 0) > 0 || ['queued', 'running', 'done'].includes(col.key),
  );

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

      <ErrorToast toasts={toasts} onDismiss={dismissToast} />
      <div className="p-6 h-full overflow-x-auto flex flex-col">
        {/* Pipeline auto-start durum cubugu */}
        {autoStartStatus && <PipelineAutoStartBadge status={autoStartStatus} />}

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
                  {colTasks.map((task) =>
                    isApprovalCol ? (
                      // waiting_approval task'lari için özel kart — onay/red butonları ile
                      <ApprovalTaskCard
                        key={task.id}
                        task={task}
                        agents={agents}
                        onApprove={() => handleApprove(task.id)}
                        onReject={() => handleOpenReject(task)}
                      />
                    ) : (
                      <TaskCard
                        key={task.id}
                        task={task}
                        agents={agents}
                        onRetry={task.status === 'failed' ? () => handleRetry(task.id) : undefined}
                      />
                    ),
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
