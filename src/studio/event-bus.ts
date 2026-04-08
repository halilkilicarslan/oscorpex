// ---------------------------------------------------------------------------
// AI Dev Studio — Event Bus (in-process pub/sub)
// ---------------------------------------------------------------------------

import { insertEvent } from './db.js';
import type { StudioEvent, EventType } from './types.js';

type Handler = (event: StudioEvent) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  /** Subscribe to all events for a project */
  onProject(projectId: string, handler: Handler): () => void {
    const key = `project:${projectId}`;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => { this.handlers.get(key)?.delete(handler); };
  }

  /** Subscribe to a specific event type globally */
  on(type: EventType, handler: Handler): () => void {
    const key = `type:${type}`;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => { this.handlers.get(key)?.delete(handler); };
  }

  /** Emit an event — persists to DB and notifies subscribers */
  emit(data: Omit<StudioEvent, 'id' | 'timestamp'>): void {
    // Fire-and-forget: persist to DB asynchronously, then notify subscribers
    insertEvent(data).then((event) => {
      // Notify project subscribers
      const projectHandlers = this.handlers.get(`project:${event.projectId}`);
      if (projectHandlers) {
        for (const handler of projectHandlers) {
          try { handler(event); } catch { /* subscriber error — ignore */ }
        }
      }

      // Notify type subscribers
      const typeHandlers = this.handlers.get(`type:${event.type}`);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          try { handler(event); } catch { /* subscriber error — ignore */ }
        }
      }
    }).catch((err) => {
      console.warn('[event-bus] insertEvent failed:', err instanceof Error ? err.message : err);
    });
  }

  /** Emit an event and wait for DB persistence + subscriber notification */
  async emitAsync(data: Omit<StudioEvent, 'id' | 'timestamp'>): Promise<StudioEvent> {
    const event = await insertEvent(data);

    // Notify project subscribers
    const projectHandlers = this.handlers.get(`project:${event.projectId}`);
    if (projectHandlers) {
      for (const handler of projectHandlers) {
        try { handler(event); } catch { /* subscriber error — ignore */ }
      }
    }

    // Notify type subscribers
    const typeHandlers = this.handlers.get(`type:${event.type}`);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try { handler(event); } catch { /* subscriber error — ignore */ }
      }
    }

    return event;
  }

  /** Create an SSE-compatible readable stream for a project's events */
  createSSEStream(projectId: string): { stream: ReadableStream<string>; cleanup: () => void } {
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream<string>({
      start: (controller) => {
        unsubscribe = this.onProject(projectId, (event) => {
          const data = JSON.stringify(event);
          controller.enqueue(`data: ${data}\n\n`);
        });
      },
      cancel: () => {
        unsubscribe?.();
      },
    });

    return {
      stream,
      cleanup: () => { unsubscribe?.(); },
    };
  }
}

export const eventBus = new EventBus();
