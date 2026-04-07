import { useState } from 'react';
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
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
  onRetry?: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const isFailed = task.status === 'failed';
  const hasError = isFailed && Boolean(task.error);

  return (
    <div className="bg-[#111111] border border-[#262626] rounded-lg p-3 hover:border-[#333] transition-colors group">
      {/* Baslik satiri */}
      <div className="flex items-start gap-2 mb-2">
        <div className="mt-0.5">{STATUS_ICON[task.status]}</div>
        <span className="text-[12px] font-medium text-[#e5e5e5] flex-1 leading-snug">
          {task.title}
        </span>
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${COMPLEXITY_COLORS[task.complexity] ?? ''}`}
        >
          {task.complexity}
        </span>
      </div>

      {/* Aciklama */}
      {task.description && (
        <p className="text-[11px] text-[#525252] mb-2 line-clamp-2 pl-5">
          {task.description}
        </p>
      )}

      {/* Alt bilgi satiri */}
      <div className="flex items-center justify-between pl-5">
        <span className="text-[10px] text-[#525252]">{task.assignedAgent}</span>

        <div className="flex items-center gap-2">
          {/* Retry count rozeti */}
          {isFailed && task.retryCount > 0 && (
            <span className="text-[9px] text-[#737373] bg-[#1a1a1a] border border-[#262626] px-1.5 py-0.5 rounded-full">
              {task.retryCount}x
            </span>
          )}

          {/* Hata detay toggle butonu */}
          {hasError && (
            <button
              type="button"
              onClick={() => setErrorExpanded((prev) => !prev)}
              className="flex items-center gap-1 text-[10px] text-[#737373] hover:text-[#a3a3a3] transition-colors"
              title={errorExpanded ? 'Hatayı gizle' : 'Hata detayını gör'}
            >
              <AlertCircle size={10} className="text-[#ef4444]" />
              {errorExpanded ? (
                <ChevronUp size={10} />
              ) : (
                <ChevronDown size={10} />
              )}
            </button>
          )}

          {/* Retry butonu */}
          {isFailed && onRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className={[
                'flex items-center gap-1 text-[10px] px-2 py-0.5 rounded',
                'border border-[#f59e0b]/30 bg-[#f59e0b]/5',
                'text-[#f59e0b] hover:bg-[#f59e0b]/10 hover:border-[#f59e0b]/50',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-all',
                retrying ? 'opacity-70' : 'opacity-0 group-hover:opacity-100',
              ].join(' ')}
              title="Bu gorevi yeniden calistir"
            >
              {retrying ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RefreshCw size={10} />
              )}
              {retrying ? 'Yeniden...' : 'Retry'}
            </button>
          )}
        </div>
      </div>

      {/* Hata detay bolumu (expandable) */}
      {hasError && errorExpanded && (
        <div className="mt-2 pt-2 border-t border-[#1f1f1f] pl-5">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={10} className="text-[#ef4444] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#ef4444]/80 leading-relaxed break-words whitespace-pre-wrap font-mono">
              {task.error}
            </p>
          </div>
        </div>
      )}

      {/* Test sonuclari */}
      {task.output?.testResults && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#1f1f1f] pl-5">
          <span className="text-[10px] text-[#22c55e]">
            {task.output.testResults.passed} passed
          </span>
          {task.output.testResults.failed > 0 && (
            <span className="text-[10px] text-[#ef4444]">
              {task.output.testResults.failed} failed
            </span>
          )}
        </div>
      )}
    </div>
  );
}
