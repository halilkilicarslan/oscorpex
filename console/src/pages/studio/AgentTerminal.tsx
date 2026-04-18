import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Eraser, Wifi, WifiOff } from 'lucide-react';
import AgentAvatarImg from '../../components/AgentAvatar';
import {
  getAgentOutput,
  getAgentStatus,
  streamAgentOutput,
  type AgentProcessInfo,
} from '../../lib/studio-api';

// Durum göstergesi bileşeni
function StatusBadge({ status }: { status: AgentProcessInfo['status'] }) {
  // Her duruma karşılık gelen renk ve etiket
  const map: Record<AgentProcessInfo['status'], { dot: string; label: string }> = {
    idle:     { dot: 'bg-[#525252]',                       label: 'Idle' },
    starting: { dot: 'bg-[#f59e0b] animate-pulse',         label: 'Starting' },
    running:  { dot: 'bg-[#22c55e] animate-pulse',         label: 'Running' },
    stopping: { dot: 'bg-[#f59e0b] animate-pulse',         label: 'Durduruluyor' },
    stopped:  { dot: 'bg-[#737373]',                       label: 'Durduruldu' },
    error:    { dot: 'bg-[#ef4444]',                       label: 'Hata' },
  };
  const s = map[status] ?? map.idle;

  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className="text-[10px] text-[#525252]">{s.label}</span>
    </span>
  );
}

// xterm.js terminal renk teması — koyu arka plan
const TERMINAL_THEME = {
  background:         '#0a0a0a',
  foreground:         '#a3a3a3',
  cursor:             '#22c55e',
  cursorAccent:       '#0a0a0a',
  selectionBackground:'#22c55e33',
  black:              '#0a0a0a',
  red:                '#ef4444',
  green:              '#22c55e',
  yellow:             '#f59e0b',
  blue:               '#3b82f6',
  magenta:            '#a855f7',
  cyan:               '#06b6d4',
  white:              '#a3a3a3',
  brightBlack:        '#525252',
  brightWhite:        '#fafafa',
} as const;

// SSE bağlantısı koptuğunda yeniden bağlanma gecikmesi (ms)
const RECONNECT_DELAY_MS = 2000;

export default function AgentTerminal({
  projectId,
  agentId,
  agentName,
  agentAvatar,
}: {
  projectId: string;
  agentId: string;
  agentName?: string;
  agentAvatar?: string;
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const termRef       = useRef<Terminal | null>(null);
  const fitAddonRef   = useRef<FitAddon | null>(null);
  // Sonraki SSE satır indeksini takip et — mevcut tampon alındıktan sonra güncellenir
  const nextIndexRef  = useRef<number>(0);
  // Yeniden bağlanma zamanlayıcısını sakla
  const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // SSE iptal fonksiyonunu sakla
  const abortStreamRef = useRef<(() => void) | null>(null);
  // Bileşen unmount oldu mu? (temizlik sırasında yeniden bağlanmayı önler)
  const unmountedRef  = useRef(false);

  // Bağlantı durumu göstergesi
  const [connected, setConnected]       = useState(false);
  // Ajan süreç bilgisi (durum ve PID)
  const [processInfo, setProcessInfo]   = useState<AgentProcessInfo | null>(null);

  // Terminali temizle — xterm.js reset metodunu kullan
  const handleClear = useCallback(() => {
    termRef.current?.clear();
  }, []);

  // SSE akışını başlat; bağlantı koptuğunda yeniden bağlan
  const connectStream = useCallback(() => {
    if (unmountedRef.current) return;

    // Önceki SSE bağlantısını kapat
    abortStreamRef.current?.();

    const abort = streamAgentOutput(
      projectId,
      agentId,
      // Her yeni satır geldiğinde terminale yaz
      (line, index) => {
        // Yinelenen satırları önlemek için indeks kontrolü
        if (index < nextIndexRef.current) return;
        nextIndexRef.current = index + 1;
        termRef.current?.writeln(line);
      },
      // Hata durumunda bağlantıyı koptu olarak işaretle ve yeniden bağlan
      (err) => {
        if (unmountedRef.current) return;
        setConnected(false);
        termRef.current?.writeln(
          `\x1b[31m● Akış kesildi: ${err.message}. ${RECONNECT_DELAY_MS / 1000}sn sonra yeniden bağlanılıyor...\x1b[0m`,
        );
        // Yeniden bağlanma zamanlayıcısını başlat
        reconnTimerRef.current = setTimeout(() => {
          if (!unmountedRef.current) connectStream();
        }, RECONNECT_DELAY_MS);
      },
    );

    abortStreamRef.current = abort;
    setConnected(true);
  }, [projectId, agentId]);

  // Bileşen mount olduğunda terminali başlat
  useEffect(() => {
    unmountedRef.current = false;

    if (!containerRef.current) return;

    // xterm.js terminal örneğini oluştur
    const term = new Terminal({
      theme:      TERMINAL_THEME,
      fontSize:   12,
      fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
      cursorBlink:true,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current    = term;
    fitAddonRef.current = fitAddon;

    // Karşılama mesajı
    term.writeln('\x1b[32m● Agent terminal ready\x1b[0m');
    term.writeln(`\x1b[90mProje: ${projectId} | Ajan: ${agentId}\x1b[0m`);
    term.writeln('');

    // Ajan durumunu sorgula ve süreç bilgisini ayarla
    getAgentStatus(projectId, agentId)
      .then(setProcessInfo)
      .catch(() => { /* Durum sorgusu sessizce atlanır */ });

    // Mevcut çıktı tamponunu yükle, ardından SSE akışına bağlan
    getAgentOutput(projectId, agentId)
      .then(({ lines, total }) => {
        if (unmountedRef.current) return;
        // Tampondaki mevcut satırları terminale yaz
        for (const line of lines) {
          term.writeln(line);
        }
        // Sonraki SSE satır indeksini mevcut toplam üzerine ayarla
        nextIndexRef.current = total;
        // Ardından SSE akışına bağlan
        connectStream();
      })
      .catch(() => {
        if (unmountedRef.current) return;
        // Tampon alınamazsa doğrudan SSE akışına bağlan
        connectStream();
      });

    // Kapsayıcı boyutu değiştiğinde terminali yeniden boyutlandır
    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(containerRef.current);

    // Temizlik: unmount sırasında tüm kaynakları serbest bırak
    return () => {
      unmountedRef.current = true;
      observer.disconnect();

      // Yeniden bağlanma zamanlayıcısını iptal et
      if (reconnTimerRef.current !== null) {
        clearTimeout(reconnTimerRef.current);
        reconnTimerRef.current = null;
      }

      // SSE bağlantısını kapat
      abortStreamRef.current?.();
      abortStreamRef.current = null;

      // xterm.js örneğini yok et
      term.dispose();
      termRef.current    = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, agentId]);

  // Ajan çalışırken durumu 3 saniyede bir güncelle
  useEffect(() => {
    if (!processInfo || processInfo.status !== 'running') return;

    const interval = setInterval(() => {
      getAgentStatus(projectId, agentId)
        .then(setProcessInfo)
        .catch(() => { /* Polling hatalarını sessizce atla */ });
    }, 3000);

    return () => clearInterval(interval);
  }, [projectId, agentId, processInfo]);

  return (
    <div className="flex flex-col h-full">
      {/* Terminal başlık çubuğu */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0a0a0a] border-b border-[#262626] shrink-0">
        <div className="flex items-center gap-2">
          {/* Ajan adı ve avatarı */}
          {agentAvatar && (
            <AgentAvatarImg avatar={agentAvatar} name={agentName ?? agentId} size="xs" />
          )}
          <span className="text-[12px] font-mono text-[#a3a3a3]">
            {agentName ?? agentId}
          </span>
          {/* Ajan süreç durumu */}
          {processInfo && <StatusBadge status={processInfo.status} />}
          {/* PID göstergesi — süreç çalışırken görünür */}
          {processInfo?.pid && (
            <span className="text-[10px] font-mono text-[#525252]">
              PID {processInfo.pid}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* SSE bağlantı durumu göstergesi */}
          <span title={connected ? 'Stream connected' : 'Stream disconnected'}>
            {connected
              ? <Wifi size={12} className="text-[#22c55e]" />
              : <WifiOff size={12} className="text-[#525252]" />
            }
          </span>

          {/* Terminal temizleme butonu */}
          <button
            onClick={handleClear}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
            title="Clear terminal"
          >
            <Eraser size={11} />
            Clear
          </button>
        </div>
      </div>

      {/* xterm.js terminal kapsayıcısı */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden bg-[#0a0a0a]"
      />
    </div>
  );
}
