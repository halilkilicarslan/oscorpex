// ---------------------------------------------------------------------------
// Oscorpex — Browser Notifications Hook
//
// WebSocket event'lerinden task:completed ve task:failed bildirimlerini
// browser Notification API ile gösterir.
//
// Kullanım:
//   const { enabled, requestPermission } = useNotifications(lastEvent);
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, useRef } from 'react';
import type { StudioEvent } from './useStudioWebSocket';

// Bildirim gösterilecek event tipleri
const NOTIFY_EVENTS = new Set([
  'task:completed',
  'task:failed',
  'task:timeout',
  'pipeline:completed',
  // Human-in-the-Loop: Onay gerektiren task bildirimi
  'task:approval_required',
]);

function getNotificationContent(event: StudioEvent): { title: string; body: string; icon: string } | null {
  const p = event.payload ?? {};
  const taskTitle = (p.taskTitle as string) || (p.title as string) || 'Task';
  const agentName = (p.agentName as string) || '';

  switch (event.type) {
    case 'task:completed':
      return {
        title: 'Task Tamamlandi',
        body: `${agentName ? agentName + ': ' : ''}${taskTitle}`,
        icon: '/favicon.ico',
      };
    case 'task:failed':
      return {
        title: 'Task Basarisiz',
        body: `${agentName ? agentName + ': ' : ''}${taskTitle} — ${(p.error as string)?.slice(0, 100) || 'Hata'}`,
        icon: '/favicon.ico',
      };
    case 'task:timeout':
      return {
        title: 'Task Zaman Asimi',
        body: `${agentName ? agentName + ': ' : ''}${taskTitle}`,
        icon: '/favicon.ico',
      };
    case 'pipeline:completed':
      return {
        title: 'Pipeline Tamamlandi',
        body: (p.message as string) || 'Tum asamalar bitti',
        icon: '/favicon.ico',
      };
    // Human-in-the-Loop: Onay bekleyen task bildirimi
    case 'task:approval_required':
      return {
        title: 'Onay Gerekiyor',
        body: `${agentName ? agentName + ': ' : ''}${taskTitle} — Bu task icin onayiniz bekleniyor.`,
        icon: '/favicon.ico',
      };
    default:
      return null;
  }
}

export function useNotifications(lastEvent: StudioEvent | null) {
  const [enabled, setEnabled] = useState(false);
  const lastEventIdRef = useRef<string>('');

  // Check current permission on mount
  useEffect(() => {
    if ('Notification' in window) {
      setEnabled(Notification.permission === 'granted');
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    const granted = result === 'granted';
    setEnabled(granted);
    return granted;
  }, []);

  // Show notification when a relevant event arrives
  useEffect(() => {
    if (!enabled || !lastEvent) return;
    if (!NOTIFY_EVENTS.has(lastEvent.type)) return;

    // Deduplicate — don't show same event twice
    const eventId = lastEvent.id || `${lastEvent.type}-${lastEvent.taskId}-${lastEvent.timestamp}`;
    if (eventId === lastEventIdRef.current) return;
    lastEventIdRef.current = eventId;

    // Onay gerektiren event'ler sekme odaklı olsa bile gösterilir (kritik aksiyon)
    const isApprovalEvent = lastEvent.type === 'task:approval_required';
    if (!isApprovalEvent && document.hasFocus()) return;

    const content = getNotificationContent(lastEvent);
    if (!content) return;

    try {
      const n = new Notification(content.title, {
        body: content.body,
        icon: content.icon,
        tag: eventId, // Prevent duplicate OS notifications
        silent: false,
      });
      // Auto-close after 5 seconds
      setTimeout(() => n.close(), 5000);
      // Focus tab on click
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Notification API might fail in some environments
    }
  }, [lastEvent, enabled]);

  return { enabled, requestPermission };
}
