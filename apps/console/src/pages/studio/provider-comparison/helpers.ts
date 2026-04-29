export const COST_SCORES: Record<string, number> = {
	'gpt-4o-mini': 1,
	'gemini-1.5-flash': 1,
	'gemini-2.0-flash': 1,
	'claude-haiku-4-5-20251001': 2,
	'cursor-small': 2,
	'gpt-4o': 5,
	'gemini-1.5-pro': 5,
	'claude-sonnet-4-6': 6,
	'cursor-large': 6,
	o3: 8,
	'claude-opus-4-6': 10,
};

export function getCostScore(providerId: string): number {
	const mapping: Record<string, string> = {
		'claude-code': 'claude-sonnet-4-6',
		codex: 'gpt-4o',
		cursor: 'cursor-large',
		gemini: 'gemini-1.5-pro',
		ollama: 'llama3.2',
	};
	return COST_SCORES[mapping[providerId] ?? ''] ?? 5;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function formatPercent(n: number): string {
	return `${n.toFixed(1)}%`;
}
