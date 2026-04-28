import { useState } from 'react';
import { Shield } from 'lucide-react';
import { triggerSonarScan } from '../../../lib/studio-api';
import type { SonarLatestScan } from '../../../lib/studio-api';

interface SonarQubePanelProps {
	projectId: string;
	scan: SonarLatestScan | null;
}

export default function SonarQubePanel({ projectId, scan: initialScan }: SonarQubePanelProps) {
	const [scan, setScan] = useState<SonarLatestScan | null>(initialScan);
	const [scanning, setScanning] = useState(false);

	const handleScan = async () => {
		setScanning(true);
		try {
			const result = await triggerSonarScan(projectId);
			if (result.qualityGate) {
				setScan({
					qualityGate: result.qualityGate.status,
					conditions: result.qualityGate.conditions,
				});
			}
		} catch {
			/* ignore */
		}
		setScanning(false);
	};

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<Shield size={14} className="text-[#a78bfa]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">SonarQube</h3>
				<span className="ml-auto flex items-center gap-2">
					{scan?.qualityGate && (
						<span
							className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
								scan.qualityGate === 'OK'
									? 'bg-[#052e16] text-[#22c55e]'
									: scan.qualityGate === 'ERROR'
										? 'bg-[#450a0a] text-[#ef4444]'
										: scan.qualityGate === 'WARN'
											? 'bg-[#422006] text-[#eab308]'
											: 'bg-[#1a1a1a] text-[#525252]'
							}`}
						>
							{scan.qualityGate}
						</span>
					)}
					<button
						onClick={handleScan}
						disabled={scanning}
						className="text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors disabled:opacity-50"
					>
						{scanning ? 'Taranıyor...' : 'Tara'}
					</button>
				</span>
			</div>
			{scan?.conditions && scan.conditions.length > 0 && (
				<div className="p-3 space-y-1">
					{scan.conditions.map((cond, i) => (
						<div key={i} className="flex items-center justify-between text-[11px]">
							<span className="text-[#a3a3a3]">{cond.metricKey}</span>
							<span className="flex items-center gap-2">
								<span className="text-[#525252] font-mono">{cond.actualValue ?? '-'}</span>
								<span
									className={`w-2 h-2 rounded-full ${
										cond.status === 'OK'
											? 'bg-[#22c55e]'
											: cond.status === 'ERROR'
												? 'bg-[#ef4444]'
												: 'bg-[#eab308]'
										}`}
								/>
							</span>
						</div>
					))}
				</div>
			)}
			{(!scan?.conditions || scan.conditions.length === 0) && (
				<div className="flex items-center justify-center py-6 text-[11px] text-[#525252]">
					{scan?.createdAt
						? `Son tarama: ${new Date(scan.createdAt).toLocaleString('tr-TR')}`
						: 'Henuz tarama yapilmadi'}
				</div>
			)}
		</div>
	);
}
