import type { HttpMethod } from "../../../lib/studio-api";

export const METHOD_COLORS: Record<HttpMethod, string> = {
	GET: 'text-[#22c55e] bg-[#22c55e]/10',
	POST: 'text-[#3b82f6] bg-[#3b82f6]/10',
	PUT: 'text-[#f59e0b] bg-[#f59e0b]/10',
	PATCH: 'text-[#a855f7] bg-[#a855f7]/10',
	DELETE: 'text-[#ef4444] bg-[#ef4444]/10',
};

export const STATUS_COLORS: Record<string, string> = {
	'2': 'text-[#22c55e]',
	'3': 'text-[#3b82f6]',
	'4': 'text-[#f59e0b]',
	'5': 'text-[#ef4444]',
};

export function statusColor(status: number): string {
	return STATUS_COLORS[String(status)[0]] || 'text-[#737373]';
}

export function formatBody(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}
