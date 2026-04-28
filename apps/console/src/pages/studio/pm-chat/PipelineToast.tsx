import { useEffect } from 'react';
import { Zap, TriangleAlert } from 'lucide-react';
import type { PipelineToastState } from './helpers';

interface PipelineToastProps {
	toast: NonNullable<PipelineToastState>;
	onClose: () => void;
}

export default function PipelineToast({ toast, onClose }: PipelineToastProps) {
	useEffect(() => {
		const timer = setTimeout(onClose, 6000);
		return () => clearTimeout(timer);
	}, [onClose]);

	const isSuccess = toast.type === 'success';

	return (
		<div
			className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border text-[12px] leading-relaxed ${
				isSuccess
					? 'bg-[#22c55e]/10 border-[#22c55e]/20 text-[#22c55e]'
					: 'bg-[#f59e0b]/10 border-[#f59e0b]/20 text-[#f59e0b]'
			}`}
		>
			{isSuccess ? (
				<Zap size={14} className="shrink-0 mt-0.5" />
			) : (
				<TriangleAlert size={14} className="shrink-0 mt-0.5" />
			)}
			<span className="flex-1">{toast.message}</span>
			<button
				type="button"
				onClick={onClose}
				className="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-1"
				aria-label="Close"
			>
				&times;
			</button>
		</div>
	);
}
