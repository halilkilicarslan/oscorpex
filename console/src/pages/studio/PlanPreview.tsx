import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  ListChecks,
  GitBranch,
} from 'lucide-react';
import type { ProjectPlan, Phase, Task } from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------

function TaskRow({ task }: { task: Task }) {
  const complexityColor: Record<string, string> = {
    S: 'text-[#22c55e] bg-[#22c55e]/10',
    M: 'text-[#f59e0b] bg-[#f59e0b]/10',
    L: 'text-[#ef4444] bg-[#ef4444]/10',
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
      <ListChecks size={14} className="text-[#525252] shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[12px] text-[#e5e5e5] block truncate">{task.title}</span>
        {task.description && (
          <span className="text-[11px] text-[#525252] block truncate">{task.description}</span>
        )}
      </div>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${complexityColor[task.complexity] ?? 'text-[#525252]'}`}>
        {task.complexity}
      </span>
      <span className="text-[10px] text-[#525252] shrink-0">{task.assignedAgent}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase section
// ---------------------------------------------------------------------------

function PhaseSection({ phase, index }: { phase: Phase; index: number }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-[#262626] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-[#111111] hover:bg-[#161616] transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-[#525252]" />
        ) : (
          <ChevronRight size={14} className="text-[#525252]" />
        )}
        <span className="text-[11px] font-bold text-[#525252] shrink-0">PHASE {index + 1}</span>
        <span className="text-[13px] font-medium text-[#e5e5e5] flex-1 truncate">{phase.name}</span>
        <span className="text-[11px] text-[#525252]">{phase.tasks.length} tasks</span>
      </button>

      {expanded && (
        <div className="p-3 flex flex-col gap-2 bg-[#0d0d0d]">
          {phase.tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {phase.dependsOn.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 pt-1">
              <GitBranch size={11} className="text-[#525252]" />
              <span className="text-[10px] text-[#525252]">
                Depends on: Phase {phase.dependsOn.map((_, i) => i + 1).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main preview
// ---------------------------------------------------------------------------

export default function PlanPreview({
  plan,
  onApprove,
  onReject,
}: {
  plan: ProjectPlan;
  onApprove: () => void;
  onReject: (feedback?: string) => void;
}) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
  const isDraft = plan.status === 'draft';

  const handleApprove = async () => {
    setLoading('approve');
    try {
      await onApprove();
    } finally {
      setLoading(null);
    }
  };

  const handleReject = async () => {
    setLoading('reject');
    try {
      await onReject(feedback || undefined);
    } finally {
      setLoading(null);
      setShowRejectInput(false);
      setFeedback('');
    }
  };

  return (
    <div className="border border-[#262626] rounded-2xl bg-[#111111] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#262626]">
        <div>
          <h3 className="text-[14px] font-semibold text-[#fafafa]">Project Plan v{plan.version}</h3>
          <span className="text-[11px] text-[#525252]">
            {plan.phases.length} phases · {totalTasks} tasks
          </span>
        </div>
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
            plan.status === 'approved'
              ? 'bg-[#22c55e]/10 text-[#22c55e]'
              : plan.status === 'rejected'
                ? 'bg-[#ef4444]/10 text-[#ef4444]'
                : 'bg-[#f59e0b]/10 text-[#f59e0b]'
          }`}
        >
          {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
        </span>
      </div>

      {/* Phases */}
      <div className="p-4 flex flex-col gap-3">
        {plan.phases
          .sort((a, b) => a.order - b.order)
          .map((phase, i) => (
            <PhaseSection key={phase.id} phase={phase} index={i} />
          ))}
      </div>

      {/* Actions */}
      {isDraft && (
        <div className="px-5 py-4 border-t border-[#262626] flex flex-col gap-3">
          {showRejectInput && (
            <div className="flex gap-2">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should be changed?"
                className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#ef4444] focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleReject}
                disabled={loading !== null}
                className="px-3 py-2 rounded-lg text-[12px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 disabled:opacity-50 transition-colors"
              >
                {loading === 'reject' ? <Loader2 size={14} className="animate-spin" /> : 'Send'}
              </button>
              <button
                onClick={() => { setShowRejectInput(false); setFeedback(''); }}
                className="px-3 py-2 rounded-lg text-[12px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {!showRejectInput && (
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={loading !== null}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium border border-[#262626] text-[#a3a3a3] hover:text-[#ef4444] hover:border-[#ef4444]/30 disabled:opacity-50 transition-colors"
              >
                <XCircle size={14} />
                Request Changes
              </button>
              <button
                onClick={handleApprove}
                disabled={loading !== null}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
              >
                {loading === 'approve' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                Approve Plan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
