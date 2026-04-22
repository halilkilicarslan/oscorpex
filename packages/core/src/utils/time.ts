// @oscorpex/core — Time utilities
// ISO timestamp generation and time window helpers.

export function now(): string {
	return new Date().toISOString();
}

export interface TimeWindow {
	start: string;
	end: string;
}

export function isWithinWindow(timestamp: string, window: TimeWindow): boolean {
	const ts = new Date(timestamp).getTime();
	const start = new Date(window.start).getTime();
	const end = new Date(window.end).getTime();
	return ts >= start && ts <= end;
}

export function durationMs(start: string, end: string): number {
	return new Date(end).getTime() - new Date(start).getTime();
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m${seconds % 60}s`;
	return `${seconds}s`;
}