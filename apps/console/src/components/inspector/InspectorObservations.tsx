import type { InspectorObservation } from '../../lib/studio-api/inspector';

export function InspectorObservations({ observations }: { observations: InspectorObservation[] }) {
	if (observations.length === 0) {
		return null;
	}

	return (
		<div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
			<h3 className="mb-3 text-sm font-semibold text-white">Observations</h3>
			<div className="space-y-2">
				{observations.map((obs, i) => (
					<div key={i} className="flex items-start gap-3 text-sm">
						<span className="mt-0.5 flex-shrink-0 rounded bg-[#1a1a1a] px-1.5 py-0.5 text-xs font-mono text-[#737373]">
							#{obs.step}
						</span>
						<div className="min-w-0 flex-1">
							<span className="text-[#e5e5e5]">{obs.summary}</span>
							<div className="mt-0.5 flex items-center gap-2 text-xs text-[#525252]">
								<span>{obs.type}</span>
								{obs.timestamp && <span>{new Date(obs.timestamp).toLocaleTimeString()}</span>}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export default InspectorObservations;
