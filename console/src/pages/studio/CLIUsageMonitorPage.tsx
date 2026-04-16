import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Cpu, Loader2, RefreshCw, Settings2, ShieldAlert, Terminal, XCircle } from 'lucide-react';
import {
  fetchCLIUsageProviders,
  fetchCLIProbeEvents,
  fetchCLIUsageHistory,
  refreshCLIUsageProviders,
  refreshCLIUsageProvider,
  updateCLIUsageSettings,
  type CLIProbeEvent,
  type CLIProviderId,
  type CLIUsageTrendPoint,
  type CLIUsageSnapshot,
  type QuotaStatus,
} from '../../lib/studio-api';

type Tab = 'global' | 'oscorpex' | 'attribution' | 'history' | 'settings';

const STATUS_STYLE: Record<QuotaStatus, string> = {
  healthy: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20',
  warning: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
  critical: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/20',
  depleted: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
  unknown: 'text-[#a3a3a3] bg-[#1f1f1f] border-[#262626]',
};

function fmtTokens(value: number): string {
  if (!value) return '0';
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function fmtMoney(value: number): string {
  return `$${(value || 0).toFixed(2)}`;
}

function worstStatus(providers: CLIUsageSnapshot[]): QuotaStatus {
  const order: QuotaStatus[] = ['healthy', 'warning', 'critical', 'depleted'];
  const quotas = providers.flatMap((provider) => provider.global?.quotas ?? []);
  if (quotas.length === 0) return 'unknown';
  return quotas.map((quota) => quota.status).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? 'unknown';
}

function statusIcon(status: QuotaStatus) {
  if (status === 'healthy') return <CheckCircle2 size={14} />;
  if (status === 'warning' || status === 'critical') return <AlertTriangle size={14} />;
  if (status === 'depleted') return <XCircle size={14} />;
  return <Activity size={14} />;
}

function QuotaBar({ quota }: { quota: NonNullable<CLIUsageSnapshot['global']>['quotas'][number] }) {
  const percent = quota.percentRemaining ?? 0;
  return (
    <div className="rounded-xl border border-[#262626] bg-[#0a0a0a] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[#fafafa]">{quota.label}</div>
          <div className="text-[10px] text-[#525252]">{quota.type}{quota.resetText ? ` · ${quota.resetText}` : ''}</div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[quota.status]}`}>
          {statusIcon(quota.status)}
          {quota.percentRemaining != null ? `${Math.round(quota.percentRemaining)}% left` : quota.dollarRemaining != null ? `$${quota.dollarRemaining.toFixed(2)}` : 'unknown'}
        </span>
      </div>
      {quota.percentRemaining != null && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#1f1f1f]">
          <div className="h-full rounded-full bg-[#22c55e]" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  selected,
  onSelect,
  onRefresh,
}: {
  provider: CLIUsageSnapshot;
  selected: boolean;
  onSelect: () => void;
  onRefresh: () => void;
}) {
  const quotaStatus = provider.global?.quotas?.[0]?.status ?? (provider.global ? 'unknown' : 'unknown');
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-2xl border p-4 transition-colors ${
        selected ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-[#262626] bg-[#111111] hover:border-[#333]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f1f1f] text-[#22c55e]">
            <Terminal size={18} />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#fafafa]">{provider.label}</div>
            <div className="text-[10px] text-[#525252]">{provider.version || 'version unknown'}</div>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${provider.installed ? 'border-[#22c55e]/20 text-[#22c55e]' : 'border-[#ef4444]/20 text-[#ef4444]'}`}>
          {provider.installed ? 'installed' : 'missing'}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">Auth</div>
          <div className="text-[#fafafa]">{provider.authStatus}</div>
        </div>
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">Quota</div>
          <div className={STATUS_STYLE[quotaStatus].split(' ')[0]}>{quotaStatus}</div>
        </div>
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">Today</div>
          <div className="text-[#fafafa]">{fmtTokens(provider.oscorpex.todayTokens)}</div>
        </div>
        <div className="rounded-lg bg-[#0a0a0a] p-2">
          <div className="text-[#525252]">Week cost</div>
          <div className="text-[#fafafa]">{fmtMoney(provider.oscorpex.weekCostUsd)}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="truncate text-[10px] text-[#525252]">{provider.binaryPath || 'binary path unavailable'}</div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRefresh();
          }}
          className="rounded-lg p-1 text-[#737373] hover:bg-[#1f1f1f] hover:text-[#fafafa]"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </button>
  );
}

export default function CLIUsageMonitorPage() {
  const [providers, setProviders] = useState<CLIUsageSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<CLIProviderId>('claude');
  const [activeTab, setActiveTab] = useState<Tab>('global');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [history, setHistory] = useState<CLIUsageTrendPoint[]>([]);
  const [events, setEvents] = useState<CLIProbeEvent[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [data, trendData, eventData] = await Promise.all([
        fetchCLIUsageProviders(),
        fetchCLIUsageHistory(undefined, 100).catch(() => []),
        fetchCLIProbeEvents(undefined, 80).catch(() => []),
      ]);
      setProviders(data);
      setHistory(trendData);
      setEvents(eventData);
      if (!data.some((provider) => provider.providerId === selectedId) && data[0]) {
        setSelectedId(data[0].providerId);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => providers.find((provider) => provider.providerId === selectedId) ?? providers[0],
    [providers, selectedId],
  );

  const installedCount = providers.filter((provider) => provider.installed).length;
  const connectedCount = providers.filter((provider) => provider.authStatus === 'connected').length;
  const todayCost = providers.reduce((sum, provider) => sum + provider.oscorpex.todayCostUsd, 0);
  const overallStatus = worstStatus(providers);

  const handleRefresh = async (providerId: CLIProviderId) => {
    setRefreshing(providerId);
    try {
      const updated = await refreshCLIUsageProvider(providerId);
      setProviders((prev) => prev.map((item) => (item.providerId === providerId ? updated : item)));
      const [trendData, eventData] = await Promise.all([
        fetchCLIUsageHistory(undefined, 100).catch(() => history),
        fetchCLIProbeEvents(undefined, 80).catch(() => events),
      ]);
      setHistory(trendData);
      setEvents(eventData);
    } finally {
      setRefreshing(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      const data = await refreshCLIUsageProviders();
      const [trendData, eventData] = await Promise.all([
        fetchCLIUsageHistory(undefined, 100).catch(() => history),
        fetchCLIProbeEvents(undefined, 80).catch(() => events),
      ]);
      setProviders(data);
      setHistory(trendData);
      setEvents(eventData);
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleSettings = async (providerId: CLIProviderId, patch: Partial<CLIUsageSnapshot['permissions']>) => {
    const permissions = await updateCLIUsageSettings(providerId, patch);
    setProviders((prev) => prev.map((item) => item.providerId === providerId ? { ...item, permissions } : item));
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#525252]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#0a0a0a] p-6 text-[#fafafa]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">CLI Usage Monitor</h1>
          <p className="mt-1 text-[13px] text-[#737373]">
            Global CLI quota durumunu ve Oscorpex token/cost tüketimini tek yerden izle.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefreshAll}
          disabled={refreshingAll}
          className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-[#a3a3a3] hover:border-[#333] hover:text-[#fafafa]"
        >
          {refreshingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh enabled probes
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Installed CLIs</div>
          <div className="mt-2 text-2xl font-bold">{installedCount}/{providers.length}</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Connected</div>
          <div className="mt-2 text-2xl font-bold">{connectedCount}</div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Worst quota</div>
          <div className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] ${STATUS_STYLE[overallStatus]}`}>
            {statusIcon(overallStatus)}
            {overallStatus}
          </div>
        </div>
        <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
          <div className="text-[10px] uppercase tracking-wider text-[#525252]">Oscorpex today</div>
          <div className="mt-2 text-2xl font-bold">{fmtMoney(todayCost)}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="grid gap-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.providerId}
              provider={provider}
              selected={selected?.providerId === provider.providerId}
              onSelect={() => setSelectedId(provider.providerId)}
              onRefresh={() => handleRefresh(provider.providerId)}
            />
          ))}
        </div>

        {selected && (
          <div className="rounded-3xl border border-[#262626] bg-[#111111]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] px-5 py-4">
              <div>
                <div className="text-[16px] font-semibold">{selected.label}</div>
                <div className="mt-1 text-[11px] text-[#525252]">
                  Last checked: {new Date(selected.lastCheckedAt).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRefresh(selected.providerId)}
                disabled={refreshing === selected.providerId}
                className="inline-flex items-center gap-2 rounded-xl bg-[#22c55e]/10 px-3 py-2 text-[12px] font-medium text-[#22c55e] hover:bg-[#22c55e]/20 disabled:opacity-40"
              >
                {refreshing === selected.providerId ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Refresh provider
              </button>
            </div>

            <div className="flex gap-1 border-b border-[#262626] px-4 py-2">
              {(['global', 'oscorpex', 'attribution', 'history', 'settings'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-3 py-2 text-[12px] font-medium capitalize transition-colors ${
                    activeTab === tab ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'text-[#737373] hover:text-[#fafafa]'
                  }`}
                >
                  {tab === 'oscorpex' ? 'Oscorpex Usage' : tab}
                </button>
              ))}
            </div>

            <div className="p-5">
              {activeTab === 'global' && (
                <div className="space-y-4">
                  {!selected.permissions.enabled && (
                    <div className="rounded-2xl border border-[#f59e0b]/20 bg-[#f59e0b]/10 p-4 text-[12px] text-[#f59e0b]">
                      Global quota probe kapalı. Settings tabından provider bazlı opt-in açılmalı.
                    </div>
                  )}
                  {selected.global?.quotas?.length ? (
                    <div className="grid gap-3">
                      {selected.global.quotas.map((quota, index) => (
                        <QuotaBar key={`${quota.type}-${quota.label}-${index}`} quota={quota} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-6 text-center text-[13px] text-[#737373]">
                      Global quota unavailable. {selected.errors[0] || 'No provider-reported quota data yet.'}
                    </div>
                  )}
                  {selected.global && (
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full border border-[#262626] px-2 py-1 text-[#a3a3a3]">source: {selected.global.source}</span>
                      <span className="rounded-full border border-[#262626] px-2 py-1 text-[#a3a3a3]">confidence: {selected.global.confidence}</span>
                      {selected.global.accountTier && <span className="rounded-full border border-[#262626] px-2 py-1 text-[#a3a3a3]">tier: {selected.global.accountTier}</span>}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'oscorpex' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
                      <div className="text-[10px] text-[#525252]">Today tokens</div>
                      <div className="mt-2 text-xl font-bold">{fmtTokens(selected.oscorpex.todayTokens)}</div>
                    </div>
                    <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
                      <div className="text-[10px] text-[#525252]">Week tokens</div>
                      <div className="mt-2 text-xl font-bold">{fmtTokens(selected.oscorpex.weekTokens)}</div>
                    </div>
                    <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
                      <div className="text-[10px] text-[#525252]">Week cost</div>
                      <div className="mt-2 text-xl font-bold">{fmtMoney(selected.oscorpex.weekCostUsd)}</div>
                    </div>
                    <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
                      <div className="text-[10px] text-[#525252]">Runs / failures</div>
                      <div className="mt-2 text-xl font-bold">{selected.oscorpex.runCount}/{selected.oscorpex.failureCount}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a]">
                    <div className="border-b border-[#262626] px-4 py-3 text-[12px] font-medium text-[#fafafa]">Project breakdown</div>
                    <div className="divide-y divide-[#1f1f1f]">
                      {selected.oscorpex.projectBreakdown.length === 0 && (
                        <div className="px-4 py-5 text-[12px] text-[#737373]">No Oscorpex usage for this CLI yet.</div>
                      )}
                      {selected.oscorpex.projectBreakdown.map((project) => (
                        <div key={project.projectId} className="flex items-center justify-between gap-3 px-4 py-3 text-[12px]">
                          <div className="min-w-0">
                            <div className="truncate text-[#fafafa]">{project.projectName}</div>
                            <div className="truncate text-[10px] text-[#525252]">{project.projectId}</div>
                          </div>
                          <div className="text-right text-[#a3a3a3]">{fmtTokens(project.tokens)} · {fmtMoney(project.costUsd)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'attribution' && (
                <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a] p-5">
                  {selected.attribution?.comparable ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Cpu size={18} className="text-[#22c55e]" />
                        <div className="text-[13px] text-[#fafafa]">Comparable global/local usage found.</div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-[#111111] p-4">
                          <div className="text-[10px] text-[#525252]">Oscorpex share</div>
                          <div className="mt-2 text-2xl font-bold text-[#22c55e]">{selected.attribution.oscorpexSharePercent}%</div>
                        </div>
                        <div className="rounded-xl bg-[#111111] p-4">
                          <div className="text-[10px] text-[#525252]">External / unknown</div>
                          <div className="mt-2 text-2xl font-bold text-[#a3a3a3]">{selected.attribution.externalSharePercent}%</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 text-[13px] text-[#737373]">
                      <ShieldAlert size={18} className="mt-0.5 text-[#f59e0b]" />
                      <div>{selected.attribution?.reason || 'Global quota and Oscorpex usage are not directly comparable for this provider yet.'}</div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a]">
                    <div className="border-b border-[#262626] px-4 py-3 text-[12px] font-medium text-[#fafafa]">Snapshot trend</div>
                    <div className="divide-y divide-[#1f1f1f]">
                      {history.filter((point) => point.providerId === selected.providerId).length === 0 && (
                        <div className="px-4 py-5 text-[12px] text-[#737373]">No persisted snapshots yet. Refresh this provider after enabling probes.</div>
                      )}
                      {history.filter((point) => point.providerId === selected.providerId).map((point) => (
                        <div key={`${point.providerId}-${point.capturedAt}`} className="flex items-center justify-between gap-3 px-4 py-3 text-[12px]">
                          <div>
                            <div className="text-[#fafafa]">{new Date(point.capturedAt).toLocaleString()}</div>
                            <div className="text-[10px] text-[#525252]">{point.source} · {point.confidence}</div>
                          </div>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[point.worstStatus]}`}>
                            {point.lowestPercentRemaining != null ? `${Math.round(point.lowestPercentRemaining)}% left` : point.worstStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#262626] bg-[#0a0a0a]">
                    <div className="border-b border-[#262626] px-4 py-3 text-[12px] font-medium text-[#fafafa]">Probe events</div>
                    <div className="divide-y divide-[#1f1f1f]">
                      {events.filter((event) => event.providerId === selected.providerId).length === 0 && (
                        <div className="px-4 py-5 text-[12px] text-[#737373]">No probe events yet.</div>
                      )}
                      {events.filter((event) => event.providerId === selected.providerId).map((event) => (
                        <div key={event.id} className="px-4 py-3 text-[12px]">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-[#fafafa]">{event.status}</span>
                            <span className="text-[10px] text-[#525252]">{new Date(event.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="mt-1 text-[#737373]">{event.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#f59e0b]/20 bg-[#f59e0b]/10 p-4 text-[12px] leading-6 text-[#f59e0b]">
                    Secret values are never stored or displayed. Network probes use provider APIs first when credentials are available; only derived usage metrics are saved.
                  </div>
                  {[
                    ['enabled', 'Enable global quota probe'],
                    ['allowAuthFileRead', 'Allow local auth/session file read'],
                    ['allowNetworkProbe', 'Allow network quota probe'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-4 rounded-2xl border border-[#262626] bg-[#0a0a0a] px-4 py-3">
                      <span className="flex items-center gap-2 text-[13px] text-[#fafafa]">
                        <Settings2 size={14} className="text-[#737373]" />
                        {label}
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean((selected.permissions as any)[key])}
                        onChange={(event) => handleSettings(selected.providerId, { [key]: event.target.checked } as any)}
                      />
                    </label>
                  ))}
                  <label className="block rounded-2xl border border-[#262626] bg-[#0a0a0a] px-4 py-3">
                    <span className="text-[13px] text-[#fafafa]">Refresh interval seconds</span>
                    <input
                      type="number"
                      min={60}
                      value={selected.permissions.refreshIntervalSec}
                      onChange={(event) => handleSettings(selected.providerId, { refreshIntervalSec: Number(event.target.value) || 300 })}
                      className="mt-2 w-full rounded-xl border border-[#262626] bg-[#080808] px-3 py-2 text-[13px] text-[#fafafa]"
                    />
                  </label>
                </div>
              )}

              {selected.errors.length > 0 && (
                <div className="mt-5 rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
                  <div className="mb-2 text-[12px] font-medium text-[#fafafa]">Probe notes</div>
                  <ul className="space-y-1 text-[11px] text-[#737373]">
                    {selected.errors.map((error, index) => <li key={`${error}-${index}`}>- {error}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
