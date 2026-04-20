import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Target,
  Shield,
  GitBranch,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  BarChart3,
  RefreshCw,
  Check,
  X,
} from 'lucide-react';
import {
  fetchAgenticMetrics,
  fetchProposals,
  fetchGoals,
  fetchGraphMutations,
  fetchCapabilityGrants,
  fetchAgentSessions,
  upsertCapabilityGrant,
  approveProposal,
  rejectProposal,
  type AgenticMetrics,
  type TaskProposal,
  type ExecutionGoal,
  type GraphMutation,
  type CapabilityGrant,
  type AgentSession,
} from '../../lib/studio-api';

interface Props {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------
function StatCard({ label, value, sub, color = '#22c55e' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-[#111111] rounded-lg border border-[#1f1f1f] p-3">
      <div className="text-[10px] text-[#525252] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[18px] font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-[#525252] mt-0.5">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({ title, icon, children, defaultOpen = true }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#1f1f1f] rounded-lg bg-[#0d0d0d] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-[#111111] transition-colors">
        {open ? <ChevronDown size={14} className="text-[#525252]" /> : <ChevronRight size={14} className="text-[#525252]" />}
        <span className="text-[#22c55e]">{icon}</span>
        <span className="text-[12px] font-semibold text-[#e5e5e5]">{title}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function AgenticPanel({ projectId }: Props) {
  const [metrics, setMetrics] = useState<AgenticMetrics | null>(null);
  const [proposals, setProposals] = useState<TaskProposal[]>([]);
  const [goals, setGoals] = useState<ExecutionGoal[]>([]);
  const [mutations, setMutations] = useState<GraphMutation[]>([]);
  const [grants, setGrants] = useState<CapabilityGrant[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [m, p, g, gm, cg, s] = await Promise.all([
        fetchAgenticMetrics(projectId).catch(() => null),
        fetchProposals(projectId).catch(() => []),
        fetchGoals(projectId).catch(() => []),
        fetchGraphMutations(projectId).catch(() => []),
        fetchCapabilityGrants(projectId).catch(() => []),
        fetchAgentSessions(projectId).catch(() => []),
      ]);
      if (m) setMetrics(m);
      setProposals(p);
      setGoals(g);
      setMutations(gm);
      setGrants(cg);
      setSessions(s);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleApprove = async (id: string) => {
    await approveProposal(id);
    refresh();
  };

  const handleReject = async (id: string) => {
    await rejectProposal(id, 'Rejected by user');
    refresh();
  };

  const handleToggleGrant = async (grant: CapabilityGrant) => {
    await upsertCapabilityGrant(projectId, grant.agentRole, grant.capability, !grant.granted);
    refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const activeGoals = goals.filter((g) => g.status === 'active' || g.status === 'pending');
  const activeSessions = sessions.filter((s) => s.status === 'active');

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[#fafafa]">Agentic Platform</h2>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Metrics Overview */}
      {metrics && (
        <Section title="Observability Metrics" icon={<BarChart3 size={14} />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="Claim Latency (avg)" value={`${metrics.taskClaimLatency.avgMs}ms`} sub={`p95: ${metrics.taskClaimLatency.p95Ms}ms`} />
            <StatCard label="Verification Failure" value={`${metrics.verificationFailureRate}%`} color={metrics.verificationFailureRate > 20 ? '#ef4444' : '#22c55e'} />
            <StatCard label="Avg Retries" value={metrics.avgRetriesBeforeCompletion} color={metrics.avgRetriesBeforeCompletion > 2 ? '#f59e0b' : '#22c55e'} />
            <StatCard label="Duplicate Dispatch" value={metrics.duplicateDispatchPrevented} sub="prevented" />
          </div>

          {/* Strategy Success Rates */}
          {metrics.strategySuccessRates.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] text-[#525252] uppercase tracking-wider mb-2">Strategy Success Rates</div>
              <div className="space-y-1">
                {metrics.strategySuccessRates.map((s) => (
                  <div key={`${s.strategy}-${s.taskType}`} className="flex items-center gap-2 text-[11px]">
                    <span className="text-[#a3a3a3] w-40 truncate">{s.strategy}</span>
                    <div className="flex-1 h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${s.successRate}%`, backgroundColor: s.successRate >= 70 ? '#22c55e' : s.successRate >= 40 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                    <span className="text-[#737373] w-12 text-right">{s.successRate}%</span>
                    <span className="text-[#525252] w-8 text-right">n={s.samples}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Injected Task Volume */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="Task Proposals" value={metrics.injectedTaskVolume.total} />
            <StatCard label="Auto-Approved" value={metrics.injectedTaskVolume.autoApproved} color="#22c55e" />
            <StatCard label="Pending" value={metrics.injectedTaskVolume.pending} color="#f59e0b" />
            <StatCard label="Rejected" value={metrics.injectedTaskVolume.rejected} color="#ef4444" />
          </div>

          {/* Graph Mutations & Replan */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Graph Mutations" value={metrics.graphMutationStats.total} sub={Object.entries(metrics.graphMutationStats.byType).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'} />
            <StatCard label="Replan Events" value={metrics.replanTriggerFrequency.total} sub={Object.entries(metrics.replanTriggerFrequency.byTrigger).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'} />
          </div>

          {/* Review Rejection by Role */}
          {metrics.reviewRejectionByRole.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] text-[#525252] uppercase tracking-wider mb-2">Review Rejection by Role</div>
              <div className="space-y-1">
                {metrics.reviewRejectionByRole.map((r) => (
                  <div key={r.agentRole} className="flex items-center gap-2 text-[11px]">
                    <span className="text-[#a3a3a3] w-28 truncate">{r.agentRole}</span>
                    <div className="flex-1 h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
                      <div className="h-full bg-[#ef4444] rounded-full" style={{ width: `${r.rate}%` }} />
                    </div>
                    <span className="text-[#737373] w-16 text-right">{r.rejections}/{r.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Proposals — show pending first */}
      <Section title={`Task Proposals${pendingProposals.length > 0 ? ` (${pendingProposals.length} pending)` : ''}`} icon={<Lightbulb size={14} />}>
        {proposals.length === 0 ? (
          <div className="text-[11px] text-[#525252]">No proposals yet</div>
        ) : (
          <div className="space-y-2">
            {proposals.slice(0, 20).map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#111111] border border-[#1a1a1a]">
                {p.status === 'pending' ? <Clock size={14} className="text-[#f59e0b] shrink-0" /> :
                 p.status === 'approved' ? <CheckCircle2 size={14} className="text-[#22c55e] shrink-0" /> :
                 <XCircle size={14} className="text-[#ef4444] shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-[#e5e5e5] truncate">{p.title}</div>
                  <div className="text-[10px] text-[#525252]">{p.proposalType} · {p.riskLevel} risk · by {p.originatingAgentId.slice(0, 8)}</div>
                </div>
                {p.status === 'pending' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleApprove(p.id)} className="p-1 rounded hover:bg-[#22c55e]/10 text-[#22c55e]" title="Approve"><Check size={14} /></button>
                    <button onClick={() => handleReject(p.id)} className="p-1 rounded hover:bg-[#ef4444]/10 text-[#ef4444]" title="Reject"><X size={14} /></button>
                  </div>
                )}
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                  p.status === 'pending' ? 'bg-[#f59e0b]/10 text-[#f59e0b]' :
                  p.status === 'approved' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
                  'bg-[#ef4444]/10 text-[#ef4444]'
                }`}>{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Goals */}
      <Section title={`Execution Goals${activeGoals.length > 0 ? ` (${activeGoals.length} active)` : ''}`} icon={<Target size={14} />}>
        {goals.length === 0 ? (
          <div className="text-[11px] text-[#525252]">No goals defined</div>
        ) : (
          <div className="space-y-2">
            {goals.slice(0, 15).map((g) => (
              <div key={g.id} className="px-3 py-2 rounded-lg bg-[#111111] border border-[#1a1a1a]">
                <div className="flex items-center gap-2">
                  {g.status === 'completed' ? <CheckCircle2 size={14} className="text-[#22c55e]" /> :
                   g.status === 'failed' ? <XCircle size={14} className="text-[#ef4444]" /> :
                   g.status === 'active' ? <Activity size={14} className="text-[#3b82f6]" /> :
                   <Clock size={14} className="text-[#525252]" />}
                  <span className="text-[11px] font-medium text-[#e5e5e5] flex-1 truncate">{g.definition?.goal ?? 'Unnamed goal'}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                    g.status === 'completed' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
                    g.status === 'failed' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
                    g.status === 'active' ? 'bg-[#3b82f6]/10 text-[#3b82f6]' :
                    'bg-[#525252]/10 text-[#525252]'
                  }`}>{g.status}</span>
                </div>
                {g.definition?.constraints?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {g.definition.constraints.map((c: string, i: number) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#737373]">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Graph Mutations */}
      <Section title={`Graph Mutations (${mutations.length})`} icon={<GitBranch size={14} />} defaultOpen={false}>
        {mutations.length === 0 ? (
          <div className="text-[11px] text-[#525252]">No graph mutations recorded</div>
        ) : (
          <div className="space-y-1">
            {mutations.slice(0, 20).map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#111111] text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#a3a3a3] font-mono text-[10px]">{m.mutationType}</span>
                <span className="text-[#525252] truncate flex-1">{m.reason ?? JSON.stringify(m.payload).slice(0, 80)}</span>
                <span className="text-[#525252] shrink-0 text-[10px]">{new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Agent Sessions */}
      <Section title={`Agent Sessions${activeSessions.length > 0 ? ` (${activeSessions.length} active)` : ''}`} icon={<Brain size={14} />} defaultOpen={false}>
        {sessions.length === 0 ? (
          <div className="text-[11px] text-[#525252]">No agent sessions recorded</div>
        ) : (
          <div className="space-y-1">
            {sessions.slice(0, 15).map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#111111] text-[11px]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'active' ? 'bg-[#22c55e]' : s.status === 'completed' ? 'bg-[#525252]' : 'bg-[#ef4444]'}`} />
                <span className="text-[#a3a3a3] truncate">{s.agentId?.slice(0, 12)}</span>
                <span className="text-[#525252] font-mono">{s.strategy ?? '—'}</span>
                <span className="text-[#525252] ml-auto">{s.stepsCompleted ?? 0} steps</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                  s.status === 'active' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
                  s.status === 'completed' ? 'bg-[#525252]/10 text-[#525252]' :
                  'bg-[#ef4444]/10 text-[#ef4444]'
                }`}>{s.status}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Capability Grants */}
      <Section title="Capability Grants" icon={<Shield size={14} />} defaultOpen={false}>
        {grants.length === 0 ? (
          <div className="text-[11px] text-[#525252]">No custom capability grants — using role defaults</div>
        ) : (
          <div className="space-y-1">
            {grants.map((g) => (
              <div key={g.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#111111] text-[11px]">
                <span className="text-[#a3a3a3] w-24 truncate">{g.agentRole}</span>
                <span className="font-mono text-[#737373] flex-1">{g.capability}</span>
                <button
                  onClick={() => handleToggleGrant(g)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    g.granted
                      ? 'bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20'
                      : 'bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20'
                  }`}
                >
                  {g.granted ? 'Granted' : 'Denied'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
