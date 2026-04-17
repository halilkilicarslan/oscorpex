// ---------------------------------------------------------------------------
// Oscorpex — Agent Dashboard (Metrikler ve Analizler)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  Clock,
  Zap,
  GitBranch,
  TrendingUp,
  Activity,
  DollarSign,
  FileText,
  Shield,
  Container,
} from 'lucide-react';
import {
  fetchProjectAnalytics,
  fetchAgentAnalytics,
  fetchActivityTimeline,
  fetchProjectCosts,
  fetchCostBreakdown,
  fetchDocsFreshness,
  fetchSonarStatus,
  fetchLatestSonarScan,
  triggerSonarScan,
  fetchPoolStatus,
  type ProjectAnalytics,
  type AgentAnalytics,
  type ActivityTimeline,
  type ProjectCostSummary,
  type CostBreakdownEntry,
  type DocFreshnessItem,
  type SonarLatestScan,
  type PoolStatus,
  roleLabel,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';
import { AgentHeatMap } from './AgentHeatMap';

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

/** Milisaniyeyi okunabilir süreye çevirir */
function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}dk`;
  return `${(ms / 3600000).toFixed(1)}sa`;
}


function formatTokenCount(count: number): string {
  if (!count) return '-';
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Tamamlanma oranına göre renk sınıfı */
function rateColor(rate: number): string {
  if (rate >= 80) return 'text-[#22c55e]';
  if (rate >= 50) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

// ---------------------------------------------------------------------------
// Özet Kart bileşeni
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}

function StatCard({ label, value, sub, icon, accent = '#22c55e' }: StatCardProps) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#737373] uppercase tracking-wider">{label}</span>
        <span style={{ color: accent }} className="opacity-70">
          {icon}
        </span>
      </div>
      <div>
        <span className="text-[26px] font-bold text-[#fafafa] leading-none">{value}</span>
        {sub && <span className="ml-2 text-[11px] text-[#525252]">{sub}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar Chart (CSS tabanlı)
// ---------------------------------------------------------------------------

interface BarChartItem {
  label: string;
  value: number;
  color: string;
  avatar?: string;
  role?: string;
}

interface BarChartProps {
  items: BarChartItem[];
  maxValue: number;
}

function BarChart({ items, maxValue }: BarChartProps) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[#525252] text-[12px]">
        Henuz veri yok
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const pct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        return (
          <div key={item.label} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-36 shrink-0">
              <AgentAvatarImg avatar={item.avatar ?? ''} name={item.label} size="xs" />
              <div className="min-w-0">
                <p className="text-[11px] text-[#a3a3a3] font-medium truncate">{item.label}</p>
                {item.role && (
                  <p className="text-[9px] text-[#525252] truncate">{roleLabel(item.role)}</p>
                )}
              </div>
            </div>
            <div className="flex-1 bg-[#1a1a1a] rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: item.color }}
              />
            </div>
            <span className="text-[11px] text-[#a3a3a3] w-6 text-right shrink-0">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Chart (son 7 gün)
// ---------------------------------------------------------------------------

interface TimelineChartProps {
  data: ActivityTimeline[];
}

function TimelineChart({ data }: TimelineChartProps) {
  const maxVal = Math.max(1, ...data.map((d) => d.tasksCompleted + d.runsStarted));

  return (
    <div className="flex items-end gap-1 h-20">
      {data.map((d) => {
        const total = d.tasksCompleted + d.runsStarted;
        const pct = (total / maxVal) * 100;
        const shortDate = d.date.slice(5); // MM-DD
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col items-center justify-end h-14">
              {total > 0 && (
                <div
                  className="w-full rounded-t-sm transition-all duration-500"
                  style={{
                    height: `${Math.max(pct, 4)}%`,
                    background: 'linear-gradient(to top, #22c55e88, #22c55e33)',
                    border: '1px solid #22c55e44',
                  }}
                  title={`${d.date}: ${d.tasksCompleted} gorev, ${d.runsStarted} calistirma`}
                />
              )}
              {total === 0 && (
                <div className="w-full h-[2px] bg-[#1a1a1a] rounded" />
              )}
            </div>
            <span className="text-[9px] text-[#525252] leading-none">{shortDate}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ajan performans satırı
// ---------------------------------------------------------------------------

interface AgentRowProps {
  agent: AgentAnalytics;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

function AgentRow({ agent }: AgentRowProps) {
  const successRate =
    agent.tasksAssigned > 0
      ? Math.round((agent.tasksCompleted / agent.tasksAssigned) * 100)
      : 0;

  const sc = agent.score ?? 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a1a] last:border-0 hover:bg-[#0f0f0f] transition-colors">
      {/* Avatar + ajan adı + rol + skor */}
      <div className="flex items-center gap-2.5 w-44 shrink-0">
        <div className="relative">
          <AgentAvatarImg avatar={agent.avatar} name={agent.agentName} size="sm" />
          {agent.tasksAssigned > 0 && (
            <span
              className="absolute -bottom-1 -right-1 text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center text-black"
              style={{ backgroundColor: scoreColor(sc) }}
              title={`Skor: ${sc}/100`}
            >
              {sc}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-[#fafafa] truncate">{agent.agentName}</p>
          <p className="text-[10px] text-[#525252] truncate">{roleLabel(agent.role)}</p>
        </div>
      </div>

      {/* Atanan / Tamamlanan */}
      <div className="flex gap-3 text-center flex-wrap">
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#fafafa]">{agent.tasksAssigned}</p>
          <p className="text-[9px] text-[#525252]">Atanan</p>
        </div>
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#22c55e]">{agent.tasksCompleted}</p>
          <p className="text-[9px] text-[#525252]">Biten</p>
        </div>
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#ef4444]">{agent.totalFailures ?? agent.tasksFailed}</p>
          <p className="text-[9px] text-[#525252]">Hata</p>
        </div>
        <div className="w-12">
          <p className="text-[13px] font-semibold text-[#f97316]">{agent.totalReviewRejections ?? 0}</p>
          <p className="text-[9px] text-[#525252]">Red</p>
        </div>
      </div>

      {/* Basari orani bar */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-[11px] font-semibold ${rateColor(successRate)}`}>
            %{successRate}
          </span>
        </div>
        <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className="h-1.5 rounded-full transition-all duration-500"
            style={{
              width: `${successRate}%`,
              backgroundColor: successRate >= 80 ? '#22c55e' : successRate >= 50 ? '#f59e0b' : '#ef4444',
            }}
          />
        </div>
      </div>

      {/* Calistirma sayisi */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#a3a3a3]">{agent.runCount}</p>
        <p className="text-[9px] text-[#525252]">Run</p>
      </div>

      {/* Toplam sure */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#a3a3a3]">{formatDuration(agent.totalRuntimeMs)}</p>
        <p className="text-[9px] text-[#525252]">Sure</p>
      </div>

      {/* Token */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#38bdf8]">{formatTokenCount(agent.totalTokens)}</p>
        <p className="text-[9px] text-[#525252]">Token</p>
      </div>

      {/* Maliyet */}
      <div className="w-16 text-center shrink-0">
        <p className="text-[12px] font-medium text-[#a78bfa]">${(agent.costUsd ?? 0).toFixed(2)}</p>
        <p className="text-[9px] text-[#525252]">Cost</p>
      </div>

      {/* Mesaj sayilari */}
      <div className="w-20 text-center shrink-0">
        <p className="text-[11px] text-[#a3a3a3]">
          <span className="text-[#22c55e]">{agent.messagesSent}</span>
          {' / '}
          <span className="text-[#3b82f6]">{agent.messagesReceived}</span>
        </p>
        <p className="text-[9px] text-[#525252]">Gonder/Al</p>
      </div>

      {/* Durum */}
      <div className="w-16 flex justify-center shrink-0">
        {agent.isRunning ? (
          <span className="flex items-center gap-1 text-[10px] text-[#22c55e] bg-[#22c55e11] border border-[#22c55e33] px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            Aktif
          </span>
        ) : (
          <span className="text-[10px] text-[#525252] bg-[#1a1a1a] border border-[#262626] px-2 py-0.5 rounded-full">
            Bekliyor
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ana bileşen
// ---------------------------------------------------------------------------

interface Props {
  projectId: string;
}

export default function AgentDashboard({ projectId }: Props) {
  const [overview, setOverview] = useState<ProjectAnalytics | null>(null);
  const [agents, setAgents] = useState<AgentAnalytics[]>([]);
  const [timeline, setTimeline] = useState<ActivityTimeline[]>([]);
  const [costs, setCosts] = useState<ProjectCostSummary | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdownEntry[]>([]);
  const [docsFreshness, setDocsFreshness] = useState<DocFreshnessItem[]>([]);
  const [sonarEnabled, setSonarEnabled] = useState(false);
  const [sonarScan, setSonarScan] = useState<SonarLatestScan | null>(null);
  const [sonarScanning, setSonarScanning] = useState(false);
  const [poolStatus, setPoolStatus] = useState<PoolStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [ov, ag, tl, cs, cb, df, ss, sl, ps] = await Promise.all([
        fetchProjectAnalytics(projectId),
        fetchAgentAnalytics(projectId),
        fetchActivityTimeline(projectId, 7),
        fetchProjectCosts(projectId),
        fetchCostBreakdown(projectId),
        fetchDocsFreshness(projectId).catch(() => [] as DocFreshnessItem[]),
        fetchSonarStatus(projectId).catch(() => ({ enabled: false })),
        fetchLatestSonarScan(projectId).catch(() => null as SonarLatestScan | null),
        fetchPoolStatus().catch(() => null as PoolStatus | null),
      ]);
      setOverview(ov);
      setAgents(ag);
      setTimeline(tl);
      setCosts(cs);
      setCostBreakdown(cb);
      setDocsFreshness(df);
      setSonarEnabled(ss.enabled);
      setSonarScan(sl);
      setPoolStatus(ps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Veri yuklenemedi');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    // 30 saniyede bir otomatik yenile
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-[13px] text-[#ef4444]">{error}</p>
        <button
          onClick={() => load()}
          className="text-[12px] text-[#525252] hover:text-[#a3a3a3] underline transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Bar chart icin ajan gorev verileri
  const barItems = (overview?.tasksPerAgent ?? []).map((a) => {
    const ag = agents.find((ag) => ag.agentId === a.agentId);
    return {
      label: a.agentName,
      value: a.total,
      color: ag?.color ?? '#22c55e',
      avatar: ag?.avatar,
      role: ag?.role,
    };
  });
  const maxBarVal = Math.max(1, ...barItems.map((b) => b.value));

  const completionRate =
    (overview?.totalTasks ?? 0) > 0
      ? Math.round(((overview?.completedTasks ?? 0) / (overview?.totalTasks ?? 1)) * 100)
      : 0;

  const activeAgents = agents.filter((a) => a.isRunning).length;

  return (
    <div className="flex flex-col gap-5 p-5">
      {/* Baslik ve yenile butonu */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#fafafa]">Project Dashboard</h2>
          <p className="text-[11px] text-[#525252] mt-0.5">Agent performance and project metrics</p>
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

      {/* Ozet kartlar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Total Tasks"
          value={overview?.totalTasks ?? 0}
          sub={`${overview?.inProgressTasks ?? 0} in progress`}
          icon={<Activity size={16} />}
          accent="#22c55e"
        />
        <StatCard
          label="Completion Rate"
          value={`${completionRate}%`}
          sub={`${overview?.completedTasks ?? 0} / ${overview?.totalTasks ?? 0}`}
          icon={<TrendingUp size={16} />}
          accent="#3b82f6"
        />
        <StatCard
          label="Active Agents"
          value={activeAgents}
          sub={`${agents.length} total`}
          icon={<Zap size={16} />}
          accent="#f59e0b"
        />
        <StatCard
          label="Pipeline Runs"
          value={overview?.pipelineRunCount ?? 0}
          sub={overview?.pipelineRunCount
            ? `${overview.pipelineSuccessRate}% success`
            : undefined}
          icon={<GitBranch size={16} />}
          accent="#a855f7"
        />
        <StatCard
          label="Total Cost"
          value={costs?.totalCostUsd != null ? `$${costs.totalCostUsd.toFixed(4)}` : '$0'}
          sub={costs?.totalTokens ? `${(costs.totalTokens / 1000).toFixed(1)}K token` : undefined}
          icon={<DollarSign size={16} />}
          accent="#10b981"
        />
      </div>

      {/* Orta satir: Bar chart + Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ajan basi gorev dagilimi */}
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={14} className="text-[#22c55e]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Tasks Per Agent</h3>
          </div>
          <BarChart items={barItems} maxValue={maxBarVal} />
        </div>

        {/* Son 7 gun aktivite */}
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-[#3b82f6]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Last 7 Days Activity</h3>
          </div>
          <TimelineChart data={timeline} />
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
              <span className="text-[10px] text-[#525252]">Completed tasks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
              <span className="text-[10px] text-[#525252]">Agent runs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ortalama tamamlanma suresi + pipeline bilgisi */}
      {(overview?.avgCompletionTimeMs !== null || (overview?.pipelineRunCount ?? 0) > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] text-[#525252] uppercase tracking-wider">Avg Completion</span>
            <span className="text-[18px] font-bold text-[#fafafa]">
              {formatDuration(overview?.avgCompletionTimeMs ?? null)}
            </span>
            <span className="text-[10px] text-[#525252]">Per task</span>
          </div>
          <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] text-[#525252] uppercase tracking-wider">Total Failures</span>
            <span className="text-[18px] font-bold text-[#ef4444]">
              {overview?.totalFailures ?? 0}
            </span>
            <span className="text-[10px] text-[#525252]">Including retries</span>
          </div>
          <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] text-[#525252] uppercase tracking-wider">Blocked Tasks</span>
            <span className="text-[18px] font-bold text-[#ef4444]">
              {overview?.blockedTasks ?? 0}
            </span>
            <span className="text-[10px] text-[#525252]">Needs attention</span>
          </div>
          <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] text-[#525252] uppercase tracking-wider">Review Rejects</span>
            <span className="text-[18px] font-bold text-[#f97316]">
              {overview?.totalReviewRejections ?? 0}
            </span>
            <span className="text-[10px] text-[#525252]">Code rejected</span>
          </div>
          <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] text-[#525252] uppercase tracking-wider">Pipeline Success</span>
            <span className="text-[18px] font-bold text-[#a855f7]">
              {overview?.pipelineSuccessRate ?? 0}%
            </span>
            <span className="text-[10px] text-[#525252]">{overview?.pipelineRunCount ?? 0} runs</span>
          </div>
          <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] text-[#525252] uppercase tracking-wider">In Progress</span>
            <span className="text-[18px] font-bold text-[#f59e0b]">
              {overview?.inProgressTasks ?? 0}
            </span>
            <span className="text-[10px] text-[#525252]">Tasks running</span>
          </div>
          {agents.length > 0 && (() => {
            const scored = agents.filter(a => a.tasksAssigned > 0);
            const avgScore = scored.length > 0
              ? Math.round(scored.reduce((s, a) => s + (a.score ?? 0), 0) / scored.length)
              : 0;
            return (
              <div className="bg-[#111111] border border-[#262626] rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] text-[#525252] uppercase tracking-wider">Team Score</span>
                <span className="text-[18px] font-bold" style={{ color: scoreColor(avgScore) }}>
                  {avgScore}
                </span>
                <span className="text-[10px] text-[#525252]">{scored.length} agents avg</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Maliyet Breakdown Tablosu */}
      {costBreakdown.length > 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <DollarSign size={14} className="text-[#10b981]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Cost Breakdown</h3>
            <span className="ml-auto text-[10px] text-[#525252]">
              Total: ${costs?.totalCostUsd?.toFixed(4) ?? '0'}
            </span>
          </div>
          <div className="flex items-center gap-3 px-4 py-2 bg-[#0d0d0d]">
            <span className="text-[10px] text-[#525252] uppercase tracking-wider w-48 shrink-0">Agent</span>
            <span className="text-[10px] text-[#525252] uppercase tracking-wider w-28 shrink-0">Model</span>
            <span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Tasks</span>
            <span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Input</span>
            <span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Output</span>
            <span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Total</span>
            <span className="text-[10px] text-[#525252] uppercase tracking-wider w-20 text-right">Cost</span>
          </div>
          {costBreakdown.map((entry, i) => (
            <div
              key={`${entry.agentId}-${entry.model}-${i}`}
              className="flex items-center gap-3 px-4 py-2.5 border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors"
            >
              <div className="flex items-center gap-2 w-48 shrink-0">
                <AgentAvatarImg avatar={entry.agentAvatar ?? ''} name={entry.agentName ?? '?'} size="xs" />
                <div className="min-w-0">
                  <p className="text-[11px] text-[#a3a3a3] font-medium truncate">
                    {entry.agentName ?? entry.agentId.slice(0, 8)}
                  </p>
                  {entry.agentRole && (
                    <p className="text-[9px] text-[#525252] truncate">{roleLabel(entry.agentRole)}</p>
                  )}
                </div>
              </div>
              <span className="text-[11px] text-[#525252] w-28 truncate shrink-0 font-mono">{entry.model}</span>
              <span className="text-[11px] text-[#a3a3a3] w-14 text-center">{entry.taskCount}</span>
              <span className="text-[11px] text-[#525252] w-20 text-right font-mono">
                {(entry.inputTokens / 1000).toFixed(1)}K
              </span>
              <span className="text-[11px] text-[#525252] w-20 text-right font-mono">
                {(entry.outputTokens / 1000).toFixed(1)}K
              </span>
              <span className="text-[11px] text-[#a3a3a3] w-20 text-right font-mono">
                {(entry.totalTokens / 1000).toFixed(1)}K
              </span>
              <span className="text-[11px] text-[#10b981] w-20 text-right font-mono font-semibold">
                ${entry.costUsd.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Docs freshness */}
      {docsFreshness.length > 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <FileText size={14} className="text-[#60a5fa]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Dokumantasyon Durumu</h3>
            <span className="ml-auto text-[10px] text-[#525252]">
              {docsFreshness.filter((d) => d.status === 'filled').length}/{docsFreshness.length} dolu
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
            {docsFreshness.map((doc) => (
              <div
                key={doc.file}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                  doc.status === 'filled'
                    ? 'border-[#166534] bg-[#052e16]/40'
                    : doc.status === 'tbd'
                      ? 'border-[#854d0e] bg-[#422006]/40'
                      : 'border-[#7f1d1d] bg-[#450a0a]/40'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    doc.status === 'filled'
                      ? 'bg-[#22c55e]'
                      : doc.status === 'tbd'
                        ? 'bg-[#eab308]'
                        : 'bg-[#ef4444]'
                  }`}
                />
                <span className="text-[11px] text-[#a3a3a3] truncate">{doc.file}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SonarQube quality gate */}
      {sonarEnabled && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <Shield size={14} className="text-[#a78bfa]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">SonarQube</h3>
            <span className="ml-auto flex items-center gap-2">
              {sonarScan?.qualityGate && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                    sonarScan.qualityGate === 'OK'
                      ? 'bg-[#052e16] text-[#22c55e]'
                      : sonarScan.qualityGate === 'ERROR'
                        ? 'bg-[#450a0a] text-[#ef4444]'
                        : sonarScan.qualityGate === 'WARN'
                          ? 'bg-[#422006] text-[#eab308]'
                          : 'bg-[#1a1a1a] text-[#525252]'
                  }`}
                >
                  {sonarScan.qualityGate}
                </span>
              )}
              <button
                onClick={async () => {
                  setSonarScanning(true);
                  try {
                    const result = await triggerSonarScan(projectId);
                    if (result.qualityGate) {
                      setSonarScan({ qualityGate: result.qualityGate.status, conditions: result.qualityGate.conditions });
                    }
                  } catch { /* ignore */ }
                  setSonarScanning(false);
                }}
                disabled={sonarScanning}
                className="text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors disabled:opacity-50"
              >
                {sonarScanning ? 'Taranıyor...' : 'Tara'}
              </button>
            </span>
          </div>
          {sonarScan?.conditions && sonarScan.conditions.length > 0 && (
            <div className="p-3 space-y-1">
              {sonarScan.conditions.map((cond, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-[#a3a3a3]">{cond.metricKey}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[#525252] font-mono">{cond.actualValue ?? '-'}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        cond.status === 'OK'
                          ? 'bg-[#22c55e]'
                          : cond.status === 'ERROR'
                            ? 'bg-[#ef4444]'
                            : 'bg-[#eab308]'
                      }`}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
          {(!sonarScan?.conditions || sonarScan.conditions.length === 0) && (
            <div className="flex items-center justify-center py-6 text-[11px] text-[#525252]">
              {sonarScan?.createdAt
                ? `Son tarama: ${new Date(sonarScan.createdAt).toLocaleString('tr-TR')}`
                : 'Henuz tarama yapilmadi'}
            </div>
          )}
        </div>
      )}

      {/* Container Pool durumu */}
      {poolStatus?.initialized && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <Container size={14} className="text-[#06b6d4]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Container Pool</h3>
            <span className="ml-auto text-[10px] text-[#525252]">{poolStatus.total} container</span>
          </div>
          <div className="p-3">
            <div className="flex gap-3 mb-3">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                <span className="text-[#a3a3a3]">Ready: {poolStatus.ready}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                <span className="text-[#a3a3a3]">Busy: {poolStatus.busy}</span>
              </div>
              {poolStatus.unhealthy > 0 && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
                  <span className="text-[#a3a3a3]">Unhealthy: {poolStatus.unhealthy}</span>
                </div>
              )}
            </div>
            {poolStatus.containers.length > 0 && (
              <div className="space-y-1">
                {poolStatus.containers.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-[11px] py-0.5">
                    <span className="text-[#737373] font-mono">{c.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      c.status === 'ready' ? 'bg-[#052e16] text-[#22c55e]' :
                      c.status === 'busy' ? 'bg-[#422006] text-[#f59e0b]' :
                      'bg-[#450a0a] text-[#ef4444]'
                    }`}>
                      {c.status}{c.assignedTo ? ` (task)` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ajan performans tablosu */}
      <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
          <Activity size={14} className="text-[#22c55e]" />
          <h3 className="text-[12px] font-semibold text-[#fafafa]">Agent Performance</h3>
          <span className="ml-auto text-[10px] text-[#525252]">{agents.length} agents</span>
        </div>

        {agents.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[12px] text-[#525252]">
            No agents assigned to this project yet
          </div>
        ) : (
          <div>
            {/* Tablo baslik satiri */}
            <div className="flex items-center gap-3 px-4 py-2 bg-[#0d0d0d]">
              <span className="text-[10px] text-[#525252] uppercase tracking-wider w-44 shrink-0">Agent</span>
              <div className="flex gap-4">
                <span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Assigned</span>
                <span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Done</span>
                <span className="text-[10px] text-[#525252] uppercase tracking-wider w-14 text-center">Failed</span>
              </div>
              <span className="flex-1 text-[10px] text-[#525252] uppercase tracking-wider">Success</span>
              <span className="w-16 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Runs</span>
              <span className="w-16 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Time</span>
              <span className="w-20 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Messages</span>
              <span className="w-16 text-center text-[10px] text-[#525252] uppercase tracking-wider shrink-0">Status</span>
            </div>
            {agents.map((agent) => (
              <AgentRow key={agent.agentId} agent={agent} />
            ))}
          </div>
        )}

        {/* v4.1: Agent Heat Map + Comparison */}
        <div className="bg-[#0e0e0e] border border-[#1f1f1f] rounded-xl p-4">
          <h3 className="text-[13px] font-semibold text-[#fafafa] mb-3">Agent Performans Analizi</h3>
          <AgentHeatMap projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
