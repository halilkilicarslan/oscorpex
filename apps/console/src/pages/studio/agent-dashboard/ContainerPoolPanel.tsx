import { Container } from 'lucide-react';
import type { PoolStatus } from '../../../lib/studio-api';

interface ContainerPoolPanelProps {
	status: PoolStatus | null;
}

export default function ContainerPoolPanel({ status }: ContainerPoolPanelProps) {
	if (!status?.initialized) return null;

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<Container size={14} className="text-[#06b6d4]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Container Pool</h3>
				<span className="ml-auto text-[10px] text-[#525252]">{status.total} container</span>
			</div>
			<div className="p-3">
				<div className="flex gap-3 mb-3">
					<div className="flex items-center gap-1.5 text-[11px]">
						<span className="w-2 h-2 rounded-full bg-[#22c55e]" />
						<span className="text-[#a3a3a3]">Ready: {status.ready}</span>
					</div>
					<div className="flex items-center gap-1.5 text-[11px]">
						<span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
						<span className="text-[#a3a3a3]">Busy: {status.busy}</span>
					</div>
					{status.unhealthy > 0 && (
						<div className="flex items-center gap-1.5 text-[11px]">
							<span className="w-2 h-2 rounded-full bg-[#ef4444]" />
							<span className="text-[#a3a3a3]">Unhealthy: {status.unhealthy}</span>
						</div>
					)}
				</div>
				{status.containers.length > 0 && (
					<div className="space-y-1">
						{status.containers.map((c) => (
							<div key={c.id} className="flex items-center justify-between text-[11px] py-0.5">
								<span className="text-[#737373] font-mono">{c.name}</span>
								<span
									className={`px-1.5 py-0.5 rounded text-[10px] ${
										c.status === 'ready'
											? 'bg-[#052e16] text-[#22c55e]'
											: c.status === 'busy'
												? 'bg-[#422006] text-[#f59e0b]'
												: 'bg-[#450a0a] text-[#ef4444]'
									}`}
								>
									{c.status}
									{c.assignedTo ? ' (task)' : ''}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
