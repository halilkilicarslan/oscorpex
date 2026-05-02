import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Send, MessageSquare } from 'lucide-react';
import { httpGet, httpPost } from '../../lib/studio-api/base.js';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'agent';
  content: string;
  createdAt: string;
}

interface Props {
  projectId: string;
  agentId: string;
  agentName: string;
}

export default function AgentChat({ projectId, agentId, agentName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    httpGet<{ messages?: ChatMessage[] } | ChatMessage[]>(`/api/studio/projects/${projectId}/agents/${agentId}/chat`)
      .then((data) => setMessages(Array.isArray(data) ? data : (data.messages ?? [])))
      .catch((err) => console.error("[AgentChat] Failed to load messages:", err))
      .finally(() => setLoading(false));
  }, [projectId, agentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    setSending(true);

    try {
      const data = await httpPost<{
        messages?: ChatMessage[];
        userMessageId?: string;
        reply?: string;
        replyId?: string;
      }>(`/api/studio/projects/${projectId}/agents/${agentId}/chat`, { message: text });
      // Replace optimistic + add reply
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== optimistic.id);
        const updated: ChatMessage[] = data.messages ?? [...without, { ...optimistic, id: data.userMessageId ?? optimistic.id }];
        if (data.reply) {
          updated.push({
            id: data.replyId ?? `reply-${Date.now()}`,
            role: 'agent',
            content: data.reply,
            createdAt: new Date().toISOString(),
          });
        }
        return updated;
      });
    } catch {
      // Keep optimistic message on error
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Agent header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a1a] bg-[#111111]">
        <div className="w-8 h-8 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/30 flex items-center justify-center text-[13px] font-bold text-[#22c55e] shrink-0">
          {agentName.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-[13px] font-semibold text-[#fafafa]">{agentName}</p>
          <p className="text-[10px] text-[#525252]">Agent Chat</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
          <span className="text-[10px] text-[#525252]">Online</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare size={28} className="text-[#333] mb-3" />
            <p className="text-[13px] text-[#a3a3a3] mb-1">No messages yet</p>
            <p className="text-[11px] text-[#525252]">Send a message to start chatting with {agentName}.</p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              {!isUser && (
                <div className="w-7 h-7 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/30 flex items-center justify-center text-[11px] font-bold text-[#22c55e] shrink-0 mt-0.5">
                  {agentName.charAt(0).toUpperCase()}
                </div>
              )}

              <div className={`flex flex-col gap-1 max-w-[72%] ${isUser ? 'items-end' : 'items-start'}`}>
                <div
                  className={`px-3 py-2 rounded-xl text-[12px] leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-[#22c55e]/15 border border-[#22c55e]/25 text-[#e5e5e5] rounded-tr-sm'
                      : 'bg-[#111111] border border-[#262626] text-[#d4d4d4] rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
                <span className="text-[10px] text-[#3a3a3a] px-1">{formatTime(msg.createdAt)}</span>
              </div>

              {/* User avatar placeholder */}
              {isUser && (
                <div className="w-7 h-7 rounded-full bg-[#262626] border border-[#333] flex items-center justify-center text-[11px] font-bold text-[#737373] shrink-0 mt-0.5">
                  U
                </div>
              )}
            </div>
          );
        })}

        {sending && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#22c55e]/20 border border-[#22c55e]/30 flex items-center justify-center text-[11px] font-bold text-[#22c55e] shrink-0">
              {agentName.charAt(0).toUpperCase()}
            </div>
            <div className="bg-[#111111] border border-[#262626] rounded-xl rounded-tl-sm px-3 py-2.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#525252] animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[#525252] animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[#525252] animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#1a1a1a] bg-[#111111] px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}...`}
            rows={1}
            disabled={sending}
            className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[12px] text-[#e5e5e5] placeholder-[#3a3a3a] resize-none focus:outline-none focus:border-[#22c55e]/50 transition-colors disabled:opacity-50 leading-relaxed min-h-[36px] max-h-[120px] overflow-y-auto"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-[#3a3a3a] mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
