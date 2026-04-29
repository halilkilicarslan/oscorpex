import type { IntakeQuestionCategory } from "../../../lib/studio-api";

export type PipelineToastState =
	| { type: 'success'; message: string }
	| { type: 'warning'; message: string }
	| null;

export const CATEGORY_LABELS: Record<IntakeQuestionCategory, string> = {
	scope: 'Kapsam',
	functional: 'Fonksiyonel',
	nonfunctional: 'Non-functional',
	priority: 'Priority',
	technical: 'Teknik',
	general: 'Genel',
};

export const CATEGORY_COLORS: Record<IntakeQuestionCategory, string> = {
	scope: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20',
	functional: 'text-[#3b82f6] bg-[#3b82f6]/10 border-[#3b82f6]/20',
	nonfunctional: 'text-[#a855f7] bg-[#a855f7]/10 border-[#a855f7]/20',
	priority: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
	technical: 'text-[#06b6d4] bg-[#06b6d4]/10 border-[#06b6d4]/20',
	general: 'text-[#737373] bg-[#1f1f1f] border-[#262626]',
};
