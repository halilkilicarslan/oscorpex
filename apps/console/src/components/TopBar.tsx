import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, MessageSquare, ExternalLink } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { studioFetch } from '../lib/studio-api/base.js';

interface TopBarProps {
  onOpenChat: () => void;
  chatOpen: boolean;
}

export default function TopBar({ onOpenChat, chatOpen }: TopBarProps) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      await studioFetch<unknown>('/api/studio/agents', { signal: AbortSignal.timeout(3000) });
      setConnected(true);
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
        <div className="w-8 h-8 rounded-lg bg-[#111111] border border-[#262626] flex items-center justify-center overflow-hidden">
          <img src="/logo-icon.svg" alt="Oscorpex icon" className="w-5 h-5 object-contain brightness-0 invert" />
        </div>
        <span className="text-[13px] text-[#a3a3a3] font-medium">
          Workspace
        </span>
        <span className="text-[#333] select-none">/</span>
        <img src="/app-logo.svg" alt="Oscorpex" className="h-4 w-auto brightness-0 invert" />
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
          <span className="text-[12px] text-[#a3a3a3] font-mono">Kernel</span>
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
        <NotificationBell />
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
          href="https://github.com/oscorpex/oscorpex"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-[#a3a3a3] hover:text-[#fafafa] bg-[#1f1f1f] hover:bg-[#262626] transition-colors"
        >
          <ExternalLink size={14} />
        </a>
        <div className="w-7 h-7 rounded-full bg-[#22c55e]/20 flex items-center justify-center text-[11px] font-bold text-[#22c55e]">
          U
        </div>
      </div>
    </header>
  );
}
