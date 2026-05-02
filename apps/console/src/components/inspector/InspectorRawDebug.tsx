import { useState } from 'react';

export function InspectorRawDebug({ raw }: { raw?: Record<string, unknown> }) {
	const [expanded, setExpanded] = useState(false);

	if (!raw) return null;

	return (
		<div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
			<button
				type="button"
				className="flex w-full items-center justify-between text-sm font-semibold text-[#737373] hover:text-white"
				onClick={() => setExpanded(!expanded)}
			>
				<span>Raw Debug Data</span>
				<span className="text-xs">{expanded ? 'Collapse' : 'Expand'}</span>
			</button>
			{expanded && (
				<pre className="mt-3 max-h-96 overflow-auto rounded bg-[#0a0a0a] p-3 text-xs text-[#a3a3a3]">
					{JSON.stringify(raw, null, 2)}
				</pre>
			)}
		</div>
	);
}

export default InspectorRawDebug;
