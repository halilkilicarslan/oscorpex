import { useState } from 'react';
import type { InspectorOutputSummary } from '../../lib/studio-api/inspector';

export function InspectorOutputPanel({ output }: { output?: InspectorOutputSummary }) {
	const [logsExpanded, setLogsExpanded] = useState(false);

	if (!output) {
		return null;
	}

	const hasFiles = output.filesCreated.length > 0 || output.filesModified.length > 0;
	const hasLogs = output.logs.length > 0;

	if (!hasFiles && !hasLogs && !output.error) {
		return null;
	}

	return (
		<div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
			<h3 className="mb-3 text-sm font-semibold text-white">Output</h3>

			{output.filesCreated.length > 0 && (
				<div className="mb-2">
					<div className="text-xs font-medium text-green-400 mb-1">Files Created</div>
					<div className="space-y-0.5">
						{output.filesCreated.map((f) => (
							<div key={f} className="font-mono text-xs text-[#a3a3a3]">{f}</div>
						))}
					</div>
				</div>
			)}

			{output.filesModified.length > 0 && (
				<div className="mb-2">
					<div className="text-xs font-medium text-yellow-400 mb-1">Files Modified</div>
					<div className="space-y-0.5">
						{output.filesModified.map((f) => (
							<div key={f} className="font-mono text-xs text-[#a3a3a3]">{f}</div>
						))}
					</div>
				</div>
			)}

			{hasLogs && (
				<div className="mt-2">
					<button
						type="button"
						className="text-xs text-[#737373] hover:text-white"
						onClick={() => setLogsExpanded(!logsExpanded)}
					>
						{logsExpanded ? 'Hide' : 'Show'} Logs ({output.logs.length})
					</button>
					{logsExpanded && (
						<pre className="mt-1 max-h-40 overflow-auto rounded bg-[#0a0a0a] p-2 text-xs text-[#a3a3a3]">
							{output.logs.join('\n')}
						</pre>
					)}
				</div>
			)}

			{output.error && (
				<div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
					{output.error}
				</div>
			)}
		</div>
	);
}

export default InspectorOutputPanel;
