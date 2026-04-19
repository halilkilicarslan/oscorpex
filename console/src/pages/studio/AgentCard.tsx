import { memo, useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';
import {
  Play,
  Square,
  Loader2,
  Terminal,
  ChevronUp,
  Pencil,
  Trash2,
  Clock,
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import type { ProjectAgent } from '../../lib/studio-api';
import AgentAvatar from '../../components/AgentAvatar';
import {
  startAgentProcess,
  stopAgentProcess,
  getAgentStatus,
  getAgentRunHistory,
  fetchUnreadCount,
  type AgentProcessInfo,
  type AgentRunHistory,
  roleLabel,
} from '../../lib/studio-api';

// xterm is a heavy dependency (~500KB) — lazy load so it only downloads when
// a user actually opens the embedded terminal on a running agent.
const AgentTerminal = lazy(() => import('./AgentTerminal'));

function TerminalLoader() {
	return (
		<div className="flex items-center justify-center h-full bg-[#0d0d0d]">
			<div className="w-5 h-5 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
		</div>
	);
}

// Çalışma zamanı durum tipi — AgentProcessInfo ile uyumlu genişletilmiş küme
type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

const AGENT_CARD_WS_EVENTS = [
	'agent:output',
	'task:completed',
	'task:started',
	'task:failed',
	'agent:started',
	'agent:stopped',
];

// Her duruma karşılık gelen renk ve etiket
const STATUS_STYLES: Record<RuntimeStatus, { color: string; label: string }> = {
  idle:     { color: 'bg-[#525252]',                 label: 'Idle' },
  starting: { color: 'bg-[#f59e0b] animate-pulse',   label: 'Starting' },
  running:  { color: 'bg-[#22c55e] animate-pulse',   label: 'Running' },
  stopping: { color: 'bg-[#f59e0b] animate-pulse',   label: 'Stopping' },
  stopped:  { color: 'bg-[#737373]',                 label: 'Stopped' },
  error:    { color: 'bg-[#ef4444]',                 label: 'Error' },
};

// Geçmiş çalıştırma kaydı için durum badge'i
function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running:  'text-[#22c55e]',
    stopped:  'text-[#737373]',
    error:    'text-[#ef4444]',
    completed:'text-[#3b82f6]',
  };
  return (
    <span className={`text-[9px] font-medium uppercase ${colors[status] ?? 'text-[#525252]'}`}>
      {status}
    </span>
  );
}

// Tarih/saat dizisini kısa göreli formata çevir
function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)  return `${sec}sn önce`;
  const min  = Math.floor(sec / 60);
  if (min < 60)  return `${min}dk önce`;
  const hr   = Math.floor(min / 60);
  return `${hr}sa önce`;
}

function AgentCard({
  agent,
  projectId,
  status: externalStatus,
  onStart,
  onStop,
  onClick,
  onEdit,
  onDelete,
  onChat,
}: {
  agent: ProjectAgent;
  projectId: string;
  status: RuntimeStatus;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onChat?: () => void;
}) {
  const [showTerminal, setShowTerminal]     = useState(false);
  const [actionLoading, setActionLoading]   = useState(false);
  // Gerçek zamanlı süreç bilgisi (PID, durum vb.)
  const [processInfo, setProcessInfo]       = useState<AgentProcessInfo | null>(null);
  // Çalıştırma geçmişi
  const [runHistory, setRunHistory]         = useState<AgentRunHistory[]>([]);
  const [showHistory, setShowHistory]       = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Geçmiş açılır menüsü dışına tıklandığında kapat
  const historyRef = useRef<HTMLDivElement>(null);
  // Bu ajana ait okunmamış mesaj sayısı
  const [unreadCount, setUnreadCount]       = useState(0);

  // Görüntülenecek durum: eylem yükleniyorsa geçiş durumunu kullan
  const status = actionLoading
    ? externalStatus === 'running' ? 'stopping' : 'starting'
    : externalStatus;
  const s         = STATUS_STYLES[status] ?? STATUS_STYLES.idle;
  const isRunning = externalStatus === 'running';

  // Ajan sürecini başlat veya durdur
  const handleAction = async () => {
    setActionLoading(true);
    try {
      if (isRunning) {
        // Yeni API ile durdur
        await stopAgentProcess(projectId, agent.id);
        await onStop();
        setProcessInfo(null);
      } else {
        // Yeni API ile başlat; yanıtta süreç bilgisini kaydet
        const info = await startAgentProcess(projectId, agent.id);
        setProcessInfo(info);
        await onStart();
      }
    } catch {
      // Hata durumunu üst bileşen yönetir
    } finally {
      setActionLoading(false);
    }
  };

  // Ajan süreç durumunu getir
  const pollAgentStatus = useCallback(async () => {
    try {
      const info = await getAgentStatus(projectId, agent.id);
      setProcessInfo(info);
    } catch {
      // Polling hatalarını sessizce atla
    }
  }, [projectId, agent.id]);

  // WS event-driven refresh — eşleşen event geldiğinde durumu güncelle
  const { isWsActive } = useWsEventRefresh(projectId, AGENT_CARD_WS_EVENTS, pollAgentStatus, {
    debounceMs: 300,
    enabled: isRunning,
  });

  // Ajan çalışırken süreç durumunu güncelle — yalnızca WS bağlantısı yokken polling yap
  useEffect(() => {
    if (!isRunning) return;
    pollAgentStatus();
    if (isWsActive) return; // WS handles it
    const interval = setInterval(pollAgentStatus, 3000);
    return () => clearInterval(interval);
  }, [projectId, agent.id, isRunning, isWsActive, pollAgentStatus]);

  // Terminal kapandığında geçmişi kapat
  useEffect(() => {
    if (!isRunning) setShowTerminal(false);
  }, [isRunning]);

  // Okunmamış mesaj sayısını yükle ve 15 saniyede bir güncelle
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetchUnreadCount(projectId, agent.id);
        if (!cancelled) setUnreadCount(res.unreadCount);
      } catch {
        // Sayaç yüklenemezse sessizce geç
      }
    };

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, agent.id]);

  // Geçmiş menüsü dışına tıklandığında kapat
  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  // Geçmiş menüsünü aç ve son 5 kaydı yükle
  const handleToggleHistory = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const history = await getAgentRunHistory(projectId, agent.id, 5);
      setRunHistory(history);
    } catch {
      setRunHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [showHistory, projectId, agent.id]);

  return (
    <div
      className={`bg-[#111111] border border-[#262626] border-l-4 rounded-xl overflow-hidden ${onClick ? 'hover:border-[#333] transition-colors' : ''}`}
      style={{ borderLeftColor: agent.color ?? '#22c55e' }}
    >
      {/* Kart ana satırı */}
      <div
        className={`flex items-center gap-3 px-4 py-3 ${onClick ? 'cursor-pointer' : ''}`}
        onClick={onClick}
      >
        {/* Avatar — okunmamış mesaj varsa kırmızı rozet göster */}
        <div className="relative shrink-0">
          <AgentAvatar avatar={agent.avatar} name={agent.name} size="lg" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#ef4444] text-[#fafafa] text-[8px] font-bold flex items-center justify-center leading-none"
              title={`${unreadCount} okunmamış mesaj`}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>

        {/* Ajan bilgisi */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#fafafa] truncate">{agent.name}</span>
            <div className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} title={s.label} />
            {/* Şablon / Özel rozeti */}
            <span
              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${
                agent.sourceAgentId
                  ? 'bg-[#a3a3a3]/10 text-[#525252] border border-[#333]'
                  : 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
              }`}
            >
              {agent.sourceAgentId ? 'Template' : 'Custom'}
            </span>
          </div>

          {/* Rol ve PID bilgisi */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#525252] truncate">{roleLabel(agent.role)}</span>
            {/* PID — yalnızca süreç çalışırken göster */}
            {processInfo?.pid && (
              <span className="text-[10px] font-mono text-[#3b82f6] shrink-0">
                PID {processInfo.pid}
              </span>
            )}
          </div>
        </div>

        {/* Eylem butonları — kart tıklamasının yayılmasını engelle */}
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sohbet */}
          {onChat && (
            <button
              onClick={onChat}
              className="p-1.5 rounded-lg text-[#525252] hover:text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors"
              title="Ajan ile sohbet et"
            >
              <MessageSquare size={13} />
            </button>
          )}

          {/* Düzenle */}
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
              title="Edit agent"
            >
              <Pencil size={13} />
            </button>
          )}

          {/* Sil */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg text-[#525252] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
              title="Delete agent"
            >
              <Trash2 size={13} />
            </button>
          )}

          {/* Geçmiş açılır menüsü */}
          <div className="relative" ref={historyRef}>
            <button
              onClick={handleToggleHistory}
              className={`p-1.5 rounded-lg transition-colors text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] ${
                showHistory ? 'bg-[#1f1f1f] text-[#a3a3a3]' : ''
              }`}
              title="Run history"
            >
              <Clock size={13} />
            </button>

            {/* Geçmiş açılır menüsü */}
            {showHistory && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-[#111111] border border-[#262626] rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-[#262626]">
                  <span className="text-[10px] font-semibold text-[#525252] uppercase tracking-wide">
                    Son Çalıştırmalar
                  </span>
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={14} className="text-[#525252] animate-spin" />
                  </div>
                ) : runHistory.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-[#525252] text-center">
                    No run history yet
                  </div>
                ) : (
                  <ul className="divide-y divide-[#1f1f1f]">
                    {runHistory.map((run) => (
                      <li key={run.id} className="px-3 py-2">
                        <div className="flex items-center justify-between mb-0.5">
                          <RunStatusBadge status={run.status} />
                          <span className="text-[9px] text-[#525252] font-mono">
                            {relativeTime(run.startedAt ?? run.createdAt)}
                          </span>
                        </div>
                        {run.taskPrompt && (
                          <p className="text-[10px] text-[#737373] truncate" title={run.taskPrompt}>
                            {run.taskPrompt}
                          </p>
                        )}
                        {/* PID ve çıkış kodu */}
                        <div className="flex items-center gap-2 mt-0.5">
                          {run.pid && (
                            <span className="text-[9px] font-mono text-[#525252]">PID {run.pid}</span>
                          )}
                          {run.exitCode !== null && run.exitCode !== undefined && (
                            <span
                              className={`text-[9px] font-mono ${
                                run.exitCode === 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
                              }`}
                            >
                              exit: {run.exitCode}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Geçmiş menüsünü kapat */}
                <div className="border-t border-[#262626]">
                  <button
                    onClick={() => setShowHistory(false)}
                    className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
                  >
                    <ChevronDown size={11} />
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Terminal aç/kapat — yalnızca çalışırken görünür */}
          {isRunning && (
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={`p-1.5 rounded-lg text-[#525252] hover:text-[#22c55e] hover:bg-[#1f1f1f] transition-colors ${
                showTerminal ? 'bg-[#1f1f1f] text-[#22c55e]' : ''
              }`}
              title="Terminal aç/kapat"
            >
              <Terminal size={14} />
            </button>
          )}

          {/* Başlat / Durdur butonu */}
          <button
            onClick={handleAction}
            disabled={actionLoading}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
              isRunning
                ? 'text-[#ef4444] hover:bg-[#ef4444]/10'
                : 'text-[#22c55e] hover:bg-[#22c55e]/10'
            }`}
            title={isRunning ? 'Durdur' : 'Başlat'}
          >
            {actionLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isRunning ? (
              <Square size={14} />
            ) : (
              <Play size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Yetenek etiketleri */}
      {agent.skills.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1">
          {agent.skills.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#737373] border border-[#262626]"
            >
              {skill}
            </span>
          ))}
          {agent.skills.length > 4 && (
            <span className="text-[10px] px-1.5 py-0.5 text-[#525252]">
              +{agent.skills.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Gömülü terminal — yalnızca çalışırken ve açıkken görünür */}
      {showTerminal && isRunning && (
        <div className="border-t border-[#262626]">
          {/* Terminal başlık çubuğu */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d0d0d]">
            <span className="text-[10px] text-[#525252] font-medium uppercase tracking-wide">
              Terminal
            </span>
            <button
              onClick={() => setShowTerminal(false)}
              className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
              title="Terminali kapat"
            >
              <ChevronUp size={12} />
            </button>
          </div>
          {/* Terminal bileşeni — xterm chunk yalnızca ilk açılışta indirilir */}
          <div className="h-[250px]">
            <Suspense fallback={<TerminalLoader />}>
              <AgentTerminal
                projectId={projectId}
                agentId={agent.id}
                agentName={agent.name}
                agentAvatar={agent.avatar}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(AgentCard);
