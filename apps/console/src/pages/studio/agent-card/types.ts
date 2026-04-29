export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export const AGENT_CARD_WS_EVENTS = [
	'agent:output',
	'task:completed',
	'task:started',
	'task:failed',
	'agent:started',
	'agent:stopped',
];

export const STATUS_STYLES: Record<RuntimeStatus, { color: string; label: string }> = {
	idle: { color: 'bg-[#525252]', label: 'Idle' },
	starting: { color: 'bg-[#f59e0b] animate-pulse', label: 'Starting' },
	running: { color: 'bg-[#22c55e] animate-pulse', label: 'Running' },
	stopping: { color: 'bg-[#f59e0b] animate-pulse', label: 'Stopping' },
	stopped: { color: 'bg-[#737373]', label: 'Stopped' },
	error: { color: 'bg-[#ef4444]', label: 'Error' },
};
