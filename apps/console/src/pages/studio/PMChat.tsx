import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, Bot, Sparkles, HelpCircle } from 'lucide-react';
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
} from '../../lib/studio-api';
import PlanPreview from './PlanPreview';
import { usePlannerChat } from '../../contexts/PlannerChatContext';
import {
	PipelineToast,
	MessageBubble,
	StreamingBubble,
	IntakeQuestionCard,
	type PipelineToastState,
} from './pm-chat';

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
	const chat = usePlannerChat(projectId);
	const { messages, plan, streaming, streamText, loaded } = chat;
	const [input, setInput] = useState('');
	const [pipelineToast, setPipelineToast] = useState<PipelineToastState>(null);
	const [pendingQuestions, setPendingQuestions] = useState<IntakeQuestion[]>([]);
	const [intakeBusy, setIntakeBusy] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const prevStreamingRef = useRef(streaming);
	const createPlanPrompt =
		'Using the project intake information and selected team structure, generate the detailed project plan now. If you have enough information, produce the plan-json directly; do not ask unnecessary questions.';

	const refreshIntakeQuestions = useCallback(async () => {
		try {
			const qs = await fetchIntakeQuestions(projectId, 'pending');
			setPendingQuestions(qs);
		} catch {
			// sessiz — arka plan yenilemesi
		}
	}, [projectId]);

	useEffect(() => {
		chat.ensureLoaded();
		refreshIntakeQuestions();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId]);

	useEffect(() => {
		if (prevStreamingRef.current && !streaming) {
			refreshIntakeQuestions();
		}
		prevStreamingRef.current = streaming;
	}, [streaming, refreshIntakeQuestions]);

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
		sendMessage(
			'I have provided the answers. Please continue with the plan or ask any remaining questions in one block.',
		);
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
			if (result.pipeline.started) {
				setPipelineToast({
					type: 'success',
					message: 'Plan approved. Pipeline started automatically — track progress from the Board tab.',
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
			<div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
				{messages.length === 0 && !streaming && (
					<div className="flex-1 flex flex-col items-center justify-center text-center py-12">
						<div className="w-12 h-12 rounded-2xl bg-[#22c55e]/10 flex items-center justify-center mb-3">
							<Bot size={24} className="text-[#22c55e]" />
						</div>
						<h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">Chat with AI Planner</h3>
						<p className="text-[12px] text-[#525252] max-w-sm">
							If intake and team are ready, generate a detailed plan with one click.
						</p>
						<button
							type="button"
							onClick={() => sendMessage(createPlanPrompt)}
							disabled={plannerAvailable === false}
							className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#22c55e] px-4 py-2.5 text-[13px] font-medium text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
						>
							<Sparkles size={14} />
							Generate Plan
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

				{plan && (
					<div className="mt-2">
						<PlanPreview plan={plan} projectId={projectId} onApprove={handleApprove} onReject={handleReject} />
					</div>
				)}

				{pipelineToast && <PipelineToast toast={pipelineToast} onClose={() => setPipelineToast(null)} />}

				<div ref={bottomRef} />
			</div>

			<div className="px-6 py-4 border-t border-[#262626]">
				{plannerAvailable === false && (
					<div className="mb-3 bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] rounded-lg px-4 py-2 text-[12px]">
						Planner kullanılamıyor. Desteklenen CLI araçlarından en az biri kurulu olmalı: Claude, Codex
						veya Gemini.
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
							Hazırsan planner'dan ayrıntılı planı üretmesini iste.
						</div>
						<button
							type="button"
							onClick={() => sendMessage(createPlanPrompt)}
							disabled={plannerAvailable === false}
							className="inline-flex items-center gap-2 rounded-xl bg-[#22c55e]/10 px-3 py-2 text-[12px] font-medium text-[#22c55e] hover:bg-[#22c55e]/20 disabled:opacity-40"
						>
							<Sparkles size={13} />
							Generate Plan
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
						{streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
					</button>
				</div>
			</div>
		</div>
	);
}
