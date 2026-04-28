import { Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { QuotaStatus, CLIUsageSnapshot } from '../../lib/studio-api';

export const STATUS_STYLE: Record<QuotaStatus, string> = {
	healthy: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20',
	warning: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
	critical: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/20',
	depleted: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
	unknown: 'text-[#a3a3a3] bg-[#1f1f1f] border-[#262626]',
};

export function fmtTokens(value: number): string {
	if (!value) return '0';
	if (value < 1000) return String(value);
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
	return `${(value / 1_000_000).toFixed(1)}M`;
}

export function fmtMoney(value: number): string {
	return `$${(value || 0).toFixed(2)}`;
}

export function worstStatus(providers: CLIUsageSnapshot[]): QuotaStatus {
	const order: QuotaStatus[] = ['healthy', 'warning', 'critical', 'depleted'];
	const quotas = providers.flatMap((provider) => provider.global?.quotas ?? []);
	if (quotas.length === 0) return 'unknown';
	return (
		quotas
			.map((quota) => quota.status)
			.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? 'unknown'
	);
}

export function statusIcon(status: QuotaStatus) {
	if (status === 'healthy') return <CheckCircle2 size={14} />;
	if (status === 'warning' || status === 'critical') return <AlertTriangle size={14} />;
	if (status === 'depleted') return <XCircle size={14} />;
	return <Activity size={14} />;
}
