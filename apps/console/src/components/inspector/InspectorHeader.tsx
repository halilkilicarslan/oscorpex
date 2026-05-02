import type { InspectorTaskSummary, InspectorAgentSummary, InspectorSessionSummary } from '../../lib/studio-api/inspector';

const statusColors: Record<string, string> = {
	done: 'bg-green-500/20 text-green-400',
	running: 'bg-blue-500/20 text-blue-400',
	failed: 'bg-red-500/20 text-red-400',
	queued: 'bg-neutral-500/20 text-neutral-400',
	review: 'bg-yellow-500/20 text-yellow-400',
	revision: 'bg-orange-500/20 text-orange-400',
	waiting_approval: 'bg-purple-500/20 text-purple-400',
};

export function InspectorHeader({
	task,
	agent,
	session,
}: {
	task: InspectorTaskSummary;
	agent?: InspectorAgentSummary;
	session?: InspectorSessionSummary;
}) {
	const colorClass = statusColors[task.status] ?? 'bg-neutral-500/20 text-neutral-400';
	const duration = session?.durationMs ? formatDuration(session.durationMs) : null;

	return (
		<div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-lg font-semibold text-white">{task.title}</h2>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#a3a3a3]">
						<span className={`rounded px-2 py-0.5 text-xs font-medium ${colorClass}`}>
							{task.status}
						</span>
						{task.complexity && (
							<span className="text-xs text-[#525252]">Complexity: {task.complexity}</span>
						)}
						{task.taskType && (
							<span className="text-xs text-[#525252]">Type: {task.taskType}</span>
						)}
						{agent && (
							<span className="text-xs text-[#525252]">
								Agent: {agent.name} ({agent.role})
							</span>
						)}
					</div>
				</div>
				<div className="flex flex-col items-end gap-1 text-xs text-[#737373]">
					{session && (
						<span className="rounded bg-[#1a1a1a] px-2 py-0.5">
							Session: {session.status}
						</span>
					)}
					{duration && <span>{duration}</span>}
					{task.retryCount ? <span>Retries: {task.retryCount}</span> : null}
					{task.revisionCount ? <span>Revisions: {task.revisionCount}</span> : null}
				</div>
			</div>
			{task.error && (
				<div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
					{task.error}
				</div>
			)}
		</div>
	);
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	return `${m}m ${rs}s`;
}

export default InspectorHeader;
