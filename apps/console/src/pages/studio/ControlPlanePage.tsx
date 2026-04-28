import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Activity,
  Users,
  Server,
  DollarSign,
  FileText,
  RefreshCw,
  Zap,
} from 'lucide-react';
import {
  fetchControlPlaneSummary,
  fetchApprovals,
  approveRequest,
  rejectRequest,
  fetchIncidents,
  ackIncident,
  resolveIncident,
  fetchRegistryAgents,
  fetchRegistryProviders,
  fetchAuditEvents,
} from '../../lib/studio-api/control-plane';
import type {
  ApprovalRequest,
  Incident,
  AgentInstance,
  ProviderRuntime,
  AuditEvent,
} from '../../types/control-plane';

type Tab = 'summary' | 'approvals' | 'incidents' | 'registry' | 'audit';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30',
    approved: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
    rejected: 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30',
    expired: 'bg-[#525252]/10 text-[#525252] border-[#525252]/30',
    open: 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30',
    acknowledged: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30',
    resolved: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
    online: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
    offline: 'bg-[#525252]/10 text-[#525252] border-[#525252]/30',
    degraded: 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30',
    cooldown: 'bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/30',
    active: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30',
  };
  const cls = styles[status] ?? 'bg-[#525252]/10 text-[#525252] border-[#525252]/30';
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {status}
    </span>
  );
}

function StatCard({ label, value, icon, color = '#22c55e' }: { label: string; value: string | number; icon: React.ReactNode; color?: string }) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span style={{ color }}>{icon}</span>
        <span className="text-[11px] text-[#525252] uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-[22px] font-bold text-[#fafafa]">{value}</span>
    </div>
  );
}

export default function ControlPlanePage() {
  const [tab, setTab] = useState<Tab>('summary');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Summary state
  const [summary, setSummary] = useState<any>(null);

  // Approvals state
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);

  // Incidents state
  const [incidents, setIncidents] = useState<Incident[]>([]);

  // Registry state
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const [providers, setProviders] = useState<ProviderRuntime[]>([]);

  // Audit state
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const loadSummary = useCallback(async () => {
    const data = await fetchControlPlaneSummary();
    setSummary(data);
  }, []);

  const loadApprovals = useCallback(async () => {
    const data = await fetchApprovals();
    setApprovals(data.approvals);
  }, []);

  const loadIncidents = useCallback(async () => {
    const data = await fetchIncidents();
    setIncidents(data.incidents);
  }, []);

  const loadRegistry = useCallback(async () => {
    const [a, p] = await Promise.all([fetchRegistryAgents(), fetchRegistryProviders()]);
    setAgents(a.agents);
    setProviders(p.providers);
  }, []);

  const loadAudit = useCallback(async () => {
    const data = await fetchAuditEvents();
    setAuditEvents(data.events);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      await Promise.all([
        loadSummary(),
        loadApprovals(),
        loadIncidents(),
        loadRegistry(),
        loadAudit(),
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadSummary, loadApprovals, loadIncidents, loadRegistry, loadAudit]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (id: string) => {
    await approveRequest(id);
    loadApprovals();
    loadSummary();
  };

  const handleReject = async (id: string) => {
    await rejectRequest(id);
    loadApprovals();
    loadSummary();
  };

  const handleAckIncident = async (id: string) => {
    await ackIncident(id);
    loadIncidents();
    loadSummary();
  };

  const handleResolveIncident = async (id: string) => {
    await resolveIncident(id);
    loadIncidents();
    loadSummary();
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary', label: 'Summary', icon: <Activity size={14} /> },
    { key: 'approvals', label: 'Approvals', icon: <Shield size={14} /> },
    { key: 'incidents', label: 'Incidents', icon: <AlertTriangle size={14} /> },
    { key: 'registry', label: 'Registry', icon: <Server size={14} /> },
    { key: 'audit', label: 'Audit', icon: <FileText size={14} /> },
  ];

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#fafafa]">Control Plane</h2>
          <p className="text-[11px] text-[#525252] mt-0.5">Operator governance layer</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414] border border-[#262626] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#111111] border border-[#262626] rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              tab === t.key
                ? 'bg-[#1a1a1a] text-[#fafafa] shadow-sm'
                : 'text-[#525252] hover:text-[#a3a3a3]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <RefreshCw size={20} className="text-[#525252] animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tab === 'summary' && summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard label="Pending Approvals" value={summary.summary.pendingApprovals} icon={<Shield size={16} />} color="#f59e0b" />
                <StatCard label="Active Agents" value={summary.summary.activeAgents} icon={<Users size={16} />} color="#22c55e" />
                <StatCard label="Cooldown Providers" value={summary.summary.cooldownProviders} icon={<Zap size={16} />} color="#a855f7" />
                <StatCard label="Open Incidents" value={summary.summary.openIncidents} icon={<AlertTriangle size={16} />} color="#ef4444" />
                <StatCard label="Over Budget" value={summary.summary.projectsOverBudget} icon={<DollarSign size={16} />} color="#f97316" />
              </div>

              {summary.approvals.pendingCount > 0 && (
                <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
                  <h3 className="text-[12px] font-semibold text-[#fafafa] mb-3">Approval Queue</h3>
                  <div className="space-y-2">
                    {approvals.filter(a => a.status === 'pending').slice(0, 5).map(a => (
                      <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]">
                        <StatusBadge status={a.status} />
                        <span className="text-[12px] text-[#a3a3a3] flex-1">{a.title}</span>
                        <span className="text-[10px] text-[#525252]">{a.kind}</span>
                        <button onClick={() => handleApprove(a.id)} className="p-1 rounded hover:bg-[#22c55e]/10 text-[#22c55e]"><CheckCircle2 size={14} /></button>
                        <button onClick={() => handleReject(a.id)} className="p-1 rounded hover:bg-[#ef4444]/10 text-[#ef4444]"><XCircle size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summary.runtime.providerDetails.length > 0 && (
                <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
                  <h3 className="text-[12px] font-semibold text-[#fafafa] mb-3">Provider Health</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatCard label="Online" value={summary.runtime.onlineCount} icon={<Activity size={14} />} color="#22c55e" />
                    <StatCard label="Degraded" value={summary.runtime.degradedCount} icon={<AlertTriangle size={14} />} color="#f59e0b" />
                    <StatCard label="Cooldown" value={summary.runtime.cooldownCount} icon={<Clock size={14} />} color="#a855f7" />
                    <StatCard label="Offline" value={summary.runtime.offlineCount} icon={<XCircle size={14} />} color="#ef4444" />
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'approvals' && (
            <div className="space-y-2">
              {approvals.length === 0 ? (
                <div className="text-center py-12 text-[12px] text-[#525252]">No approval requests.</div>
              ) : (
                approvals.map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#111111] border border-[#262626]">
                    <StatusBadge status={a.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#fafafa]">{a.title}</p>
                      <p className="text-[10px] text-[#525252]">{a.kind} · by {a.requested_by} · {new Date(a.created_at).toLocaleString()}</p>
                    </div>
                    {a.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleApprove(a.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20">Approve</button>
                        <button onClick={() => handleReject(a.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20">Reject</button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'incidents' && (
            <div className="space-y-2">
              {incidents.length === 0 ? (
                <div className="text-center py-12 text-[12px] text-[#525252]">No incidents recorded.</div>
              ) : (
                incidents.map(i => (
                  <div key={i.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#111111] border border-[#262626]">
                    <StatusBadge status={i.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#fafafa]">{i.title}</p>
                      <p className="text-[10px] text-[#525252]">{i.type} · {i.severity} · {new Date(i.created_at).toLocaleString()}</p>
                    </div>
                    {i.status === 'open' && (
                      <button onClick={() => handleAckIncident(i.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#3b82f6]/10 text-[#3b82f6] hover:bg-[#3b82f6]/20">Ack</button>
                    )}
                    {(i.status === 'open' || i.status === 'acknowledged') && (
                      <button onClick={() => handleResolveIncident(i.id)} className="px-2 py-1 rounded text-[10px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20">Resolve</button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'registry' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-[12px] font-semibold text-[#fafafa] mb-2">Agents</h3>
                {agents.length === 0 ? (
                  <p className="text-[12px] text-[#525252]">No registered agents.</p>
                ) : (
                  <div className="space-y-1">
                    {agents.map(a => (
                      <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#111111] border border-[#262626]">
                        <StatusBadge status={a.status} />
                        <span className="text-[12px] text-[#a3a3a3] flex-1">{a.name}</span>
                        <span className="text-[10px] text-[#525252]">{a.role}</span>
                        {a.last_seen_at && (
                          <span className="text-[10px] text-[#525252]">{new Date(a.last_seen_at).toLocaleTimeString()}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-[12px] font-semibold text-[#fafafa] mb-2">Providers</h3>
                {providers.length === 0 ? (
                  <p className="text-[12px] text-[#525252]">No registered providers.</p>
                ) : (
                  <div className="space-y-1">
                    {providers.map(p => (
                      <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#111111] border border-[#262626]">
                        <StatusBadge status={p.status} />
                        <span className="text-[12px] text-[#a3a3a3] flex-1">{p.name}</span>
                        <span className="text-[10px] text-[#525252]">{p.type}</span>
                        {p.capabilities.length > 0 && (
                          <span className="text-[10px] text-[#525252]">{p.capabilities.length} caps</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-2">
              {auditEvents.length === 0 ? (
                <div className="text-center py-12 text-[12px] text-[#525252]">No audit events.</div>
              ) : (
                auditEvents.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-2 rounded-xl bg-[#111111] border border-[#262626]">
                    <StatusBadge status={e.severity} />
                    <span className="text-[10px] text-[#525252] uppercase w-20">{e.category}</span>
                    <span className="text-[12px] text-[#a3a3a3] flex-1">{e.action}</span>
                    <span className="text-[10px] text-[#525252]">{e.actor}</span>
                    <span className="text-[10px] text-[#525252]">{new Date(e.created_at).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
