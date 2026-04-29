import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  AlertTriangle,
  Activity,
  Server,
  FileText,
  RefreshCw,
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
  escalateApproval,
  reopenIncident,
  resetProviderCooldown,
} from '../../lib/studio-api/control-plane';
import type {
  ApprovalWithSla,
  Incident,
  AgentInstance,
  ProviderRuntime,
  AuditEvent,
} from '../../types/control-plane';
import {
  type Tab,
  SummaryTab,
  ApprovalsTab,
  IncidentsTab,
  RegistryTab,
  AuditTab,
} from './control-plane/index.js';

export default function ControlPlanePage() {
  const [tab, setTab] = useState<Tab>('summary');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Summary state
  const [summary, setSummary] = useState<any>(null);

  // Approvals state
  const [approvals, setApprovals] = useState<ApprovalWithSla[]>([]);

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

  const handleEscalateApproval = async (id: string) => {
    await escalateApproval(id, 'senior-operator', 'operator');
    loadApprovals();
    loadSummary();
  };

  const handleReopenIncident = async (id: string) => {
    await reopenIncident(id, 'operator', 'reopened by operator');
    loadIncidents();
    loadSummary();
  };

  const handleResetCooldown = async (providerId: string) => {
    await resetProviderCooldown(providerId, 'operator', 'manual reset');
    loadRegistry();
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
            <SummaryTab
              summary={summary}
              approvals={approvals}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}

          {tab === 'approvals' && (
            <ApprovalsTab
              approvals={approvals}
              onApprove={handleApprove}
              onReject={handleReject}
              onEscalate={handleEscalateApproval}
            />
          )}

          {tab === 'incidents' && (
            <IncidentsTab
              incidents={incidents}
              onAck={handleAckIncident}
              onResolve={handleResolveIncident}
              onReopen={handleReopenIncident}
            />
          )}

          {tab === 'registry' && (
            <RegistryTab
              agents={agents}
              providers={providers}
              onResetCooldown={handleResetCooldown}
            />
          )}

          {tab === 'audit' && (
            <AuditTab auditEvents={auditEvents} />
          )}
        </div>
      )}
    </div>
  );
}
