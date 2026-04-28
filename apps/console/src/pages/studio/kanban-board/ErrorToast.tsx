import { AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
	id: number;
	message: string;
	type?: 'error' | 'success';
}

interface ErrorToastProps {
	toasts: ToastMessage[];
	onDismiss: (id: number) => void;
}

export default function ErrorToast({ toasts, onDismiss }: ErrorToastProps) {
	if (toasts.length === 0) return null;
	return (
		<div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
			{toasts.map((t) => (
				<div
					key={t.id}
					className={[
						'flex items-start gap-2 text-[12px] px-3 py-2 rounded-lg shadow-lg pointer-events-auto max-w-[320px]',
						t.type === 'success'
							? 'bg-[#0a1a0a] border border-[#22c55e]/30 text-[#22c55e]'
							: 'bg-[#1a0a0a] border border-[#ef4444]/30 text-[#ef4444]',
					].join(' ')}
				>
					<AlertCircle size={14} className="shrink-0 mt-0.5" />
					<span className="flex-1 leading-snug">{t.message}</span>
					<button
						type="button"
						onClick={() => onDismiss(t.id)}
						className="opacity-60 hover:opacity-100 transition-colors ml-1"
					>
						<X size={12} />
					</button>
				</div>
			))}
		</div>
	);
}
