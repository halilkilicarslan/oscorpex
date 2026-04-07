import { useState, useEffect, useCallback } from 'react';
import { Loader2, Kanban, Zap, AlertCircle, X } from 'lucide-react';
import {
  fetchTasks,
  retryTask,
  fetchAutoStartStatus,
  type Task,
  type AutoStartStatus,
} from '../../lib/studio-api';
import TaskCard from './TaskCard';

const COLUMNS: { key: Task['status']; label: string; color: string }[] = [
  { key: 'queued', label: 'Queued', color: 'border-[#525252]' },
  { key: 'assigned', label: 'Assigned', color: 'border-[#3b82f6]' },
  { key: 'running', label: 'Running', color: 'border-[#f59e0b]' },
  { key: 'review', label: 'Review', color: 'border-[#a855f7]' },
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
          className="flex items-start gap-2 bg-[#1a0a0a] border border-[#ef4444]/30 text-[#ef4444] text-[12px] px-3 py-2 rounded-lg shadow-lg pointer-events-auto max-w-[320px]"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="text-[#ef4444]/60 hover:text-[#ef4444] transition-colors ml-1"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- KanbanBoard ------------------------------------------------------------

export default function KanbanBoard({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoStartStatus, setAutoStartStatus] = useState<AutoStartStatus | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showErrorToast = useCallback((message: string) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message }]);
    // 5 saniye sonra otomatik kapat
    setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  const load = useCallback(() => {
    fetchTasks(projectId)
      .then(setTasks)
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
    // Optimistik guncelleme: task'i queued'a tasıyalım
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'queued' as const } : t,
      ),
    );
    try {
      await retryTask(projectId, taskId);
      // Basarili ise backend'den taze veri al
      load();
    } catch (err) {
      // Hata olursa optimistik guncellemeyi geri al
      load();
      const message =
        err instanceof Error
          ? `Retry basarisiz: ${err.message}`
          : 'Retry sirasinda beklenmeyen bir hata olustu.';
      showErrorToast(message);
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
          Tasks will appear here after you create and approve a project plan in the PM Chat.
        </p>
      </div>
    );
  }

  // Group tasks by status
  const grouped = new Map<Task['status'], Task[]>();
  for (const col of COLUMNS) grouped.set(col.key, []);
  for (const task of tasks) {
    const list = grouped.get(task.status);
    if (list) list.push(task);
  }

  // Only show columns that have tasks or are always-visible
  const activeColumns = COLUMNS.filter(
    (col) => (grouped.get(col.key)?.length ?? 0) > 0 || ['queued', 'running', 'done'].includes(col.key),
  );

  return (
    <>
    <ErrorToast toasts={toasts} onDismiss={dismissToast} />
    <div className="p-6 h-full overflow-x-auto flex flex-col">
      {/* Pipeline auto-start durum cubugu */}
      {autoStartStatus && <PipelineAutoStartBadge status={autoStartStatus} />}

      <div className="flex gap-4 min-w-min flex-1">
        {activeColumns.map((col) => {
          const colTasks = grouped.get(col.key) ?? [];
          return (
            <div
              key={col.key}
              className="w-[280px] shrink-0 flex flex-col"
            >
              {/* Column header */}
              <div className={`flex items-center gap-2 px-3 py-2 mb-3 border-t-2 ${col.color} rounded-t-sm`}>
                <span className="text-[12px] font-semibold text-[#a3a3a3] uppercase">{col.label}</span>
                <span className="text-[11px] text-[#525252] bg-[#1f1f1f] px-1.5 py-0.5 rounded-full">
                  {colTasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onRetry={task.status === 'failed' ? () => handleRetry(task.id) : undefined}
                  />

                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
