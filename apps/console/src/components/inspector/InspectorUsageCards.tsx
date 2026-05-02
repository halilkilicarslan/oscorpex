import type { InspectorUsageSummary, InspectorExecutionSummary } from '../../lib/studio-api/inspector';

export function InspectorUsageCards({
	usage,
	execution,
}: {
	usage?: InspectorUsageSummary;
	execution?: InspectorExecutionSummary;
}) {
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<Card label="Total Tokens" value={usage ? formatNumber(usage.totalTokens) : 'N/A'} />
			<Card label="Cost" value={usage ? `$${usage.costUsd.toFixed(4)}` : 'N/A'} />
			<Card label="Provider" value={execution?.provider ?? 'N/A'} />
			<Card label="Model" value={execution?.model ?? 'N/A'} />
			{usage && (
				<>
					<Card label="Input Tokens" value={formatNumber(usage.inputTokens)} />
					<Card label="Output Tokens" value={formatNumber(usage.outputTokens)} />
					<Card label="Cache Read" value={formatNumber(usage.cacheReadTokens)} />
					<Card label="Cache Write" value={formatNumber(usage.cacheWriteTokens)} />
				</>
			)}
			{execution?.latencyMs != null && (
				<Card label="Latency" value={`${(execution.latencyMs / 1000).toFixed(1)}s`} />
			)}
			{execution?.failureClassification && (
				<Card label="Failure" value={execution.failureClassification} error />
			)}
		</div>
	);
}

function Card({ label, value, error }: { label: string; value: string; error?: boolean }) {
	return (
		<div className="rounded-lg border border-[#262626] bg-[#141414] p-3">
			<div className="text-xs text-[#737373]">{label}</div>
			<div className={`mt-1 text-sm font-medium ${error ? 'text-red-400' : 'text-white'}`}>
				{value}
			</div>
		</div>
	);
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export default InspectorUsageCards;
