import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, MessageSquare, ExternalLink } from 'lucide-react';

interface TopBarProps {
  onOpenChat: () => void;
  chatOpen: boolean;
}

export default function TopBar({ onOpenChat, chatOpen }: TopBarProps) {
  const [apiUrl, setApiUrl] = useState('http://localhost:4242');
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/agents', { signal: AbortSignal.timeout(3000) });
      setConnected(res.ok);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 15000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-4 bg-[#0a0a0a] border-b border-[#262626]">
      {/* Left: Org & Project */}
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-[#a3a3a3] font-medium">
          My Organization
        </span>
        <span className="text-[#333] select-none">/</span>
        <span className="text-[13px] text-[#fafafa] font-medium">
          Oscorpex
        </span>
      </div>

      {/* Center: API URL + Connection Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1 bg-[#141414] border border-[#262626] rounded-full">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              checking
                ? 'bg-[#f59e0b] animate-pulse'
                : connected
                  ? 'bg-[#22c55e]'
                  : 'bg-[#ef4444]'
            }`}
          />
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="bg-transparent text-[12px] text-[#a3a3a3] font-mono w-44 outline-none"
          />
        </div>
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
            connected
              ? 'bg-[#22c55e]/10 text-[#22c55e]'
              : 'bg-[#ef4444]/10 text-[#ef4444]'
          }`}
        >
          {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenChat}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
            chatOpen
              ? 'bg-[#22c55e] text-black'
              : 'bg-[#1f1f1f] text-[#a3a3a3] hover:text-[#fafafa] hover:bg-[#262626]'
          }`}
        >
          <MessageSquare size={14} />
          AI Playground
        </button>
        <a
          href="https://github.com/voltagent/voltagent"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-[#a3a3a3] hover:text-[#fafafa] bg-[#1f1f1f] hover:bg-[#262626] transition-colors"
        >
          <ExternalLink size={14} />
        </a>
        <div className="w-7 h-7 rounded-full bg-[#22c55e]/20 flex items-center justify-center text-[11px] font-bold text-[#22c55e]">
          D
        </div>
      </div>
    </header>
  );
}
