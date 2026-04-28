// ---------------------------------------------------------------------------
// Provider Telemetry — Helpers & Constants
// ---------------------------------------------------------------------------

import type { ProviderErrorClassification } from '../../../lib/studio-api';

export const CLASSIFICATION_LABELS: Record<ProviderErrorClassification, string> = {
	unavailable: 'Unavailable',
	timeout: 'Timeout',
	rate_limited: 'Rate Limited',
	killed: 'Killed',
	tool_restriction_unsupported: 'Tool Restriction',
	cli_error: 'CLI Error',
	spawn_failure: 'Spawn Failure',
	unknown: 'Unknown',
};

export const CLASSIFICATION_STYLES: Record<ProviderErrorClassification, string> = {
	unavailable: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
	timeout: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/20',
	rate_limited: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
	killed: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
	tool_restriction_unsupported: 'text-[#a3a3a3] bg-[#1f1f1f] border-[#262626]',
	cli_error: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
	spawn_failure: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
	unknown: 'text-[#737373] bg-[#1f1f1f] border-[#262626]',
};

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleString();
}
