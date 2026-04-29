export function formatTime(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	} catch {
		return iso;
	}
}

export function formatEventType(type: string): string {
	return type.replace(':', ': ').replace(/_/g, ' ');
}

export function payloadSummary(payload: Record<string, unknown>): string | null {
	const candidates: (keyof typeof payload)[] = [
		'title',
		'name',
		'message',
		'taskTitle',
		'phaseName',
		'reason',
		'agent',
	];
	for (const key of candidates) {
		const val = payload[key];
		if (typeof val === 'string' && val.trim()) return val.trim();
	}
	return null;
}
