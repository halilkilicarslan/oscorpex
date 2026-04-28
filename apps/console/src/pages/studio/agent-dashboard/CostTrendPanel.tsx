import { Suspense, lazy } from 'react';
import { DollarSign } from 'lucide-react';

const CostTrendChart = lazy(() => import('../charts/CostTrendChart'));

interface CostTrendPanelProps {
	projectId: string;
}

export default function CostTrendPanel({ projectId }: CostTrendPanelProps) {
	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl p-4">
			<div className="flex items-center gap-2 mb-4">
				<DollarSign size={14} className="text-[#22c55e]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Cost Trend (14 Days)</h3>
			</div>
			<Suspense fallback={<div className="h-[250px] animate-pulse bg-[#1a1a1a] rounded-lg" />}>
				<CostTrendChart projectId={projectId} />
			</Suspense>
		</div>
	);
}
