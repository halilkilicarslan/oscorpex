import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Bot, User, AlertCircle, Zap, TriangleAlert } from 'lucide-react';
import {
  fetchChatHistory,
  fetchPlan,
  approvePlan,
  rejectPlan,
  streamPMChat,
  fetchConfigStatus,
  type ChatMessage,
  type ProjectPlan,
} from '../../lib/studio-api';
import PlanPreview from './PlanPreview';

// ---------------------------------------------------------------------------
// Pipeline auto-start bildirimi
// ---------------------------------------------------------------------------

type PipelineToastState =
  | { type: 'success'; message: string }
  | { type: 'warning'; message: string }
  | null;

function PipelineToast({
  toast,
  onClose,
}: {
  toast: NonNullable<PipelineToastState>;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const isSuccess = toast.type === 'success';

  return (
    <div
      className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border text-[12px] leading-relaxed ${
        isSuccess
          ? 'bg-[#22c55e]/10 border-[#22c55e]/20 text-[#22c55e]'
          : 'bg-[#f59e0b]/10 border-[#f59e0b]/20 text-[#f59e0b]'
      }`}
    >
      {isSuccess ? (
        <Zap size={14} className="shrink-0 mt-0.5" />
      ) : (
        <TriangleAlert size={14} className="shrink-0 mt-0.5" />
      )}
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-1"
        aria-label="Kapat"
      >
        &times;
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isError = message.id.startsWith('error-');

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isError ? 'bg-[#ef4444]/10' : isUser ? 'bg-[#1f1f1f]' : 'bg-[#22c55e]/10'
        }`}
      >
        {isError ? (
          <AlertCircle size={14} className="text-[#ef4444]" />
        ) : isUser ? (
          <User size={14} className="text-[#a3a3a3]" />
        ) : (
          <Bot size={14} className="text-[#22c55e]" />
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
          isError
            ? 'bg-[#ef4444]/10 text-[#fca5a5] border border-[#ef4444]/20 rounded-tl-md'
            : isUser
              ? 'bg-[#22c55e]/10 text-[#e5e5e5] rounded-tr-md'
              : 'bg-[#1a1a1a] text-[#d4d4d4] border border-[#262626] rounded-tl-md'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Streaming indicator
// ---------------------------------------------------------------------------

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-[#22c55e]/10">
        <Bot size={14} className="text-[#22c55e]" />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tl-md px-4 py-2.5 bg-[#1a1a1a] border border-[#262626] text-[13px] leading-relaxed text-[#d4d4d4] whitespace-pre-wrap">
        {text || (
          <span className="flex items-center gap-2 text-[#525252]">
            <Loader2 size={12} className="animate-spin" />
            Thinking...
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PMChat({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [loading, setLoading] = useState(true);
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);
  const [pipelineToast, setPipelineToast] = useState<PipelineToastState>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  // Load history, plan, and config status
  useEffect(() => {
    const load = async () => {
      try {
        const [history, latestPlan, configStatus] = await Promise.allSettled([
          fetchChatHistory(projectId),
          fetchPlan(projectId),
          fetchConfigStatus(),
        ]);
        if (history.status === 'fulfilled') setMessages(history.value);
        if (latestPlan.status === 'fulfilled' && latestPlan.value) {
          setPlan(latestPlan.value);
        }
        if (configStatus.status === 'fulfilled') setOpenaiConfigured(configStatus.value.openaiConfigured);
      } finally {
        setLoading(false);
      }
    };
    load();

    return () => {
      abortRef.current?.();
    };
  }, [projectId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);
    setStreamText('');

    // Optimistically add user message
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      projectId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    let accumulated = '';

    abortRef.current = streamPMChat(
      projectId,
      text,
      (chunk) => {
        accumulated += chunk;
        setStreamText(accumulated);
      },
      () => {
        // Done — add assistant message
        const assistantMsg: ChatMessage = {
          id: `temp-${Date.now()}-assistant`,
          projectId,
          role: 'assistant',
          content: accumulated,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamText('');
        setStreaming(false);
        abortRef.current = null;

        // Refresh plan in case PM agent created/updated one
        fetchPlan(projectId)
          .then((p) => {
            if (p) setPlan(p);
          })
          .catch(() => {});
      },
      (err) => {
        // Hatayı chat mesajı olarak ekle
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          projectId,
          role: 'assistant',
          content: `⚠️ Hata: ${err.message}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        setStreamText('');
        setStreaming(false);
        abortRef.current = null;
      },
    );
  };

  const handleApprove = async () => {
    try {
      const result = await approvePlan(projectId);
      const updated = await fetchPlan(projectId);
      setPlan(updated);
      // Onaylanan plan draft değil, maliyet tahmini artık gösterilmez
      setCostEstimate(null);

      // Pipeline auto-start bildirimini goster
      if (result.pipeline.started) {
        setPipelineToast({
          type: 'success',
          message: 'Plan onaylandı. Pipeline otomatik olarak baslatildi — Board sekmesinden ilerlemeyi takip edebilirsiniz.',
        });
      } else if (result.pipeline.warning) {
        setPipelineToast({
          type: 'warning',
          message: `Plan onaylandı ancak pipeline başlatılamadı: ${result.pipeline.warning}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve plan';
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        projectId,
        role: 'assistant',
        content: `⚠️ Plan onaylama hatası: ${msg}`,
        createdAt: new Date().toISOString(),
      }]);
    }
  };

  const handleReject = async (feedback?: string) => {
    try {
      await rejectPlan(projectId, feedback);
      const updated = await fetchPlan(projectId).catch(() => null);
      setPlan(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reject plan';
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        projectId,
        role: 'assistant',
        content: `⚠️ Plan reddetme hatası: ${msg}`,
        createdAt: new Date().toISOString(),
      }]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {messages.length === 0 && !streaming && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <div className="w-12 h-12 rounded-2xl bg-[#22c55e]/10 flex items-center justify-center mb-3">
              <Bot size={24} className="text-[#22c55e]" />
            </div>
            <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">Chat with AI Planner</h3>
            <p className="text-[12px] text-[#525252] max-w-sm">
              Describe what you want to build and I'll help you create a project plan with phases and tasks.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {streaming && <StreamingBubble text={streamText} />}

        {/* Plan preview */}
        {plan && (
          <div className="mt-2">
            <PlanPreview
              plan={plan}
              projectId={projectId}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          </div>
        )}

        {/* Pipeline auto-start bildirimi */}
        {pipelineToast && (
          <PipelineToast
            toast={pipelineToast}
            onClose={() => setPipelineToast(null)}
          />
        )}

        {/* Legacy error banner — artik hatalar chat mesaji olarak gosteriliyor */}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-[#262626]">
        {openaiConfigured === false && (
          <div className="mb-3 bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] rounded-lg px-4 py-2 text-[12px]">
            OpenAI API key is not configured. Add OPENAI_API_KEY to your .env file to enable the Planner.
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Describe what you want to build..."
            disabled={streaming || openaiConfigured === false}
            className="flex-1 px-4 py-2.5 bg-[#0a0a0a] border border-[#262626] rounded-xl text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming || openaiConfigured === false}
            className="p-2.5 rounded-xl bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {streaming ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
