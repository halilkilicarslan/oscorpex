import { useState } from 'react';
import { HelpCircle, Check, SkipForward, Loader2 } from 'lucide-react';
import type { IntakeQuestion } from "../../../lib/studio-api";
import { CATEGORY_LABELS, CATEGORY_COLORS } from './helpers';

interface IntakeQuestionCardProps {
	question: IntakeQuestion;
	onAnswer: (id: string, answer: string) => Promise<void>;
	onSkip: (id: string) => Promise<void>;
	submitting: boolean;
}

export default function IntakeQuestionCard({ question, onAnswer, onSkip, submitting }: IntakeQuestionCardProps) {
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
					placeholder={question.options.length > 0 ? 'Or type your own answer...' : 'Type your answer...'}
					disabled={disabled}
					className="flex-1 px-3 py-1.5 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[12px] text-[#fafafa] placeholder-[#525252] focus:border-[#3b82f6] focus:outline-none disabled:opacity-50"
				/>
				<button
					type="button"
					disabled={!customAnswer.trim() || disabled}
					onClick={() => submit(customAnswer)}
					className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 hover:bg-[#22c55e]/20 text-[12px] font-medium disabled:opacity-30 disabled:cursor-not-allowed"
					title="Send answer"
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
