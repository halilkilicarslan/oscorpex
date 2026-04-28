// ---------------------------------------------------------------------------
// Providers Page — Shared Helpers
// ---------------------------------------------------------------------------

import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { PROVIDER_META } from '../settings/provider-meta.js';
import type { AIProviderType } from '../../../lib/studio-api';

export function TypeBadge({ type }: { type: AIProviderType }) {
	const meta = PROVIDER_META[type];
	return (
		<span
			className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#1f1f1f] border border-[#262626] ${meta.color}`}
		>
			{meta.label}
		</span>
	);
}

export type TestState = 'idle' | 'testing' | 'success' | 'failure';

export function TestIndicator({ state, message }: { state: TestState; message?: string }) {
	if (state === 'idle') return null;
	if (state === 'testing') {
		return (
			<span className="flex items-center gap-1 text-[11px] text-[#a3a3a3]">
				<Loader2 size={11} className="animate-spin" />
				Testing...
			</span>
		);
	}
	if (state === 'success') {
		return (
			<span className="flex items-center gap-1 text-[11px] text-[#22c55e]" title={message}>
				<CheckCircle2 size={11} />
				Connected
			</span>
		);
	}
	return (
		<span className="flex items-center gap-1 text-[11px] text-[#ef4444]" title={message}>
			<XCircle size={11} />
			Failed
		</span>
	);
}

export function getFallbackLabel(index: number): { text: string; className: string } {
	if (index === 0) {
		return {
			text: 'Primary',
			className:
				'text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30',
		};
	}
	return {
		text: `Fallback ${index}`,
		className:
			'text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#262626] text-[#737373] border border-[#333]',
	};
}
