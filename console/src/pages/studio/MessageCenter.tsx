// ---------------------------------------------------------------------------
// Oscorpex — Mesaj Merkezi (Message Center) Bileşeni
// Ajanlararası mesajlaşmayı yönetir: gelen kutusu, thread, mesaj gönderme
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Archive,
  ChevronDown,
  Radio,
  Loader2,
  RefreshCw,
  X,
  Reply,
  Inbox,
} from 'lucide-react';
import {
  fetchProjectAgents,
  fetchProjectMessages,
  fetchMessageThread,
  sendAgentMessage,
  markMessageRead,
  archiveAgentMessage,
  broadcastMessage,
  fetchUnreadCount,
  type ProjectAgent,
  type AgentMessage,
  type AgentMessageType,
  type SendMessageData,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

// ---- Sabitler -----------------------------------------------------------

// Mesaj türü rozet renkleri ve etiketleri
const TYPE_CONFIG: Record<
  AgentMessageType,
  { label: string; bg: string; text: string; border: string }
> = {
  task_assignment: {
    label: 'Görev',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
  },
  task_complete: {
    label: 'Tamamlandı',
    bg: 'bg-[#22c55e]/10',
    text: 'text-[#22c55e]',
    border: 'border-[#22c55e]/20',
  },
  review_request: {
    label: 'İnceleme',
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/20',
  },
  bug_report: {
    label: 'Bug',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
  },
  feedback: {
    label: 'Feedback',
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    border: 'border-purple-500/20',
  },
  notification: {
    label: 'Notification',
    bg: 'bg-[#525252]/10',
    text: 'text-[#737373]',
    border: 'border-[#525252]/20',
  },
  standup: {
    label: 'Standup',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    border: 'border-cyan-500/20',
  },
  retrospective: {
    label: 'Retro',
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-400',
    border: 'border-indigo-500/20',
  },
  conflict: {
    label: 'Çatışma',
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/20',
  },
  help_request: {
    label: 'Yardım',
    bg: 'bg-pink-500/10',
    text: 'text-pink-400',
    border: 'border-pink-500/20',
  },
  pair_session: {
    label: 'Pair',
    bg: 'bg-teal-500/10',
    text: 'text-teal-400',
    border: 'border-teal-500/20',
  },
  handoff_doc: {
    label: 'Devir',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
  },
};

// Tüm mesaj türleri listesi
const MESSAGE_TYPES: AgentMessageType[] = [
  'task_assignment',
  'task_complete',
  'review_request',
  'bug_report',
  'feedback',
  'notification',
  'standup',
  'retrospective',
  'conflict',
  'help_request',
  'pair_session',
  'handoff_doc',
];

// ---- Yardımcı Fonksiyonlar -----------------------------------------------

// Zamanı kısaltılmış formatta göster (ör: "2d önce")
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes}d`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}s`;
  const days = Math.floor(hours / 24);
  return `${days}g`;
}

// Ajan adını ID'den bul
function agentName(agents: ProjectAgent[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? id;
}

// ---- Alt Bileşenler -------------------------------------------------------

// Mesaj türü rozeti
function TypeBadge({ type }: { type: AgentMessageType }) {
  const cfg = TYPE_CONFIG[type];
  return (
    <span
      className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}

// Ajan avatarı (profil fotoğrafı + renkli sol kenar)
function AgentAvatar({
  agents,
  agentId,
  size = 'sm',
}: {
  agents: ProjectAgent[];
  agentId: string;
  size?: 'sm' | 'md';
}) {
  const agent = agents.find((a) => a.id === agentId);
  const avatar = agent?.avatar ?? '?';
  const name = agent?.name ?? agentId;
  const color = agent?.color ?? '#525252';
  return (
    <div
      className="rounded-lg shrink-0 border border-[#262626]"
      style={{ borderLeftColor: color, borderLeftWidth: 2 }}
    >
      <AgentAvatarImg avatar={avatar} name={name} size={size === 'sm' ? 'sm' : 'md'} />
    </div>
  );
}

// ---- Mesaj Listesi Satırı ------------------------------------------------

function MessageRow({
  msg,
  agents,
  isSelected,
  onClick,
  onArchive,
}: {
  msg: AgentMessage;
  agents: ProjectAgent[];
  isSelected: boolean;
  onClick: () => void;
  onArchive: (e: React.MouseEvent) => void;
}) {
  const isUnread = msg.status === 'unread';

  return (
    <div
      onClick={onClick}
      className={`group flex items-start gap-3 px-4 py-3 border-b border-[#1a1a1a] cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[#1a1a1a] border-l-2 border-l-[#22c55e]'
          : 'hover:bg-[#141414]'
      } ${isUnread ? 'border-l-2 border-l-[#22c55e]' : ''}`}
    >
      {/* Gönderen avatar */}
      <AgentAvatar agents={agents} agentId={msg.fromAgentId} />

      {/* İçerik */}
      <div className="flex-1 min-w-0">
        {/* Üst satır: konu ve zaman */}
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-[12px] font-medium truncate flex-1 ${
              isUnread ? 'text-[#fafafa]' : 'text-[#a3a3a3]'
            }`}
          >
            {msg.subject}
          </span>
          <span className="text-[10px] text-[#525252] shrink-0">{timeAgo(msg.createdAt)}</span>
        </div>

        {/* Alt satır: gönderen -> alıcı + tür */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-[#737373]">
            {agentName(agents, msg.fromAgentId)}
          </span>
          <span className="text-[10px] text-[#525252]">-&gt;</span>
          <span className="text-[10px] text-[#737373]">
            {agentName(agents, msg.toAgentId)}
          </span>
          <TypeBadge type={msg.type} />
          {isUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] shrink-0" />
          )}
        </div>

        {/* İçerik önizleme */}
        <p className="text-[10px] text-[#525252] mt-0.5 line-clamp-1">{msg.content}</p>
      </div>

      {/* Arşiv butonu (hover'da görünür) */}
      <button
        onClick={onArchive}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#262626] transition-all shrink-0"
        title="Arşivle"
      >
        <Archive size={12} />
      </button>
    </div>
  );
}

// ---- Thread Görünümü -------------------------------------------------------

function ThreadView({
  messages,
  agents,
  loading,
  onReply,
}: {
  messages: AgentMessage[];
  agents: ProjectAgent[];
  loading: boolean;
  onReply: (msg: AgentMessage) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={16} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((msg) => {
        const cfg = TYPE_CONFIG[msg.type];
        return (
          <div
            key={msg.id}
            className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden"
          >
            {/* Mesaj başlığı */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a1a]">
              <AgentAvatar agents={agents} agentId={msg.fromAgentId} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-[#fafafa]">
                    {agentName(agents, msg.fromAgentId)}
                  </span>
                  <span className="text-[10px] text-[#525252]">-&gt;</span>
                  <span className="text-[12px] text-[#a3a3a3]">
                    {agentName(agents, msg.toAgentId)}
                  </span>
                  <TypeBadge type={msg.type} />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-[#fafafa]">{msg.subject}</span>
                  <span className="text-[10px] text-[#525252]">{timeAgo(msg.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={() => onReply(msg)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
              >
                <Reply size={11} />
                Yanıtla
              </button>
            </div>

            {/* Mesaj içeriği */}
            <div className="px-4 py-3">
              <p className="text-[12px] text-[#a3a3a3] leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </p>
            </div>

            {/* Metadata - varsa göster */}
            {msg.metadata && Object.keys(msg.metadata).length > 0 && (
              <div className={`px-4 py-2 border-t border-[#1a1a1a] ${cfg.bg}`}>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(msg.metadata).map(([k, v]) => (
                    <span key={k} className="text-[10px] text-[#525252]">
                      <span className="text-[#737373]">{k}:</span> {String(v)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Compose Alanı --------------------------------------------------------

interface ComposeState {
  fromAgentId: string;
  toAgentId: string;
  type: AgentMessageType;
  subject: string;
  content: string;
  parentMessageId?: string;
}

function ComposeBar({
  agents,
  initial,
  onSend,
  onBroadcast,
  onClearReply,
  sending,
}: {
  agents: ProjectAgent[];
  initial?: Partial<ComposeState>;
  onSend: (data: SendMessageData) => Promise<void>;
  onBroadcast: (data: Omit<SendMessageData, 'toAgentId'>) => Promise<void>;
  onClearReply: () => void;
  sending: boolean;
}) {
  // Compose alanı durumu
  const [form, setForm] = useState<ComposeState>({
    fromAgentId: agents[0]?.id ?? '',
    toAgentId: agents[1]?.id ?? '',
    type: 'notification',
    subject: '',
    content: '',
    ...initial,
  });
  const [expanded, setExpanded] = useState(false);

  // initial değişince formu güncelle (yanıt senaryosu)
  useEffect(() => {
    if (initial && Object.keys(initial).length > 0) {
      setForm((prev) => ({ ...prev, ...initial }));
      setExpanded(true);
    }
  }, [initial]);

  // Ajan listesi değişince boş alanları doldur
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
    // Formu sıfırla
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
      {/* Compose başlığı - tıklanınca açılır */}
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

      {/* Genişletilmiş form */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Yanıt modu göstergesi */}
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

          {/* Seçici satırı: Kimden, Kime, Tür */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Kimden */}
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

            {/* Kime */}
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

            {/* Mesaj türü */}
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

          {/* Konu satırı */}
          <input
            type="text"
            value={form.subject}
            onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
            placeholder="Konu..."
            className="w-full px-3 py-1.5 rounded-lg bg-[#111111] border border-[#262626] text-[12px] text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50"
          />

          {/* İçerik alanı */}
          <textarea
            value={form.content}
            onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
            placeholder="Mesaj içeriği..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-[#111111] border border-[#262626] text-[12px] text-[#a3a3a3] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]/50 resize-none"
          />

          {/* Aksiyon butonları */}
          <div className="flex items-center gap-2 justify-end">
            {/* Yayın yap */}
            <button
              onClick={handleBroadcast}
              disabled={sending || !form.fromAgentId || !form.subject.trim() || !form.content.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-[#262626] text-[#737373] hover:text-[#a3a3a3] hover:border-[#333] disabled:opacity-40 transition-colors"
            >
              <Radio size={12} />
              Tüme Yayınla
            </button>

            {/* Gönder */}
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

// ---- Ana Bileşen ----------------------------------------------------------

export default function MessageCenter({ projectId }: { projectId: string }) {
  // Ajan listesi
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  // Tüm mesajlar
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  // Seçili mesaj thread'i
  const [thread, setThread] = useState<AgentMessage[]>([]);
  // Seçili mesaj ID
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Seçili ajan filtresi (sidebar'dan tıklanınca)
  const [filterAgentId, setFilterAgentId] = useState<string | null>(null);
  // Durum filtresi
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread'>('all');
  // Okunmamış sayıları (ajan ID -> sayı)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  // Yükleme durumları
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  // Yanıt compose durumu
  const [replyState, setReplyState] = useState<Partial<ComposeState>>({});
  // Polling referansı
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ajanları yükle
  const loadAgents = useCallback(async () => {
    try {
      const data = await fetchProjectAgents(projectId);
      setAgents(data);
    } catch {
      // hata sessizce geçilir
    }
  }, [projectId]);

  // Mesajları yükle
  const loadMessages = useCallback(async () => {
    try {
      const data = await fetchProjectMessages(
        projectId,
        filterAgentId ?? undefined,
        statusFilter === 'unread' ? 'unread' : undefined,
      );
      setMessages(data);
    } catch {
      // hata sessizce geçilir
    } finally {
      setLoadingMessages(false);
    }
  }, [projectId, filterAgentId, statusFilter]);

  // Okunmamış sayıları yükle (tüm ajanlar için)
  const loadUnreadCounts = useCallback(async () => {
    try {
      const counts: Record<string, number> = {};
      await Promise.all(
        agents.map(async (a) => {
          try {
            const res = await fetchUnreadCount(projectId, a.id);
            counts[a.id] = res.unreadCount;
          } catch {
            counts[a.id] = 0;
          }
        }),
      );
      setUnreadCounts(counts);
    } catch {
      // hata sessizce geçilir
    }
  }, [projectId, agents]);

  // İlk yükleme
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Ajan listesi gelince sayıları ve mesajları yükle
  useEffect(() => {
    if (agents.length === 0) return;
    loadMessages();
    loadUnreadCounts();
  }, [agents, loadMessages, loadUnreadCounts]);

  // Filtre değişince mesajları yeniden yükle
  useEffect(() => {
    setLoadingMessages(true);
    loadMessages();
  }, [filterAgentId, statusFilter, loadMessages]);

  // 5 saniyede bir polling
  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadMessages();
      loadUnreadCounts();
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadMessages, loadUnreadCounts]);

  // Mesaja tıklandığında thread'i yükle ve okundu işaretle
  const handleSelectMessage = useCallback(
    async (msg: AgentMessage) => {
      setSelectedId(msg.id);
      setLoadingThread(true);
      try {
        // Önce tek mesajı thread olarak göster, sonra tam thread'i getir
        setThread([msg]);
        const threadData = await fetchMessageThread(projectId, msg.id);
        setThread(threadData.length > 0 ? threadData : [msg]);

        // Okunmamışsa okundu işaretle
        if (msg.status === 'unread') {
          await markMessageRead(projectId, msg.id);
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, status: 'read' } : m)),
          );
          // Sayaçları güncelle
          loadUnreadCounts();
        }
      } catch {
        // hata sessizce geçilir
      } finally {
        setLoadingThread(false);
      }
    },
    [projectId, loadUnreadCounts],
  );

  // Mesajı arşivle
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
        // hata sessizce geçilir
      }
    },
    [projectId, selectedId],
  );

  // Yeni mesaj gönder
  const handleSend = useCallback(
    async (data: SendMessageData) => {
      setSending(true);
      try {
        const sent = await sendAgentMessage(projectId, data);
        setMessages((prev) => [sent, ...prev]);
        loadUnreadCounts();
      } catch {
        // hata sessizce geçilir
      } finally {
        setSending(false);
      }
    },
    [projectId, loadUnreadCounts],
  );

  // Tüm ekibe yayın gönder
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
        // hata sessizce geçilir
      } finally {
        setSending(false);
      }
    },
    [projectId, loadMessages, loadUnreadCounts],
  );

  // Yanıt compose alanını hazırla
  const handleReply = useCallback((msg: AgentMessage) => {
    setReplyState({
      toAgentId: msg.fromAgentId,
      fromAgentId: msg.toAgentId,
      type: msg.type,
      subject: `Re: ${msg.subject}`,
      parentMessageId: msg.id,
    });
  }, []);

  // Toplam okunmamış mesaj sayısı
  const totalUnread = messages.filter((m) => m.status === 'unread').length;

  // Seçili mesaj
  const selectedMessage = messages.find((m) => m.id === selectedId);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Üst bar: filtreler */}
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

        {/* Durum filtresi */}
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

        {/* Yenile butonu */}
        <button
          onClick={() => { setLoadingMessages(true); loadMessages(); loadUnreadCounts(); }}
          className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
          title="Yenile"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Ana içerik alanı */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sol kenar çubuğu: ajan listesi */}
        <div className="w-[180px] shrink-0 border-r border-[#262626] flex flex-col bg-[#0d0d0d] overflow-y-auto">
          {/* "Tüm Mesajlar" butonu */}
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

          {/* Ajan listesi */}
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
                {/* Ajan avatarı ve renk göstergesi */}
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

        {/* Orta alan: mesaj listesi */}
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
            <div className="flex-1 overflow-y-auto">
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
            </div>
          )}
        </div>

        {/* Sağ alan: thread görünümü */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedMessage ? (
            <>
              {/* Thread başlığı */}
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

              {/* Thread mesajları */}
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
            // Seçim yapılmamış boş durum
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <MessageSquare size={32} className="text-[#333]" />
              <p className="text-[12px] text-[#525252]">Bir mesaj seçin</p>
            </div>
          )}
        </div>
      </div>

      {/* Alt compose çubuğu */}
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
