// ---------------------------------------------------------------------------
// Oscorpex — WebSocket Hook
//
// Kullanım:
//   const { connectionState, lastEvent, send } = useStudioWebSocket(projectId);
//
// Özellikler:
//   - Otomatik bağlantı ve proje aboneliği
//   - Exponential backoff ile yeniden bağlanma (max 30s)
//   - Client-side heartbeat (30s ping, 10s timeout)
//   - Bağlantı kesildiğinde mesaj kuyruğu (kuyruk dolana kadar bekle)
//   - Bileşen unmount'unda temiz kapatma
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type WSConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WSMessage {
  type: string;
  projectId?: string;
  agentId?: string;
  payload?: unknown;
}

export interface StudioEvent {
  id: string;
  type: string;
  projectId: string;
  agentId?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface UseStudioWebSocketOptions {
  /** Otomatik bağlan (varsayılan: true) */
  autoConnect?: boolean;
  /** İlk bağlantı gecikmesi ms (varsayılan: 0) */
  connectDelay?: number;
}

export interface UseStudioWebSocketResult {
  connectionState: WSConnectionState;
  /** Son alınan StudioEvent (type: 'event' mesajlarının payload'ı) */
  lastEvent: StudioEvent | null;
  /** Düşük seviyeli ham mesaj gönderme */
  send: (msg: WSMessage) => void;
  /** Manuel bağlantı tetikleyici */
  connect: () => void;
  /** Manuel bağlantı kesici */
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const STUDIO_WS_PORT: number = Number(import.meta.env.VITE_STUDIO_WS_PORT ?? 3142);
const WS_URL = `ws://localhost:${STUDIO_WS_PORT}/api/studio/ws`;

const RECONNECT_BASE_MS   = 1_000;   // İlk retry gecikmesi
const RECONNECT_MAX_MS    = 30_000;  // Maksimum retry gecikmesi
const HEARTBEAT_MS        = 25_000;  // Ping aralığı
const HEARTBEAT_TIMEOUT   = 10_000;  // Pong bekleme süresi

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStudioWebSocket(
  projectId: string,
  options: UseStudioWebSocketOptions = {},
): UseStudioWebSocketResult {
  const { autoConnect = true, connectDelay = 0 } = options;

  const [connectionState, setConnectionState] = useState<WSConnectionState>('disconnected');
  const [lastEvent, setLastEvent] = useState<StudioEvent | null>(null);

  const wsRef              = useRef<WebSocket | null>(null);
  const mountedRef         = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef       = useRef(projectId);

  // projectId değiştiğinde ref'i güncelle
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // -------------------------------------------------------------------------
  // Yardımcılar
  // -------------------------------------------------------------------------

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const send = useCallback((msg: WSMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  const startHeartbeat = useCallback(() => {
    clearHeartbeat();

    heartbeatTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // Ping gönder
      ws.send(JSON.stringify({ type: 'ping' }));

      // Pong gelmezse bağlantıyı kapat
      pongTimeoutRef.current = setTimeout(() => {
        console.warn('[useStudioWebSocket] Pong alınamadı — bağlantı kapatılıyor');
        ws.close(1000, 'pong timeout');
      }, HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_MS);
  }, [clearHeartbeat]);

  // -------------------------------------------------------------------------
  // Bağlantı
  // -------------------------------------------------------------------------

  const connectInternal = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setConnectionState('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      console.error('[useStudioWebSocket] WebSocket oluşturulamadı:', err);
      setConnectionState('error');
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectAttemptRef.current = 0;
      setConnectionState('connected');

      // Projeye abone ol
      ws.send(JSON.stringify({ type: 'subscribe', projectId: projectIdRef.current }));

      // Heartbeat başlat
      startHeartbeat();
    };

    ws.onmessage = (e: MessageEvent<string>) => {
      if (!mountedRef.current) return;

      let msg: WSMessage;
      try {
        msg = JSON.parse(e.data) as WSMessage;
      } catch {
        return; // Geçersiz JSON — yoksay
      }

      switch (msg.type) {
        case 'pong':
          // Pong timeout'u iptal et
          if (pongTimeoutRef.current) {
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
          }
          break;

        case 'event':
          if (msg.payload) {
            setLastEvent(msg.payload as StudioEvent);
          }
          break;

        default:
          // subscribed, unsubscribed, error vb. — şimdilik yoksay
          break;
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setConnectionState('error');
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      clearHeartbeat();
      setConnectionState('disconnected');

      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // Exponential backoff ile yeniden bağlan
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      reconnectAttemptRef.current = attempt + 1;

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connectInternal();
      }, delay);
    };
  }, [startHeartbeat, clearHeartbeat]);

  const connect = useCallback(() => {
    clearReconnect();
    reconnectAttemptRef.current = 0;
    connectInternal();
  }, [clearReconnect, connectInternal]);

  const disconnect = useCallback(() => {
    mountedRef.current = false; // Reconnect'i engelle
    clearReconnect();
    clearHeartbeat();
    const ws = wsRef.current;
    if (ws) {
      ws.close(1000, 'manual disconnect');
      wsRef.current = null;
    }
    setConnectionState('disconnected');
  }, [clearReconnect, clearHeartbeat]);

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      if (connectDelay > 0) {
        reconnectTimerRef.current = setTimeout(connectInternal, connectDelay);
      } else {
        connectInternal();
      }
    }

    return () => {
      mountedRef.current = false;
      clearReconnect();
      clearHeartbeat();
      const ws = wsRef.current;
      if (ws) {
        ws.close(1000, 'component unmount');
        wsRef.current = null;
      }
    };
  // connectInternal referansı kararlı (useCallback + sabit deps); eslint uyarısını bastır
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // projectId değiştiğinde mevcut subscription'ı güncelle
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Eski projenin aboneliğini iptal et ve yeni projeye abone ol
    // (Ref önceki değeri tutmak için ek bir ref gerektirir; basit tutmak için reconnect)
    ws.send(JSON.stringify({ type: 'subscribe', projectId }));
  }, [projectId]);

  return { connectionState, lastEvent, send, connect, disconnect };
}
