import { CheckCircle2, Loader2, Package, Play } from 'lucide-react';
import { FRAMEWORK_META } from './helpers';
import type { RuntimeAnalysis } from '../../lib/studio-api';

interface ServiceListProps {
	analysis: RuntimeAnalysis;
	actionLoading: string | null;
	onInstallDeps: (serviceName?: string) => void;
	onStartApp: () => void;
}

export default function ServiceList({ analysis, actionLoading, onInstallDeps, onStartApp }: ServiceListProps) {
	if (analysis.services.length === 0) {
		return (
			<div className="text-xs text-[#71717a] py-2">
				Calistirilabilir servis bulunamadi. Proje dizinini kontrol edin.
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{analysis.services.map((svc) => {
				const meta = FRAMEWORK_META[svc.framework] || FRAMEWORK_META.unknown;
				return (
					<div key={svc.name} className="bg-[#18181b] rounded-lg border border-[#27272a] p-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
								<span className="text-sm font-medium text-[#fafafa]">{svc.name}</span>
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272a] text-[#a1a1aa]">
									{meta.label}
								</span>
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272a] text-[#71717a]">
									:{svc.port}
								</span>
							</div>
							<div className="flex items-center gap-1.5">
								{svc.depsInstalled ? (
									<span className="text-[10px] text-[#22c55e] flex items-center gap-1">
										<CheckCircle2 size={10} /> Deps OK
									</span>
								) : (
									<button
										onClick={() => onInstallDeps(svc.name)}
										disabled={actionLoading === `install-${svc.name}`}
										className="text-[10px] px-2 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20 flex items-center gap-1"
									>
										{actionLoading === `install-${svc.name}` ? (
											<Loader2 size={10} className="animate-spin" />
										) : (
											<Package size={10} />
										)}
										Kur
									</button>
								)}
							</div>
						</div>
						<div className="mt-1.5 text-[10px] text-[#71717a] font-mono truncate">
							$ {svc.startCommand}
						</div>
					</div>
				);
			})}

			<div className="flex gap-2 pt-1">
				{!analysis.allDepsInstalled && (
					<button
						onClick={() => onInstallDeps()}
						disabled={!!actionLoading}
						className="flex-1 text-xs px-3 py-1.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20 flex items-center justify-center gap-1.5"
					>
						{actionLoading === 'install-all' ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							<Package size={12} />
						)}
						Tum Bagimliliklari Kur
					</button>
				)}
				<button
					onClick={onStartApp}
					disabled={!!actionLoading}
					className="flex-1 text-xs px-3 py-2 rounded bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 flex items-center justify-center gap-1.5 font-medium"
				>
					{actionLoading === 'start-app' ? (
						<Loader2 size={12} className="animate-spin" />
					) : (
						<Play size={12} />
					)}
					Start App
				</button>
			</div>
		</div>
	);
}
