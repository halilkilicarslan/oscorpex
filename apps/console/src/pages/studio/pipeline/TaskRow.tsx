// ---------------------------------------------------------------------------
// Task Row
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { RotateCcw, ThumbsUp, ThumbsDown } from 'lucide-react';
import { approveTask, rejectTask, type Task } from '../../../lib/studio-api';
import { COMPLEXITY_COLORS, TASK_STATUS_ICONS, TASK_STATUS_BADGE, TASK_STATUS_LABEL } from './constants.js';

interface TaskRowProps {
  task: Task;
  isLast: boolean;
  retryingTaskId: string | null;
  onRetryTask: (taskId: string) => void;
  projectId: string;
  onRefresh: () => void;
  onClickTask: (task: Task) => void;
}

export default function TaskRow({
  task,
  isLast,
  retryingTaskId,
  onRetryTask,
  projectId,
  onRefresh,
  onClickTask,
}: TaskRowProps) {
  const [approving, setApproving] = useState(false);

  const handleApprove = async () => {
    setApproving(true);
    try {
      await approveTask(projectId, task.id);
      onRefresh();
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    setApproving(true);
    try {
      await rejectTask(projectId, task.id, 'Rejected via pipeline');
      onRefresh();
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 text-[11px] text-[#a3a3a3]">
        <span className="text-[#333] shrink-0 mt-0.5 font-mono">{isLast ? '└──' : '├──'}</span>
        <div className="flex items-start gap-1.5 flex-1 min-w-0">
          <div className="mt-0.5 shrink-0">{TASK_STATUS_ICONS[task.status]}</div>
          <span
            className="truncate flex-1 cursor-pointer hover:text-[#e5e5e5] transition-colors"
            onClick={() => onClickTask(task)}
          >
            {task.title}
          </span>
          {task.status === 'failed' && (
            <button
              onClick={() => onRetryTask(task.id)}
              disabled={retryingTaskId === task.id}
              className="flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-colors shrink-0 disabled:opacity-50"
              title="Retry task"
            >
              <RotateCcw size={9} className={retryingTaskId === task.id ? 'animate-spin' : ''} />
              Retry
            </button>
          )}
          {task.status === 'waiting_approval' && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleApprove}
                disabled={approving}
                className="flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
                title="Onayla"
              >
                <ThumbsUp size={9} />
                Onayla
              </button>
              <button
                onClick={handleReject}
                disabled={approving}
                className="flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors disabled:opacity-50"
                title="Reddet"
              >
                <ThumbsDown size={9} />
                Reddet
              </button>
            </div>
          )}
          <span
            className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${
              COMPLEXITY_COLORS[task.complexity] ?? ''
            }`}
          >
            {task.complexity}
          </span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 font-medium ${
              TASK_STATUS_BADGE[task.status] ?? 'bg-[#262626] text-[#525252]'
            }`}
          >
            {TASK_STATUS_LABEL[task.status] ?? task.status}
          </span>
        </div>
      </div>
      {task.status === 'failed' && task.error && (
        <div
          className="ml-14 mt-1 text-[10px] text-[#ef4444] bg-[#ef4444]/5 border border-[#ef4444]/20 rounded px-2 py-1 max-w-md truncate"
          title={task.error}
        >
          {task.error}
        </div>
      )}
    </div>
  );
}
