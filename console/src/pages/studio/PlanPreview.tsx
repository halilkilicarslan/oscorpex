import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  ListChecks,
  GitBranch,
  DollarSign,
  Cpu,
  Users,
} from 'lucide-react';
import type { ProjectPlan, Phase, Task, PlanCostEstimate } from '../../lib/studio-api';
import { fetchPlanCostEstimate } from '../../lib/studio-api';

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
// Cost estimate helpers
// ---------------------------------------------------------------------------

function getCostColor(cost: number): string {
  if (cost < 0.5) return '#22c55e';
  if (cost < 1.0) return '#f59e0b';
  return '#ef4444';
}

function getCostBgColor(cost: number): string {
  if (cost < 0.5) return 'bg-[#22c55e]/10 border-[#22c55e]/20';
  if (cost < 1.0) return 'bg-[#f59e0b]/10 border-[#f59e0b]/20';
  return 'bg-[#ef4444]/10 border-[#ef4444]/20';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Per-phase cost breakdown (derived from plan + aggregate estimate)
// ---------------------------------------------------------------------------

interface PhaseCostRow {
  name: string;
  taskCount: number;
  tokens: number;
  cost: number;
}

function buildPhaseBreakdown(plan: ProjectPlan, estimate: PlanCostEstimate): PhaseCostRow[] {
  const tokensPerTask = estimate.avgTokensPerTask;
  const costPerTask = estimate.taskCount > 0 ? estimate.estimatedCost / estimate.taskCount : 0;

  return plan.phases
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((phase) => ({
      name: phase.name,
      taskCount: phase.tasks.length,
      tokens: phase.tasks.length * tokensPerTask,
      cost: phase.tasks.length * costPerTask,
    }));
}

// ---------------------------------------------------------------------------
// Per-agent cost breakdown (derived from plan + aggregate estimate)
// ---------------------------------------------------------------------------

interface AgentCostRow {
  agent: string;
  taskCount: number;
  tokens: number;
  cost: number;
}

function buildAgentBreakdown(plan: ProjectPlan, estimate: PlanCostEstimate): AgentCostRow[] {
  const tokensPerTask = estimate.avgTokensPerTask;
  const costPerTask = estimate.taskCount > 0 ? estimate.estimatedCost / estimate.taskCount : 0;

  const agentMap = new Map<string, { taskCount: number }>();
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      const key = task.assignedAgent || 'unassigned';
      const existing = agentMap.get(key) ?? { taskCount: 0 };
      agentMap.set(key, { taskCount: existing.taskCount + 1 });
    }
  }

  return Array.from(agentMap.entries())
    .map(([agent, { taskCount }]) => ({
      agent,
      taskCount,
      tokens: taskCount * tokensPerTask,
      cost: taskCount * costPerTask,
    }))
    .sort((a, b) => b.cost - a.cost);
}

// ---------------------------------------------------------------------------
// Cost estimate panel
// ---------------------------------------------------------------------------

function CostEstimatePanel({ plan, estimate }: { plan: ProjectPlan; estimate: PlanCostEstimate }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'phase' | 'agent'>('phase');

  const costColor = getCostColor(estimate.estimatedCost);
  const costBg = getCostBgColor(estimate.estimatedCost);
  const isHighCost = estimate.estimatedCost >= 1.0;

  const phaseRows = buildPhaseBreakdown(plan, estimate);
  const agentRows = buildAgentBreakdown(plan, estimate);

  return (
    <div className={`border rounded-xl overflow-hidden ${costBg}`}>
      {/* Summary row */}
      <button
        onClick={() => setShowBreakdown(!showBreakdown)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
      >
        <DollarSign size={14} style={{ color: costColor }} className="shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-semibold" style={{ color: costColor }}>
              ~${estimate.estimatedCost.toFixed(4)} {estimate.currency}
            </span>
            {isHighCost && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#ef4444]/20 text-[#ef4444]">
                HIGH COST
              </span>
            )}
          </div>
          <span className="text-[11px] text-[#525252]">
            {formatTokens(estimate.estimatedTokens)} tokens &middot; {estimate.taskCount} tasks &middot; {estimate.model}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-[#525252]">breakdown</span>
          {showBreakdown ? (
            <ChevronUp size={13} className="text-[#525252]" />
          ) : (
            <ChevronDown size={13} className="text-[#525252]" />
          )}
        </div>
      </button>

      {/* Token input/output mini-bar */}
      <div className="px-4 pb-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#525252]">Input</span>
          <span className="text-[10px] font-medium text-[#a3a3a3]">
            {formatTokens(estimate.breakdown.inputTokens)} tok
          </span>
          <span className="text-[10px] text-[#525252]">·</span>
          <span className="text-[10px] text-[#525252]">${estimate.breakdown.inputCost.toFixed(4)}</span>
        </div>
        <div className="w-px h-3 bg-[#262626]" />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#525252]">Output</span>
          <span className="text-[10px] font-medium text-[#a3a3a3]">
            {formatTokens(estimate.breakdown.outputTokens)} tok
          </span>
          <span className="text-[10px] text-[#525252]">·</span>
          <span className="text-[10px] text-[#525252]">${estimate.breakdown.outputCost.toFixed(4)}</span>
        </div>
      </div>

      {/* Collapsible breakdown */}
      {showBreakdown && (
        <div className="border-t border-[#262626]/50 bg-[#0a0a0a]/60">
          {/* Tab bar */}
          <div className="flex border-b border-[#262626]/50">
            <button
              onClick={() => setActiveTab('phase')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium transition-colors ${
                activeTab === 'phase'
                  ? 'text-[#e5e5e5] border-b-2 border-[#525252] -mb-px'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <GitBranch size={11} />
              By Phase
            </button>
            <button
              onClick={() => setActiveTab('agent')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-medium transition-colors ${
                activeTab === 'agent'
                  ? 'text-[#e5e5e5] border-b-2 border-[#525252] -mb-px'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <Users size={11} />
              By Agent
            </button>
          </div>

          {/* Phase breakdown table */}
          {activeTab === 'phase' && (
            <div className="p-3 flex flex-col gap-1.5">
              {phaseRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#141414] border border-[#1f1f1f]">
                  <span className="text-[10px] font-bold text-[#525252] shrink-0 w-14">
                    Phase {i + 1}
                  </span>
                  <span className="text-[11px] text-[#a3a3a3] flex-1 truncate">{row.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-[#525252]">{row.taskCount}t</span>
                    <span className="text-[10px] text-[#525252]">{formatTokens(row.tokens)} tok</span>
                    <span className="text-[10px] font-semibold" style={{ color: getCostColor(row.cost) }}>
                      ${row.cost.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Agent breakdown table */}
          {activeTab === 'agent' && (
            <div className="p-3 flex flex-col gap-1.5">
              {agentRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#141414] border border-[#1f1f1f]">
                  <Cpu size={11} className="text-[#525252] shrink-0" />
                  <span className="text-[11px] text-[#a3a3a3] flex-1 truncate capitalize">{row.agent}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-[#525252]">{row.taskCount}t</span>
                    <span className="text-[10px] text-[#525252]">{formatTokens(row.tokens)} tok</span>
                    <span className="text-[10px] font-semibold" style={{ color: getCostColor(row.cost) }}>
                      ${row.cost.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 pb-3">
            <p className="text-[10px] text-[#404040]">
              Estimates based on ~{formatTokens(estimate.avgTokensPerTask)} avg tokens/task using {estimate.model}.
              Actual costs may vary.
            </p>
          </div>
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
  projectId,
  onApprove,
  onReject,
}: {
  plan: ProjectPlan;
  projectId: string;
  onApprove: () => void;
  onReject: (feedback?: string) => void;
}) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [costEstimate, setCostEstimate] = useState<PlanCostEstimate | null>(null);
  const [costLoading, setCostLoading] = useState(false);

  const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
  const isDraft = plan.status === 'draft';

  // Fetch cost estimate when showing a draft plan
  useEffect(() => {
    if (!isDraft) {
      setCostEstimate(null);
      return;
    }

    let cancelled = false;
    setCostLoading(true);
    fetchPlanCostEstimate(projectId, plan.id)
      .then((estimate) => {
        if (!cancelled) setCostEstimate(estimate);
      })
      .catch(() => {
        // Non-critical — silently skip if the estimate fails
      })
      .finally(() => {
        if (!cancelled) setCostLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, plan.id, isDraft]);

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

      {/* Cost estimate — shown only for draft plans, above the action buttons */}
      {isDraft && (
        <div className="px-4 pb-4">
          {costLoading && (
            <div className="flex items-center gap-2 px-4 py-3 border border-[#262626] rounded-xl bg-[#0a0a0a]">
              <Loader2 size={12} className="text-[#525252] animate-spin shrink-0" />
              <span className="text-[11px] text-[#525252]">Calculating cost estimate...</span>
            </div>
          )}
          {!costLoading && costEstimate && (
            <CostEstimatePanel plan={plan} estimate={costEstimate} />
          )}
        </div>
      )}

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
