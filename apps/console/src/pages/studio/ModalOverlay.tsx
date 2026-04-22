import { useEffect, useRef, type ReactNode } from "react";

interface ModalOverlayProps {
	children: ReactNode;
	onClose: () => void;
	className?: string;
}

export default function ModalOverlay({ children, onClose, className = "" }: ModalOverlayProps) {
	const overlayRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		// Focus the overlay on mount
		overlayRef.current?.focus();

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
			}
			// Focus trap: Tab cycles within modal
			if (e.key === "Tab" && overlayRef.current) {
				const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	return (
		<div
			ref={overlayRef}
			role="dialog"
			aria-modal="true"
			tabIndex={-1}
			className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 ${className}`}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			{children}
		</div>
	);
}
