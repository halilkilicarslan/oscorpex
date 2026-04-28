// ---------------------------------------------------------------------------
// Compose Bar
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { MessageSquare, ChevronDown, X, Radio, Send, Loader2, Reply } from 'lucide-react';
import type { AgentMessageType, ProjectAgent, SendMessageData } from '../../../lib/studio-api';
import { TYPE_CONFIG, MESSAGE_TYPES } from './constants.js';

export interface ComposeState {
  fromAgentId: string;
  toAgentId: string;
  type: AgentMessageType;
  subject: string;
  content: string;
  parentMessageId?: string;
}

interface ComposeBarProps {
  agents: ProjectAgent[];
  initial?: Partial<ComposeState>;
  onSend: (data: SendMessageData) => Promise<void>;
  onBroadcast: (data: Omit<SendMessageData, 'toAgentId'>) => Promise<void>;
  onClearReply: () => void;
  sending: boolean;
}

export default function ComposeBar({
  agents,
  initial,
  onSend,
  onBroadcast,
  onClearReply,
  sending,
}: ComposeBarProps) {
  const [form, setForm] = useState<ComposeState>({
    fromAgentId: agents[0]?.id ?? '',
    toAgentId: agents[1]?.id ?? '',
    type: 'notification',
    subject: '',
    content: '',
    ...initial,
  });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (initial && Object.keys(initial).length > 0) {
      setForm((prev) => ({ ...prev, ...initial }));
      setExpanded(true);
    }
  }, [initial]);

  useEffect(() => {
    if (agents.length >= 2) {
      setForm((prev) => ({
        ...prev,
        fromAgentId: prev.fromAgentId || agents[0].id,
        toAgentId: prev.toAgentId || agents[1].id,
      }));
    }
  }, [agents]);

  const canSend = form.fromAgentId && form.toAgentId && form.subject.trim() && form.content.trim();

  const handleSend = async () => {
    if (!canSend) return;
    await onSend({
      fromAgentId: form.fromAgentId,
      toAgentId: form.toAgentId,
      type: form.type,
      subject: form.subject.trim(),
      content: form.content.trim(),
      parentMessageId: form.parentMessageId,
    });
    setForm((prev) => ({ ...prev, subject: '', content: '', parentMessageId: undefined }));
    onClearReply();
  };

  const handleBroadcast = async () => {
    if (!form.fromAgentId || !form.subject.trim() || !form.content.trim()) return;
    await onBroadcast({
      fromAgentId: form.fromAgentId,
      type: form.type,
      subject: form.subject.trim(),
      content: form.content.trim(),
    });
    setForm((prev) => ({ ...prev, subject: '', content: '', parentMessageId: undefined }));
    onClearReply();
  };

  return (
    <div className="border-t border-[#262626] bg-[#0d0d0d]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
      >
        <MessageSquare size={13} />
        <span className="font-medium">Yeni Mesaj Oluştur</span>
        {form.parentMessageId && (
          <span className="text-[10px] text-[#22c55e] bg-[#22c55e]/10 px-1.5 py-0.5 rounded">
            Yanıtlama modu
          </span>
        )}
        <ChevronDown
          size={12}
          className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {form.parentMessageId && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20">
              <Reply size={11} className="text-[#22c55e]" />
              <span className="text-[10px] text-[#22c55e] flex-1">Mesaja yanıt veriliyor</span>
              <button
                onClick={() => {
                  setForm((prev) => ({ ...prev, parentMessageId: undefined }));
                  onClearReply();
                }}
                className="text-[#525252] hover:text-[#a3a3a3]"
              >
                <X size={11} />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={form.fromAgentId}
              onChange={(e) => setForm((prev) => ({ ...prev, fromAgentId: e.target.value }))}
              className="flex-1 min-w-[120px] px-2 py-1.5 rounded-lg bg-[#111111] border border-[#262626] text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e]/50"
            >
              <option value="">Kimden...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <select
              value={form.toAgentId}
              onChange={(e) => setForm((prev) => ({ ...prev, toAgentId: e.target.value }))}
              className="flex-1 min-w-[120px] px-2 py-1.5 rounded-lg bg-[#111111] border border-[#262626] text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e]/50"
            >
              <option value="">Kime...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <select
              value={form.type}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, type: e.target.value as AgentMessageType }))
              }
              className="flex-1 min-w-[120px] px-2 py-1.5 rounded-lg bg-[#111111] border border-[#262626] text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e]/50"
            >
              {MESSAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_CONFIG[t].label}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={form.subject}
            onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
            placeholder="Konu..."
            className="w-full px-3 py-1.5 rounded-lg bg-[#111111] border border-[#262626] text-[12px] text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
          />

          <textarea
            value={form.content}
            onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
            placeholder="Message content..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-[#111111] border border-[#262626] text-[12px] text-[#a3a3a3] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 resize-none"
          />

          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={handleBroadcast}
              disabled={sending || !form.fromAgentId || !form.subject.trim() || !form.content.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-[#262626] text-[#737373] hover:text-[#a3a3a3] hover:border-[#333] disabled:opacity-40 transition-colors"
            >
              <Radio size={12} />
              Tüme Yayınla
            </button>

            <button
              onClick={handleSend}
              disabled={sending || !canSend}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-40 transition-colors"
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Gönder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
