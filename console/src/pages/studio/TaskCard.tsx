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
  RotateCcw,
  ShieldAlert,
  Check,
  X,
  Terminal,
} from 'lucide-react';
import { roleLabel, type Task, type ProjectAgent } from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

const STATUS_ICON: Record<Task['status'], React.ReactNode> = {
  queued: <Clock size={12} className="text-[#525252]" />,
  assigned: <AlertCircle size={12} className="text-[#3b82f6]" />,
  running: <Loader2 size={12} className="text-[#f59e0b] animate-spin" />,
  review: <Eye size={12} className="text-[#a855f7]" />,
  revision: <RotateCcw size={12} className="text-[#f97316]" />,
  // Human-in-the-Loop: Onay bekleyen task'lar için kalkan ikonu
  waiting_approval: <ShieldAlert size={12} className="text-[#f59e0b]" />,
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
  agents = [],
  onRetry,
  onApprove,
  onReject,
  onTerminal,
}: {
  task: Task;
  agents?: ProjectAgent[];
  onRetry?: () => Promise<void>;
  onApprove?: () => Promise<void>;
  onReject?: () => void;
  onTerminal?: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [approving, setApproving] = useState(false);
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

  const handleApprove = async () => {
    if (!onApprove || approving) return;
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };

  const isFailed = task.status === 'failed';
  const isAwaitingApproval = task.status === 'waiting_approval';
  const hasError = isFailed && Boolean(task.error);

  return (
    <div
      className={[
        'bg-[#111111] border rounded-lg p-3 hover:border-[#333] transition-colors group',
        isAwaitingApproval
          ? 'border-[#f59e0b]/40 hover:border-[#f59e0b]/70'
          : 'border-[#262626]',
      ].join(' ')}
    >
      {/* Awaiting Approval badge — sadece waiting_approval durumunda */}
      {isAwaitingApproval && (
        <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-[#f59e0b]/15">
          <ShieldAlert size={11} className="text-[#f59e0b]" />
          <span className="text-[9px] font-semibold text-[#f59e0b] uppercase tracking-wide">
            Awaiting Approval
          </span>
        </div>
      )}

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

      {/* Alt bilgi satiri — atanan agent */}
      <div className="flex items-center justify-between pl-5">
        {(() => {
          const assigned = task.assignedAgent;
          const aLower = assigned.toLowerCase();
          const agent = agents.find(
            (a) => a.id === assigned
              || a.role.toLowerCase() === aLower
              || a.name.toLowerCase() === aLower
              || a.role.toLowerCase().startsWith(aLower + '-')
              || a.role.toLowerCase().endsWith('-' + aLower),
          );
          return agent ? (
            <div className="flex items-center gap-1.5">
              <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="xs" />
              <span className="text-[10px] text-[#a3a3a3] font-medium">{agent.name}</span>
              <span className="text-[9px] text-[#525252]">{roleLabel(agent.role)}</span>
            </div>
          ) : (
            <span className="text-[10px] text-[#525252]">{roleLabel(task.assignedAgent)}</span>
          );
        })()}

        <div className="flex items-center gap-2">
          {/* Terminal butonu — running, done, failed task'larda */}
          {onTerminal && ['running', 'done', 'failed'].includes(task.status) && (
            <button
              type="button"
              onClick={onTerminal}
              className={[
                'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
                'border border-[#22c55e]/30 bg-[#22c55e]/5',
                'text-[#22c55e] hover:bg-[#22c55e]/10 hover:border-[#22c55e]/50',
                'transition-all',
                task.status === 'running' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              ].join(' ')}
              title="Terminal ciktisini gor"
            >
              <Terminal size={10} />
              {task.status === 'running' && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              )}
            </button>
          )}

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

      {/* Onay / Red butonlari — waiting_approval durumunda ve handler varsa */}
      {isAwaitingApproval && (onApprove || onReject) && (
        <div className="flex gap-2 mt-3 pt-2 border-t border-[#f59e0b]/10">
          {onApprove && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={approving}
              className="flex-1 flex items-center justify-center gap-1.5 py-1 text-[10px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 hover:border-[#22c55e]/50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {approving ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Check size={10} />
              )}
              {approving ? 'Onaylaniyor...' : 'Onayla'}
            </button>
          )}
          {onReject && (
            <button
              type="button"
              onClick={onReject}
              disabled={approving}
              className="flex-1 flex items-center justify-center gap-1.5 py-1 text-[10px] font-medium bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/20 hover:border-[#ef4444]/50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X size={10} />
              Reddet
            </button>
          )}
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
