import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface StatusItemProps {
	label: string;
	ok: boolean;
	text: string;
}

export default function StatusItem({ label, ok, text }: StatusItemProps) {
	return (
		<div className="flex items-center gap-1.5">
			{ok ? (
				<CheckCircle2 size={11} className="text-[#22c55e]" />
			) : (
				<AlertTriangle size={11} className="text-[#f59e0b]" />
			)}
			<span className="text-[#a1a1aa]">{label}:</span>
			<span className={ok ? 'text-[#22c55e]' : 'text-[#f59e0b]'}>{text}</span>
		</div>
	);
}
