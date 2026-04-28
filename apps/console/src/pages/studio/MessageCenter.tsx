// ---------------------------------------------------------------------------
// Oscorpex — Message Center (refactored)
// Extracted sub-components into messaging/ folder.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare,
  Loader2,
  RefreshCw,
  X,
  Inbox,
} from 'lucide-react';
import {
  fetchProjectAgents,
  fetchProjectMessages,
  fetchProjectMessagesPaginated,
  fetchMessageThread,
  sendAgentMessage,
  markMessageRead,
  archiveAgentMessage,
  broadcastMessage,
  fetchAllUnreadCounts,
  type ProjectAgent,
  type AgentMessage,
  type SendMessageData,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';
import {
  TypeBadge,
  MessageRow,
  ThreadView,
  ComposeBar,
  PAGE_SIZE,
  MESSAGE_CENTER_WS_EVENTS,
} from './messaging/index.js';
import type { ComposeState } from './messaging/index.js';

export default function MessageCenter({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [thread, setThread] = useState<AgentMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterAgentId, setFilterAgentId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread'>('all');
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyState, setReplyState] = useState<Partial<ComposeState>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [msgOffset, setMsgOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const data = await fetchProjectAgents(projectId);
      setAgents(data);
    } catch {
      // silently ignore
    }
  }, [projectId]);

  const loadMessages = useCallback(async () => {
    try {
      const hasFilters = filterAgentId !== null || statusFilter === 'unread';
      if (hasFilters) {
        const data = await fetchProjectMessages(
          projectId,
          filterAgentId ?? undefined,
          statusFilter === 'unread' ? 'unread' : undefined,
        );
        setMessages(data);
        setHasMore(false);
        setTotal(data.length);
        setMsgOffset(data.length);
      } else {
        const result = await fetchProjectMessagesPaginated(projectId, PAGE_SIZE, 0);
        setMessages(result.data);
        setTotal(result.total);
        setMsgOffset(PAGE_SIZE);
        setHasMore(result.data.length < result.total);
      }
    } catch {
      // silently ignore
    } finally {
      setLoadingMessages(false);
    }
  }, [projectId, filterAgentId, statusFilter]);

  const handleLoadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchProjectMessagesPaginated(projectId, PAGE_SIZE, msgOffset);
      setMessages((prev) => [...prev, ...result.data]);
      setMsgOffset((prev) => prev + PAGE_SIZE);
      setHasMore(messages.length + result.data.length < result.total);
    } catch {
      // silently ignore
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, msgOffset, hasMore, loadingMore, messages.length]);

  const loadUnreadCounts = useCallback(async () => {
    try {
      const counts = await fetchAllUnreadCounts(projectId);
      setUnreadCounts(counts);
    } catch {
      // silently ignore
    }
  }, [projectId]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (agents.length === 0) return;
    loadMessages();
    loadUnreadCounts();
  }, [agents, loadMessages, loadUnreadCounts]);

  useEffect(() => {
    setLoadingMessages(true);
    loadMessages();
  }, [filterAgentId, statusFilter, loadMessages]);

  const { isWsActive } = useWsEventRefresh(projectId, MESSAGE_CENTER_WS_EVENTS, () => {
    loadMessages();
    loadUnreadCounts();
  }, { debounceMs: 500 });

  useEffect(() => {
    if (isWsActive) return;
    pollRef.current = setInterval(() => {
      loadMessages();
      loadUnreadCounts();
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isWsActive, loadMessages, loadUnreadCounts]);

  const handleSelectMessage = useCallback(
    async (msg: AgentMessage) => {
      setSelectedId(msg.id);
      setLoadingThread(true);
      try {
        setThread([msg]);
        const threadData = await fetchMessageThread(projectId, msg.id);
        setThread(threadData.length > 0 ? threadData : [msg]);

        if (msg.status === 'unread') {
          await markMessageRead(projectId, msg.id);
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, status: 'read' } : m)),
          );
          loadUnreadCounts();
        }
      } catch {
        // silently ignore
      } finally {
        setLoadingThread(false);
      }
    },
    [projectId, loadUnreadCounts],
  );

  const handleArchive = useCallback(
    async (e: React.MouseEvent, msg: AgentMessage) => {
      e.stopPropagation();
      try {
        await archiveAgentMessage(projectId, msg.id);
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        if (selectedId === msg.id) {
          setSelectedId(null);
          setThread([]);
        }
      } catch {
        // silently ignore
      }
    },
    [projectId, selectedId],
  );

  const handleSend = useCallback(
    async (data: SendMessageData) => {
      setSending(true);
      try {
        const sent = await sendAgentMessage(projectId, data);
        setMessages((prev) => [sent, ...prev]);
        loadUnreadCounts();
      } catch {
        // silently ignore
      } finally {
        setSending(false);
      }
    },
    [projectId, loadUnreadCounts],
  );

  const handleBroadcast = useCallback(
    async (data: Omit<SendMessageData, 'toAgentId'>) => {
      setSending(true);
      try {
        await broadcastMessage(projectId, {
          fromAgentId: data.fromAgentId,
          type: data.type,
          subject: data.subject,
          content: data.content,
        });
        loadMessages();
        loadUnreadCounts();
      } catch {
        // silently ignore
      } finally {
        setSending(false);
      }
    },
    [projectId, loadMessages, loadUnreadCounts],
  );

  const handleReply = useCallback((msg: AgentMessage) => {
    setReplyState({
      toAgentId: msg.fromAgentId,
      fromAgentId: msg.toAgentId,
      type: msg.type,
      subject: `Re: ${msg.subject}`,
      parentMessageId: msg.id,
    });
  }, []);

  const totalUnread = messages.filter((m) => m.status === 'unread').length;
  const selectedMessage = messages.find((m) => m.id === selectedId);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Top bar: filters */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#262626] bg-[#0d0d0d]">
        <div className="flex items-center gap-1.5">
          <MessageSquare size={14} className="text-[#525252]" />
          <span className="text-[12px] font-medium text-[#737373]">Mesaj Merkezi</span>
          {totalUnread > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e] text-[#0a0a0a]">
              {totalUnread}
            </span>
          )}
        </div>

        <div className="flex items-center bg-[#111111] border border-[#262626] rounded-lg p-0.5 ml-auto">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-[#1f1f1f] text-[#fafafa]'
                : 'text-[#525252] hover:text-[#a3a3a3]'
            }`}
          >
            Tümü
          </button>
          <button
            onClick={() => setStatusFilter('unread')}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              statusFilter === 'unread'
                ? 'bg-[#1f1f1f] text-[#fafafa]'
                : 'text-[#525252] hover:text-[#a3a3a3]'
            }`}
          >
            Okunmamış
          </button>
        </div>

        <button
          onClick={() => { setLoadingMessages(true); loadMessages(); loadUnreadCounts(); }}
          className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
          title="Yenile"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: agent list */}
        <div className="w-[180px] shrink-0 border-r border-[#262626] flex flex-col bg-[#0d0d0d] overflow-y-auto">
          <button
            onClick={() => setFilterAgentId(null)}
            className={`flex items-center gap-2 px-3 py-2.5 border-b border-[#1a1a1a] transition-colors ${
              filterAgentId === null
                ? 'bg-[#1a1a1a] text-[#fafafa]'
                : 'text-[#737373] hover:bg-[#141414] hover:text-[#a3a3a3]'
            }`}
          >
            <Inbox size={13} />
            <span className="text-[11px] font-medium flex-1 text-left">Tüm Mesajlar</span>
            {totalUnread > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20">
                {totalUnread}
              </span>
            )}
          </button>

          {agents.map((agent) => {
            const count = unreadCounts[agent.id] ?? 0;
            const isActive = filterAgentId === agent.id;
            return (
              <button
                key={agent.id}
                onClick={() => setFilterAgentId(isActive ? null : agent.id)}
                className={`flex items-center gap-2 px-3 py-2.5 border-b border-[#1a1a1a] transition-colors ${
                  isActive
                    ? 'bg-[#1a1a1a] text-[#fafafa]'
                    : 'text-[#737373] hover:bg-[#141414] hover:text-[#a3a3a3]'
                }`}
              >
                <div className="relative shrink-0">
                  <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="xs" />
                  {count > 0 && (
                    <span
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#22c55e] text-[#0a0a0a] text-[8px] font-bold flex items-center justify-center"
                    >
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-medium flex-1 text-left truncate">
                  {agent.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Middle: message list */}
        <div className="w-[280px] shrink-0 border-r border-[#262626] flex flex-col overflow-hidden">
          {loadingMessages ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={16} className="text-[#525252] animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <MessageSquare size={24} className="text-[#333]" />
              <p className="text-[11px] text-[#525252]">Mesaj yok</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto flex flex-col">
              {messages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  agents={agents}
                  isSelected={selectedId === msg.id}
                  onClick={() => handleSelectMessage(msg)}
                  onArchive={(e) => handleArchive(e, msg)}
                />
              ))}
              {hasMore && (
                <button
                  onClick={handleLoadMoreMessages}
                  disabled={loadingMore}
                  className="w-full py-2 text-sm text-gray-400 hover:text-white bg-[#1a1a1a] border border-[#262626] rounded-lg hover:bg-[#222] transition-colors mx-0 mt-1"
                >
                  {loadingMore ? 'Loading...' : `Load more (${messages.length} of ${total})`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: thread view */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedMessage ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[#262626] bg-[#0d0d0d]">
                <div className="flex-1 min-w-0">
                  <h3 className="text-[13px] font-semibold text-[#fafafa] truncate">
                    {selectedMessage.subject}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <TypeBadge type={selectedMessage.type} />
                    <span className="text-[10px] text-[#525252]">
                      {thread.length} mesaj
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedId(null); setThread([]); }}
                  className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
                >
                  <X size={13} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <ThreadView
                  messages={thread}
                  agents={agents}
                  loading={loadingThread}
                  onReply={handleReply}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <MessageSquare size={32} className="text-[#333]" />
              <p className="text-[12px] text-[#525252]">Bir mesaj seçin</p>
            </div>
          )}
        </div>
      </div>

      <ComposeBar
        agents={agents}
        initial={replyState}
        onSend={handleSend}
        onBroadcast={handleBroadcast}
        onClearReply={() => setReplyState({})}
        sending={sending}
      />
    </div>
  );
}
