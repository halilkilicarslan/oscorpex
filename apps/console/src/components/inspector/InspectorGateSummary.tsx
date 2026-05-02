import type { InspectorGateSummary as GateSummary } from '../../lib/studio-api/inspector';

const gateStatusStyle: Record<string, string> = {
	passed: 'text-green-400 bg-green-500/10',
	failed: 'text-red-400 bg-red-500/10',
	warning: 'text-yellow-400 bg-yellow-500/10',
	skipped: 'text-neutral-500 bg-neutral-500/10',
	unknown: 'text-neutral-500 bg-neutral-500/10',
};

export function InspectorGateSummary({ gates }: { gates: GateSummary[] }) {
	if (gates.length === 0) {
		return null;
	}

	return (
		<div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
			<h3 className="mb-3 text-sm font-semibold text-white">Gates</h3>
			<div className="space-y-2">
				{gates.map((gate, i) => (
					<div key={i} className="flex items-center justify-between gap-2 text-sm">
						<span className="text-[#e5e5e5]">{gate.name}</span>
						<span
							className={`rounded px-2 py-0.5 text-xs font-medium ${gateStatusStyle[gate.status] ?? gateStatusStyle.unknown}`}
						>
							{gate.status}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

export default InspectorGateSummary;
