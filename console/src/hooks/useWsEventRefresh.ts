// ---------------------------------------------------------------------------
// Oscorpex — useWsEventRefresh
//
// Belirli WS event type'larını dinler ve eşleşme olduğunda debounce edilmiş
// bir callback tetikler. Birden fazla event debounce penceresi içinde
// gelirse tek bir callback çağrısına katlanır.
//
// Kullanım:
//   const { connectionState, isWsActive } = useWsEventRefresh(
//     projectId,
//     ['task:completed', 'task:failed'],
//     refetch,
//     { debounceMs: 300 },
//   );
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { useStudioWebSocket, type WSConnectionState } from './useStudioWebSocket';

export type { WSConnectionState };

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export interface WsEventRefreshOptions {
	/** Debounce süresi ms cinsinden (varsayılan: 500) */
	debounceMs?: number;
	/** false olduğunda hook pasif kalır, callback tetiklenmez (varsayılan: true) */
	enabled?: boolean;
}

export interface UseWsEventRefreshResult {
	connectionState: WSConnectionState;
	/** WS bağlantısı kurulduğunda true */
	isWsActive: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWsEventRefresh(
	projectId: string,
	eventTypes: string[],
	callback: () => void,
	options: WsEventRefreshOptions = {},
): UseWsEventRefreshResult {
	const { debounceMs = 500, enabled = true } = options;

	const { connectionState, lastEvent } = useStudioWebSocket(projectId);

	// Callback ve eventTypes referanslarını ref'te tut — stale closure'ı önler
	const callbackRef = useRef(callback);
	const eventTypesRef = useRef(eventTypes);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	useEffect(() => {
		eventTypesRef.current = eventTypes;
	}, [eventTypes]);

	// lastEvent değiştiğinde eşleşme kontrolü yap
	useEffect(() => {
		if (!enabled) return;
		if (connectionState !== 'connected') return;
		if (!lastEvent) return;
		if (!eventTypesRef.current.includes(lastEvent.type)) return;

		// Önceki debounce timer'ı iptal et — pencere içindeki eventler katlanır
		if (debounceTimerRef.current !== null) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => {
			debounceTimerRef.current = null;
			callbackRef.current();
		}, debounceMs);
	}, [lastEvent, enabled, connectionState, debounceMs]);

	// Unmount'ta timer'ı temizle
	useEffect(() => {
		return () => {
			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, []);

	return {
		connectionState,
		isWsActive: connectionState === 'connected',
	};
}
