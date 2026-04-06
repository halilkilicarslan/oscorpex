import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import type { Task } from '../../lib/studio-api';

const STATUS_ICON: Record<Task['status'], React.ReactNode> = {
  queued: <Clock size={12} className="text-[#525252]" />,
  assigned: <AlertCircle size={12} className="text-[#3b82f6]" />,
  running: <Loader2 size={12} className="text-[#f59e0b] animate-spin" />,
  review: <Eye size={12} className="text-[#a855f7]" />,
  done: <CheckCircle2 size={12} className="text-[#22c55e]" />,
  failed: <XCircle size={12} className="text-[#ef4444]" />,
};

const COMPLEXITY_COLORS: Record<string, string> = {
  S: 'bg-[#22c55e]/10 text-[#22c55e]',
  M: 'bg-[#f59e0b]/10 text-[#f59e0b]',
  L: 'bg-[#ef4444]/10 text-[#ef4444]',
};

export default function TaskCard({
  task,
  onRetry,
}: {
  task: Task;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-lg p-3 hover:border-[#333] transition-colors group">
      <div className="flex items-start gap-2 mb-2">
        <div className="mt-0.5">{STATUS_ICON[task.status]}</div>
        <span className="text-[12px] font-medium text-[#e5e5e5] flex-1 leading-snug">
          {task.title}
        </span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${COMPLEXITY_COLORS[task.complexity] ?? ''}`}>
          {task.complexity}
        </span>
      </div>

      {task.description && (
        <p className="text-[11px] text-[#525252] mb-2 line-clamp-2 pl-5">{task.description}</p>
      )}

      <div className="flex items-center justify-between pl-5">
        <span className="text-[10px] text-[#525252]">{task.assignedAgent}</span>
        {task.status === 'failed' && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 text-[10px] text-[#ef4444] hover:text-[#f87171] opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <RotateCcw size={10} />
            Retry
          </button>
        )}
      </div>

      {task.output?.testResults && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#1f1f1f] pl-5">
          <span className="text-[10px] text-[#22c55e]">{task.output.testResults.passed} passed</span>
          {task.output.testResults.failed > 0 && (
            <span className="text-[10px] text-[#ef4444]">{task.output.testResults.failed} failed</span>
          )}
        </div>
      )}
    </div>
  );
}
