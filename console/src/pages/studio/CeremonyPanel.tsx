import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  PlayCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Zap,
  TrendingUp,
} from 'lucide-react';

const BASE = import.meta.env.VITE_API_BASE ?? '';

interface StandupAgent {
  agentId: string;
  agentName: string;
  role: string;
  completed: string[];
  inProgress: string[];
  blockers: string[];
}

interface StandupResult {
  runAt?: string;
  agents: StandupAgent[];
}

interface RetroSection {
  wentWell: string[];
  couldImprove: string[];
  actionItems: string[];
}

interface RetroAgentStat {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  avgRevisions: number;
  successRate: number;
}

interface RetroResult {
  runAt?: string;
  data: RetroSection;
  agentStats?: RetroAgentStat[];
}

type Tab = 'standup' | 'retro';

// ---------------------------------------------------------------------------
// Response validators (defend against 500 error bodies)
// ---------------------------------------------------------------------------

function parseStandup(raw: unknown): StandupResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.agents)) return null;
  return {
    runAt: typeof r.runAt === 'string' ? r.runAt : undefined,
    agents: r.agents as StandupAgent[],
  };
}

function parseRetro(raw: unknown): RetroResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const data = r.data as Record<string, unknown> | undefined;
  if (!data || !Array.isArray(data.wentWell) || !Array.isArray(data.couldImprove) || !Array.isArray(data.actionItems)) {
    return null;
  }
  return {
    runAt: typeof r.runAt === 'string' ? r.runAt : undefined,
    data: {
      wentWell: data.wentWell as string[],
      couldImprove: data.couldImprove as string[],
      actionItems: data.actionItems as string[],
    },
    agentStats: Array.isArray(r.agentStats) ? (r.agentStats as RetroAgentStat[]) : undefined,
  };
}

async function fetchCeremony<T>(
  url: string,
  parse: (raw: unknown) => T | null,
  method: 'GET' | 'POST' = 'GET',
): Promise<T | null> {
  try {
    const res = await fetch(url, { method });
    if (!res.ok) return null;
    const body = await res.json();
    return parse(body);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CeremonyPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>('standup');
  const [standup, setStandup] = useState<StandupResult | null>(null);
  const [retro, setRetro] = useState<RetroResult | null>(null);
  const [loadingStandup, setLoadingStandup] = useState(false);
  const [loadingRetro, setLoadingRetro] = useState(false);
  const [running, setRunning] = useState<Tab | null>(null);

  const loadStandup = useCallback(async () => {
    setLoadingStandup(true);
    const result = await fetchCeremony(
      `${BASE}/api/studio/projects/${projectId}/ceremonies/standup`,
      parseStandup,
    );
    if (result) setStandup(result);
    setLoadingStandup(false);
  }, [projectId]);

  const loadRetro = useCallback(async () => {
    setLoadingRetro(true);
    const result = await fetchCeremony(
      `${BASE}/api/studio/projects/${projectId}/ceremonies/retrospective`,
      parseRetro,
    );
    if (result) setRetro(result);
    setLoadingRetro(false);
  }, [projectId]);

  // Lazy load per tab
  useEffect(() => {
    if (tab === 'standup' && !standup && !loadingStandup) loadStandup();
    if (tab === 'retro' && !retro && !loadingRetro) loadRetro();
  }, [tab, standup, retro, loadingStandup, loadingRetro, loadStandup, loadRetro]);

  const runStandup = async () => {
    setRunning('standup');
    const result = await fetchCeremony(
      `${BASE}/api/studio/projects/${projectId}/ceremonies/standup`,
      parseStandup,
      'POST',
    );
    if (result) setStandup(result);
    setRunning(null);
  };

  const runRetro = async () => {
    setRunning('retro');
    const result = await fetchCeremony(
      `${BASE}/api/studio/projects/${projectId}/ceremonies/retrospective`,
      parseRetro,
      'POST',
    );
    if (result) setRetro(result);
    setRunning(null);
  };

  const isLoading = (tab === 'standup' ? loadingStandup : loadingRetro) && !(tab === 'standup' ? standup : retro);

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#fafafa]">Ceremonies</h2>
          <p className="text-[11px] text-[#525252] mt-0.5">Scrum ceremony results</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'standup' && (
            <button
              type="button"
              onClick={runStandup}
              disabled={running === 'standup'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
            >
              {running === 'standup' ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
              {running === 'standup' ? 'Running...' : 'Run Standup'}
            </button>
          )}
          {tab === 'retro' && (
            <button
              type="button"
              onClick={runRetro}
              disabled={running === 'retro'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#a855f7]/10 border border-[#a855f7]/30 text-[#a855f7] hover:bg-[#a855f7]/20 transition-colors disabled:opacity-50"
            >
              {running === 'retro' ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
              {running === 'retro' ? 'Running...' : 'Run Retrospective'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#111111] border border-[#262626] rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('standup')}
          className={`px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
            tab === 'standup'
              ? 'bg-[#1a1a1a] text-[#fafafa] shadow-sm'
              : 'text-[#525252] hover:text-[#a3a3a3]'
          }`}
        >
          Standup
        </button>
        <button
          type="button"
          onClick={() => setTab('retro')}
          className={`px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
            tab === 'retro'
              ? 'bg-[#1a1a1a] text-[#fafafa] shadow-sm'
              : 'text-[#525252] hover:text-[#a3a3a3]'
          }`}
        >
          Retrospective
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={20} className="text-[#525252] animate-spin" />
          </div>
        ) : tab === 'standup' ? (
          <StandupView data={standup} />
        ) : (
          <RetroView data={retro} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standup view
// ---------------------------------------------------------------------------

function StandupView({ data }: { data: StandupResult | null }) {
  if (!data || data.agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Clock size={28} className="text-[#333] mb-3" />
        <p className="text-[13px] text-[#a3a3a3] mb-1">
          {!data ? 'No standup results yet' : 'No agents configured'}
        </p>
        <p className="text-[11px] text-[#525252]">
          {!data ? 'Run a standup to see agent updates.' : 'Add agents to the project to generate standups.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {data.runAt && (
        <p className="text-[11px] text-[#525252] mb-3">
          Last run: {new Date(data.runAt).toLocaleString()}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.agents.map((agent) => (
          <div key={agent.agentId} className="bg-[#111111] border border-[#262626] rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/30 flex items-center justify-center text-[11px] font-bold text-[#22c55e]">
                {agent.agentName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-[12px] font-semibold text-[#fafafa]">{agent.agentName}</p>
                <p className="text-[10px] text-[#525252]">{agent.role}</p>
              </div>
            </div>

            {agent.completed.length > 0 && (
              <StandupSection icon={<CheckCircle2 size={11} className="text-[#22c55e]" />} label="Completed" color="#22c55e" items={agent.completed} />
            )}
            {agent.inProgress.length > 0 && (
              <StandupSection icon={<Zap size={11} className="text-[#f59e0b]" />} label="In Progress" color="#f59e0b" items={agent.inProgress} />
            )}
            {agent.blockers.length > 0 && (
              <StandupSection icon={<AlertTriangle size={11} className="text-[#ef4444]" />} label="Blockers" color="#ef4444" items={agent.blockers} />
            )}

            {agent.completed.length === 0 && agent.inProgress.length === 0 && agent.blockers.length === 0 && (
              <p className="text-[11px] text-[#525252] italic">No updates</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function StandupSection({
  icon,
  label,
  color,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  items: string[];
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>{label}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li
            key={`${label}-${i}`}
            className="text-[11px] text-[#a3a3a3] leading-snug pl-2 border-l"
            style={{ borderColor: `${color}33` }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retrospective view
// ---------------------------------------------------------------------------

function RetroView({ data }: { data: RetroResult | null }) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <ThumbsUp size={28} className="text-[#333] mb-3" />
        <p className="text-[13px] text-[#a3a3a3] mb-1">No retrospective results yet</p>
        <p className="text-[11px] text-[#525252]">Run a retrospective to see team insights.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.runAt && (
        <p className="text-[11px] text-[#525252]">
          Last run: {new Date(data.runAt).toLocaleString()}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RetroColumn
          bg="#052e16"
          color="#22c55e"
          icon={<ThumbsUp size={13} className="text-[#22c55e]" />}
          label="What Went Well"
          items={data.data.wentWell}
          marker="+"
        />
        <RetroColumn
          bg="#422006"
          color="#f97316"
          icon={<ThumbsDown size={13} className="text-[#f97316]" />}
          label="Could Improve"
          items={data.data.couldImprove}
          marker="△"
        />
        <RetroColumn
          bg="#1e3a5f"
          color="#3b82f6"
          icon={<CheckCircle2 size={13} className="text-[#3b82f6]" />}
          label="Action Items"
          items={data.data.actionItems}
          marker="→"
        />
      </div>

      {/* Agent Performance Stats */}
      {data.agentStats && data.agentStats.length > 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
            <TrendingUp size={13} className="text-[#a855f7]" />
            <h3 className="text-[12px] font-semibold text-[#fafafa]">Agent Performance</h3>
            <span className="ml-auto text-[10px] text-[#525252]">{data.agentStats.length} agents</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#0d0d0d] text-[#525252]">
                <tr>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Agent</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Completed</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Avg Revisions</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-[10px]">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.agentStats.map((s) => (
                  <tr key={s.agentId} className="border-t border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-2 text-[#e5e5e5]">{s.agentName}</td>
                    <td className="px-4 py-2 text-right text-[#22c55e] font-medium">{s.tasksCompleted}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${
                        s.avgRevisions > 1.5 ? 'text-[#f97316]' : 'text-[#a3a3a3]'
                      }`}
                    >
                      {s.avgRevisions.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${
                        s.successRate >= 0.9
                          ? 'text-[#22c55e]'
                          : s.successRate >= 0.7
                            ? 'text-[#f59e0b]'
                            : 'text-[#ef4444]'
                      }`}
                    >
                      {Math.round(s.successRate * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RetroColumn({
  bg,
  color,
  icon,
  label,
  items,
  marker,
}: {
  bg: string;
  color: string;
  icon: React.ReactNode;
  label: string;
  items: string[];
  marker: string;
}) {
  return (
    <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]"
        style={{ backgroundColor: `${bg}4d` }}
      >
        {icon}
        <h3 className="text-[12px] font-semibold" style={{ color }}>{label}</h3>
        <span className="ml-auto text-[10px] text-[#525252]">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-0">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 px-4 py-2.5 border-t border-[#1a1a1a] first:border-0">
            <span className="text-[11px] mt-0.5 shrink-0" style={{ color: `${color}99` }}>{marker}</span>
            <span className="text-[11px] text-[#a3a3a3] leading-snug">{item}</span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="flex items-center justify-center py-8 text-[11px] text-[#333]">—</li>
        )}
      </ul>
    </div>
  );
}
