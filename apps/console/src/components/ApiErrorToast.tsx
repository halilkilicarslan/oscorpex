import { useEffect, useRef, useState } from 'react';

interface ApiErrorDetail {
	status: number;
	message: string;
}

const TOAST_MS = 4500;
const DEDUPE_MS = 2500;

export default function ApiErrorToast() {
	const [visible, setVisible] = useState(false);
	const [message, setMessage] = useState('');
	const hideTimer = useRef<number | null>(null);
	const lastToast = useRef<{ at: number; text: string } | null>(null);

	useEffect(() => {
		return () => {
			if (hideTimer.current) {
				window.clearTimeout(hideTimer.current);
			}
		};
	}, []);

	useEffect(() => {
		const onApiError = (event: Event) => {
			const detail = (event as CustomEvent<ApiErrorDetail>).detail;
			if (!detail || detail.status !== 403) return;

			const now = Date.now();
			const text = 'Bu işlem için yetkiniz yok veya kaynak erişimi engellendi (403).';
			if (
				lastToast.current &&
				lastToast.current.text === text &&
				now - lastToast.current.at < DEDUPE_MS
			) {
				return;
			}

			lastToast.current = { at: now, text };
			setMessage(text);
			setVisible(true);

			if (hideTimer.current) {
				window.clearTimeout(hideTimer.current);
			}
			hideTimer.current = window.setTimeout(() => {
				setVisible(false);
			}, TOAST_MS);
		};

		window.addEventListener('studio:api:error', onApiError as EventListener);
		return () => {
			window.removeEventListener('studio:api:error', onApiError as EventListener);
		};
	}, []);

	if (!visible) return null;

	return (
		<div className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg border border-red-500/40 bg-[#1b1212] px-4 py-3 shadow-lg">
			<div className="text-sm font-medium text-red-300">Erişim Hatası</div>
			<div className="mt-1 text-sm text-red-100">{message}</div>
		</div>
	);
}
