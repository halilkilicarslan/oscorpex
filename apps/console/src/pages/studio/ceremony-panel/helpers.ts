import type { StandupResult, RetroResult } from './types.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export function parseStandup(raw: unknown): StandupResult | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (!Array.isArray(r.agents)) return null;
	return {
		runAt: typeof r.runAt === 'string' ? r.runAt : undefined,
		agents: r.agents as StandupAgent[],
	};
}

export function parseRetro(raw: unknown): RetroResult | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const data = r.data as Record<string, unknown> | undefined;
	if (!data || !Array.isArray(data.wentWell) || !Array.isArray(data.couldImprove) || !Array.isArray(data.actionItems)) {
		return null;
	}
	return {
		runAt: typeof r.runAt === 'string' ? r.runAt : undefined,
		data: {
			wentWell: data.wentWell as string[],
			couldImprove: data.couldImprove as string[],
			actionItems: data.actionItems as string[],
		},
		agentStats: Array.isArray(r.agentStats) ? (r.agentStats as RetroAgentStat[]) : undefined,
	};
}

export async function fetchCeremony<T>(
	url: string,
	parse: (raw: unknown) => T | null,
	method: 'GET' | 'POST' = 'GET',
): Promise<T | null> {
	try {
		const res = await fetch(url, { method });
		if (!res.ok) return null;
		const body = await res.json();
		return parse(body);
	} catch {
		return null;
	}
}
