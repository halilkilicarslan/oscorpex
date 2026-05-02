import { useCallback, useEffect, useRef } from "react";

interface UsePollingOptions {
	enabled?: boolean;
	immediate?: boolean;
}

/**
 * Centralized polling hook with tab visibility awareness.
 * Pauses polling when tab is not visible, resumes on focus.
 */
export function usePolling(
	fetchFn: () => void | Promise<void>,
	intervalMs: number,
	options: UsePollingOptions = {},
): void {
	const { enabled = true, immediate = true } = options;
	const fetchRef = useRef(fetchFn);
	fetchRef.current = fetchFn;

	const tick = useCallback(() => {
		try {
			const result = fetchRef.current();
			if (result instanceof Promise) {
				result.catch((err) => console.error("[usePolling] Fetch error:", err));
			}
		} catch (err) {
			console.error("[usePolling] Fetch error:", err);
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;

		if (immediate) tick();

		let timer: ReturnType<typeof setInterval> | null = null;

		const start = () => {
			if (timer) return;
			timer = setInterval(tick, intervalMs);
		};

		const stop = () => {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		};

		const onVisibility = () => {
			if (document.visibilityState === "visible") {
				tick(); // refresh immediately on tab focus
				start();
			} else {
				stop();
			}
		};

		start();
		document.addEventListener("visibilitychange", onVisibility);

		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [enabled, intervalMs, tick, immediate]);
}
