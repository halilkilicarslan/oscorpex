import { useState, useCallback } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ChatPanel from './ChatPanel';
import type { AgentInfo } from '../types';

interface LayoutContext {
  openChat: (agent?: AgentInfo) => void;
}

export function useLayoutContext() {
  return useOutletContext<LayoutContext>();
}

export default function Layout() {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAgent, setChatAgent] = useState<AgentInfo | null>(null);

  const openChat = useCallback((agent?: AgentInfo) => {
    if (agent) setChatAgent(agent);
    setChatOpen(true);
  }, []);

  return (
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar onOpenChat={() => openChat()} chatOpen={chatOpen} />
        <main className="flex-1 overflow-y-auto">
          <Outlet context={{ openChat } satisfies LayoutContext} />
        </main>
      </div>
      {chatOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setChatOpen(false)}
          />
          <ChatPanel
            onClose={() => setChatOpen(false)}
            initialAgent={chatAgent}
          />
        </>
      )}
    </div>
  );
}
