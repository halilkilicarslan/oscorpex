import { useState, useEffect } from 'react';
import { Loader2, Kanban } from 'lucide-react';
import { fetchTasks, retryTask, type Task } from '../../lib/studio-api';
import TaskCard from './TaskCard';

const COLUMNS: { key: Task['status']; label: string; color: string }[] = [
  { key: 'queued', label: 'Queued', color: 'border-[#525252]' },
  { key: 'assigned', label: 'Assigned', color: 'border-[#3b82f6]' },
  { key: 'running', label: 'Running', color: 'border-[#f59e0b]' },
  { key: 'review', label: 'Review', color: 'border-[#a855f7]' },
  { key: 'done', label: 'Done', color: 'border-[#22c55e]' },
  { key: 'failed', label: 'Failed', color: 'border-[#ef4444]' },
];

export default function KanbanBoard({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetchTasks(projectId)
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleRetry = async (taskId: string) => {
    try {
      await retryTask(projectId, taskId);
      load();
    } catch {
      // ignore
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
    <div className="p-6 h-full overflow-x-auto">
      <div className="flex gap-4 min-w-min h-full">
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
  );
}
