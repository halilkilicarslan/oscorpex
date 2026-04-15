import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, Bot, User, AlertCircle, Zap, TriangleAlert, Sparkles, HelpCircle, Check, SkipForward } from 'lucide-react';
import {
  type PlannerReasoningEffort,
  approvePlan,
  rejectPlan,
  fetchPlan,
  fetchIntakeQuestions,
  answerIntakeQuestion,
  skipIntakeQuestion,
  type PlannerChatModel,
  type PlannerCLIProvider,
  type ChatMessage,
  type IntakeQuestion,
  type IntakeQuestionCategory,
} from '../../lib/studio-api';
import PlanPreview from './PlanPreview';
import { usePlannerChat } from '../../contexts/PlannerChatContext';

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
// Intake Questions — interactive Q/A panel (v3.0 B1)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<IntakeQuestionCategory, string> = {
  scope: 'Kapsam',
  functional: 'Fonksiyonel',
  nonfunctional: 'Non-functional',
  priority: 'Öncelik',
  technical: 'Teknik',
  general: 'Genel',
};

const CATEGORY_COLORS: Record<IntakeQuestionCategory, string> = {
  scope: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20',
  functional: 'text-[#3b82f6] bg-[#3b82f6]/10 border-[#3b82f6]/20',
  nonfunctional: 'text-[#a855f7] bg-[#a855f7]/10 border-[#a855f7]/20',
  priority: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
  technical: 'text-[#06b6d4] bg-[#06b6d4]/10 border-[#06b6d4]/20',
  general: 'text-[#737373] bg-[#1f1f1f] border-[#262626]',
};

function IntakeQuestionCard({
  question,
  onAnswer,
  onSkip,
  submitting,
}: {
  question: IntakeQuestion;
  onAnswer: (id: string, answer: string) => Promise<void>;
  onSkip: (id: string) => Promise<void>;
  submitting: boolean;
}) {
  const [customAnswer, setCustomAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const disabled = busy || submitting;

  const submit = async (value: string) => {
    if (!value.trim() || disabled) return;
    setBusy(true);
    try {
      await onAnswer(question.id, value.trim());
      setCustomAnswer('');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (disabled) return;
    setBusy(true);
    try {
      await onSkip(question.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#262626] bg-[#0d0d0d] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-[#3b82f6]/10 flex items-center justify-center shrink-0">
          <HelpCircle size={14} className="text-[#3b82f6]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[question.category]}`}
            >
              {CATEGORY_LABELS[question.category]}
            </span>
          </div>
          <p className="text-[13px] text-[#e5e5e5] leading-relaxed">{question.question}</p>
        </div>
      </div>

      {question.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-10">
          {question.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => submit(opt)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#262626] text-[12px] text-[#d4d4d4] hover:bg-[#22c55e]/10 hover:border-[#22c55e]/30 hover:text-[#22c55e] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pl-10">
        <input
          type="text"
          value={customAnswer}
          onChange={(e) => setCustomAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(customAnswer);
            }
          }}
          placeholder={question.options.length > 0 ? 'Veya kendi cevabını yaz...' : 'Cevabını yaz...'}
          disabled={disabled}
          className="flex-1 px-3 py-1.5 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[12px] text-[#fafafa] placeholder-[#525252] focus:border-[#3b82f6] focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!customAnswer.trim() || disabled}
          onClick={() => submit(customAnswer)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 hover:bg-[#22c55e]/20 text-[12px] font-medium disabled:opacity-30 disabled:cursor-not-allowed"
          title="Cevabı gönder"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={skip}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-[#737373] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] disabled:opacity-40"
          title="Bu soruyu atla"
        >
          <SkipForward size={11} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PMChat({
  projectId,
  plannerAvailable,
  selectedProvider,
  selectedModel,
  selectedEffort,
}: {
  projectId: string;
  plannerAvailable: boolean | null;
  selectedProvider: PlannerCLIProvider;
  selectedModel: PlannerChatModel;
  selectedEffort: PlannerReasoningEffort | null;
}) {
  // Sayfa gecisleri arasinda korunan chat state
  const chat = usePlannerChat(projectId);
  const { messages, plan, streaming, streamText, loaded } = chat;
  const [input, setInput] = useState('');
  const [pipelineToast, setPipelineToast] = useState<PipelineToastState>(null);
  const [pendingQuestions, setPendingQuestions] = useState<IntakeQuestion[]>([]);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef(streaming);
  const createPlanPrompt =
    'Proje intake bilgilerini ve seçilmiş takım yapısını kullanarak detaylı proje planını şimdi oluştur. Bilgi yeterliyse doğrudan plan-json üret; gereksiz soru sorma.';

  const refreshIntakeQuestions = useCallback(async () => {
    try {
      const qs = await fetchIntakeQuestions(projectId, 'pending');
      setPendingQuestions(qs);
    } catch {
      // sessiz — arka plan yenilemesi
    }
  }, [projectId]);

  // Ilk girişte backend'den yükle (context zaten yüklenmişse no-op)
  useEffect(() => {
    chat.ensureLoaded();
    refreshIntakeQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Streaming bittiğinde: backend askuser-json parse etmiş olabilir, yenile
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      refreshIntakeQuestions();
    }
    prevStreamingRef.current = streaming;
  }, [streaming, refreshIntakeQuestions]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText, pendingQuestions]);

  const handleIntakeAnswer = useCallback(
    async (id: string, answer: string) => {
      setIntakeBusy(true);
      try {
        await answerIntakeQuestion(projectId, id, answer);
        const remaining = await fetchIntakeQuestions(projectId, 'pending');
        setPendingQuestions(remaining);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Cevap kaydedilemedi';
        chat.appendMessage({
          id: `error-${Date.now()}`,
          projectId,
          role: 'assistant',
          content: `⚠️ ${msg}`,
          createdAt: new Date().toISOString(),
        } as ChatMessage);
      } finally {
        setIntakeBusy(false);
      }
    },
    [projectId, chat],
  );

  const handleIntakeSkip = useCallback(
    async (id: string) => {
      setIntakeBusy(true);
      try {
        await skipIntakeQuestion(projectId, id);
        const remaining = await fetchIntakeQuestions(projectId, 'pending');
        setPendingQuestions(remaining);
      } finally {
        setIntakeBusy(false);
      }
    },
    [projectId],
  );

  const continuePlanningWithAnswers = () => {
    if (streaming) return;
    sendMessage('Cevapları verdim, lütfen plana devam et veya eksik bilgi varsa tek blokta sor.');
  };

  const sendMessage = (prefilledText?: string) => {
    const text = (prefilledText ?? input).trim();
    if (!text || streaming) return;

    if (!prefilledText) {
      setInput('');
    }

    chat.sendMessage(text, {
      provider: selectedProvider,
      model: selectedModel,
      effort: selectedEffort,
    });
  };

  const handleApprove = async () => {
    try {
      const result = await approvePlan(projectId);
      const updated = await fetchPlan(projectId);
      chat.setPlan(updated);
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
      chat.appendMessage({
        id: `error-${Date.now()}`,
        projectId,
        role: 'assistant',
        content: `⚠️ Plan onaylama hatası: ${msg}`,
        createdAt: new Date().toISOString(),
      } as ChatMessage);
    }
  };

  const handleReject = async (feedback?: string) => {
    try {
      await rejectPlan(projectId, feedback);
      const updated = await fetchPlan(projectId).catch(() => null);
      chat.setPlan(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reject plan';
      chat.appendMessage({
        id: `error-${Date.now()}`,
        projectId,
        role: 'assistant',
        content: `⚠️ Plan reddetme hatası: ${msg}`,
        createdAt: new Date().toISOString(),
      } as ChatMessage);
    }
  };

  if (!loaded) {
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
              Project intake ve takım hazırsa planner’dan tek tıkla detaylı plan oluşturabilirsin.
            </p>
            <button
              type="button"
              onClick={() => sendMessage(createPlanPrompt)}
              disabled={plannerAvailable === false}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#22c55e] px-4 py-2.5 text-[13px] font-medium text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Sparkles size={14} />
              Planı Oluştur
            </button>
            <p className="mt-2 text-[11px] text-[#525252]">
              Sonrasında gerekiyorsa aynı ekrandan plan güncellemesi isteyebilirsin.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {streaming && <StreamingBubble text={streamText} />}

        {/* Intake questions panel (v3.0 B1) */}
        {pendingQuestions.length > 0 && !streaming && (
          <div className="mt-1 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-[#3b82f6] uppercase tracking-wide">
              <HelpCircle size={12} />
              Planner cevap bekliyor ({pendingQuestions.length})
            </div>
            {pendingQuestions.map((q) => (
              <IntakeQuestionCard
                key={q.id}
                question={q}
                onAnswer={handleIntakeAnswer}
                onSkip={handleIntakeSkip}
                submitting={intakeBusy}
              />
            ))}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3">
              <div className="text-[11px] text-[#737373]">
                Tüm soruları cevapladıktan sonra plana devam etmek için aşağıdaki butonu kullan.
              </div>
              <button
                type="button"
                onClick={continuePlanningWithAnswers}
                disabled={streaming || plannerAvailable === false}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#22c55e]/10 px-3 py-1.5 text-[11px] font-medium text-[#22c55e] border border-[#22c55e]/20 hover:bg-[#22c55e]/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={12} />
                Devam Et
              </button>
            </div>
          </div>
        )}

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
        {plannerAvailable === false && (
          <div className="mb-3 bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] rounded-lg px-4 py-2 text-[12px]">
            Planner kullanılamıyor. Desteklenen CLI araçlarından en az biri kurulu olmalı: Claude, Codex veya Gemini.
          </div>
        )}
        <div className="mb-3 rounded-xl border border-[#262626] bg-[#0a0a0a] px-4 py-3 text-[12px] text-[#737373]">
          Planner provider: <span className="font-medium text-[#fafafa]">{selectedProvider}</span>
          {' · '}
          model: <span className="font-medium text-[#fafafa]">{selectedModel}</span>
          {selectedEffort ? (
            <>
              {' · '}
              effort: <span className="font-medium text-[#fafafa]">{selectedEffort}</span>
            </>
          ) : null}
        </div>
        {!plan && messages.length > 0 && !streaming && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3">
            <div className="text-[12px] text-[#737373]">
              Hazırsan planner’dan ayrıntılı planı üretmesini iste.
            </div>
            <button
              type="button"
              onClick={() => sendMessage(createPlanPrompt)}
              disabled={plannerAvailable === false}
              className="inline-flex items-center gap-2 rounded-xl bg-[#22c55e]/10 px-3 py-2 text-[12px] font-medium text-[#22c55e] hover:bg-[#22c55e]/20 disabled:opacity-40"
            >
              <Sparkles size={13} />
              Planı Oluştur
            </button>
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
            disabled={streaming || plannerAvailable === false}
            className="flex-1 px-4 py-2.5 bg-[#0a0a0a] border border-[#262626] rounded-xl text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || streaming || plannerAvailable === false}
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
