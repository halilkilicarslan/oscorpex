import { useState, useEffect, useCallback } from 'react';
import { Loader2, PlayCircle, CheckCircle2, Clock, AlertTriangle, ThumbsUp, ThumbsDown, Zap } from 'lucide-react';

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

interface RetroResult {
  runAt?: string;
  data: RetroSection;
}

type Tab = 'standup' | 'retro';

export default function CeremonyPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>('standup');
  const [standup, setStandup] = useState<StandupResult | null>(null);
  const [retro, setRetro] = useState<RetroResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<Tab | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch(`${BASE}/api/studio/projects/${projectId}/ceremonies/standup`).then((r) => r.json()).catch(() => null),
      fetch(`${BASE}/api/studio/projects/${projectId}/ceremonies/retrospective`).then((r) => r.json()).catch(() => null),
    ]).then(([s, r]) => {
      if (s) setStandup(s);
      if (r) setRetro(r);
    }).finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const runStandup = async () => {
    setRunning('standup');
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/ceremonies/standup`, {
        method: 'POST',
      });
      const data = await res.json();
      setStandup(data);
    } catch {}
    setRunning(null);
  };

  const runRetro = async () => {
    setRunning('retro');
    try {
      const res = await fetch(`${BASE}/api/studio/projects/${projectId}/ceremonies/retrospective`, {
        method: 'POST',
      });
      const data = await res.json();
      setRetro(data);
    } catch {}
    setRunning(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

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
        {tab === 'standup' && (
          <>
            {!standup || standup.agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <Clock size={28} className="text-[#333] mb-3" />
                <p className="text-[13px] text-[#a3a3a3] mb-1">No standup results yet</p>
                <p className="text-[11px] text-[#525252]">Run a standup to see agent updates.</p>
              </div>
            ) : (
              <>
                {standup.runAt && (
                  <p className="text-[11px] text-[#525252] mb-3">
                    Last run: {new Date(standup.runAt).toLocaleString()}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {standup.agents.map((agent) => (
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
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <CheckCircle2 size={11} className="text-[#22c55e]" />
                            <span className="text-[10px] font-semibold text-[#22c55e] uppercase tracking-wider">Completed</span>
                          </div>
                          <ul className="flex flex-col gap-1">
                            {agent.completed.map((item, i) => (
                              <li key={i} className="text-[11px] text-[#a3a3a3] leading-snug pl-2 border-l border-[#22c55e]/20">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {agent.inProgress.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Zap size={11} className="text-[#f59e0b]" />
                            <span className="text-[10px] font-semibold text-[#f59e0b] uppercase tracking-wider">In Progress</span>
                          </div>
                          <ul className="flex flex-col gap-1">
                            {agent.inProgress.map((item, i) => (
                              <li key={i} className="text-[11px] text-[#a3a3a3] leading-snug pl-2 border-l border-[#f59e0b]/20">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {agent.blockers.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <AlertTriangle size={11} className="text-[#ef4444]" />
                            <span className="text-[10px] font-semibold text-[#ef4444] uppercase tracking-wider">Blockers</span>
                          </div>
                          <ul className="flex flex-col gap-1">
                            {agent.blockers.map((item, i) => (
                              <li key={i} className="text-[11px] text-[#a3a3a3] leading-snug pl-2 border-l border-[#ef4444]/20">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {agent.completed.length === 0 && agent.inProgress.length === 0 && agent.blockers.length === 0 && (
                        <p className="text-[11px] text-[#525252] italic">No updates</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === 'retro' && (
          <>
            {!retro ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <ThumbsUp size={28} className="text-[#333] mb-3" />
                <p className="text-[13px] text-[#a3a3a3] mb-1">No retrospective results yet</p>
                <p className="text-[11px] text-[#525252]">Run a retrospective to see team insights.</p>
              </div>
            ) : (
              <>
                {retro.runAt && (
                  <p className="text-[11px] text-[#525252] mb-3">
                    Last run: {new Date(retro.runAt).toLocaleString()}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Went well */}
                  <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a] bg-[#052e16]/30">
                      <ThumbsUp size={13} className="text-[#22c55e]" />
                      <h3 className="text-[12px] font-semibold text-[#22c55e]">What Went Well</h3>
                      <span className="ml-auto text-[10px] text-[#525252]">{retro.data.wentWell.length}</span>
                    </div>
                    <ul className="flex flex-col gap-0">
                      {retro.data.wentWell.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 px-4 py-2.5 border-t border-[#1a1a1a] first:border-0">
                          <span className="text-[#22c55e]/60 text-[11px] mt-0.5 shrink-0">+</span>
                          <span className="text-[11px] text-[#a3a3a3] leading-snug">{item}</span>
                        </li>
                      ))}
                      {retro.data.wentWell.length === 0 && (
                        <li className="flex items-center justify-center py-8 text-[11px] text-[#333]">—</li>
                      )}
                    </ul>
                  </div>

                  {/* Could improve */}
                  <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a] bg-[#422006]/30">
                      <ThumbsDown size={13} className="text-[#f97316]" />
                      <h3 className="text-[12px] font-semibold text-[#f97316]">Could Improve</h3>
                      <span className="ml-auto text-[10px] text-[#525252]">{retro.data.couldImprove.length}</span>
                    </div>
                    <ul className="flex flex-col gap-0">
                      {retro.data.couldImprove.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 px-4 py-2.5 border-t border-[#1a1a1a] first:border-0">
                          <span className="text-[#f97316]/60 text-[11px] mt-0.5 shrink-0">△</span>
                          <span className="text-[11px] text-[#a3a3a3] leading-snug">{item}</span>
                        </li>
                      ))}
                      {retro.data.couldImprove.length === 0 && (
                        <li className="flex items-center justify-center py-8 text-[11px] text-[#333]">—</li>
                      )}
                    </ul>
                  </div>

                  {/* Action items */}
                  <div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a] bg-[#1e3a5f]/30">
                      <CheckCircle2 size={13} className="text-[#3b82f6]" />
                      <h3 className="text-[12px] font-semibold text-[#3b82f6]">Action Items</h3>
                      <span className="ml-auto text-[10px] text-[#525252]">{retro.data.actionItems.length}</span>
                    </div>
                    <ul className="flex flex-col gap-0">
                      {retro.data.actionItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 px-4 py-2.5 border-t border-[#1a1a1a] first:border-0">
                          <span className="text-[#3b82f6]/60 text-[11px] mt-0.5 shrink-0">→</span>
                          <span className="text-[11px] text-[#a3a3a3] leading-snug">{item}</span>
                        </li>
                      ))}
                      {retro.data.actionItems.length === 0 && (
                        <li className="flex items-center justify-center py-8 text-[11px] text-[#333]">—</li>
                      )}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
