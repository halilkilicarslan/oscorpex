// ---------------------------------------------------------------------------
// Shared utilities for control-plane modules
// ---------------------------------------------------------------------------

export function now(): string {
	return new Date().toISOString();
}

export function hoursFromNow(hours: number): string {
	const d = new Date();
	d.setHours(d.getHours() + hours);
	return d.toISOString();
}

export function isExpired(expiresAt: string): boolean {
	return new Date(expiresAt).getTime() <= Date.now();
}
