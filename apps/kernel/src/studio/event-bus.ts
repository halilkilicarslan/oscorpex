// ---------------------------------------------------------------------------
// Oscorpex — Event Bus (in-process pub/sub + PG LISTEN/NOTIFY durable bridge)
//
// Implements the EventPublisher contract from @oscorpex/core, using typed
// event payloads from @oscorpex/event-schema. The class retains full backward
// compatibility with the legacy StudioEvent-based API (emit/emitTransient/emitAsync
// accept Omit<StudioEvent, "id" | "timestamp">) while the EventPublisher contract
// uses BaseEvent with correlationId and causationId.
// ---------------------------------------------------------------------------

import type { BaseEvent, EventPayloadMap } from "@oscorpex/event-schema";
import { getCorrelationIds } from "./correlation-context.js";
import { getEvent, insertEvent } from "./db.js";
import { createLogger } from "./logger.js";
import { pgListener } from "./pg-listener.js";
import type { EventType, StudioEvent } from "./types.js";
const log = createLogger("event-bus");

type Handler = (event: StudioEvent) => void;

// TTL: aynı process içinde emit edilmiş event'lerin PG notification'ından
// tekrar tetiklenmesini önlemek için 5 saniye tutuyoruz.
const DEDUP_TTL_MS = 5000;

class EventBus {
	private handlers = new Map<string, Set<Handler>>();
	/** Bu process'te emit edilmiş ve henüz TTL süresi dolmamış event ID'leri */
	private _recentlyEmitted = new Set<string>();

	// --- EventPublisher contract (BaseEvent with typed payloads) ---

	/** Publish a typed event — persists to DB, notifies subscribers, returns the stored event */
	async publish<T extends EventType>(event: BaseEvent<T, EventPayloadMap[T]>): Promise<void> {
		const legacyData: Omit<StudioEvent, "id" | "timestamp"> = {
			projectId: event.projectId,
			type: event.type,
			agentId: event.agentId,
			taskId: event.taskId,
			payload: event.payload as Record<string, unknown>,
			correlationId: event.correlationId,
			causationId: event.causationId,
		};
		this.emit(legacyData);
	}

	/** Publish a transient typed event — in-process only, no DB persistence */
	publishTransient<T extends EventType>(event: BaseEvent<T, EventPayloadMap[T]>): void {
		const legacyData: Omit<StudioEvent, "id" | "timestamp"> = {
			projectId: event.projectId,
			type: event.type,
			agentId: event.agentId,
			taskId: event.taskId,
			payload: event.payload as Record<string, unknown>,
			correlationId: event.correlationId,
			causationId: event.causationId,
		};
		this.emitTransient(legacyData);
	}

	// --- Legacy API (backward compatible) ---

	/** Subscribe to all events for a project */
	onProject(projectId: string, handler: Handler): () => void {
		const key = `project:${projectId}`;
		if (!this.handlers.has(key)) this.handlers.set(key, new Set());
		this.handlers.get(key)!.add(handler);
		return () => {
			const set = this.handlers.get(key);
			set?.delete(handler);
			if (set?.size === 0) this.handlers.delete(key);
		};
	}

	/** Subscribe to a specific event type globally */
	on(type: EventType, handler: Handler): () => void {
		const key = `type:${type}`;
		if (!this.handlers.has(key)) this.handlers.set(key, new Set());
		this.handlers.get(key)!.add(handler);
		return () => {
			const set = this.handlers.get(key);
			set?.delete(handler);
			if (set?.size === 0) this.handlers.delete(key);
		};
	}

	/** Emit an event — persists to DB and notifies subscribers */
	emit(data: Omit<StudioEvent, "id" | "timestamp">): void {
		// Enforce correlation/causation tracking from async context if not provided
		const ids = getCorrelationIds();
		const enriched = {
			...data,
			correlationId: data.correlationId ?? ids.correlationId,
			causationId: data.causationId ?? ids.causationId,
		};
		// Fire-and-forget: persist to DB asynchronously, then notify subscribers
		insertEvent(enriched)
			.then((event) => {
				// Dedup guard: bu ID'yi aynı process'te pg-listener'dan gelince skip etmek için işaretle
				this._recentlyEmitted.add(event.id);
				setTimeout(() => this._recentlyEmitted.delete(event.id), DEDUP_TTL_MS);

				// PG LISTEN/NOTIFY — durable event notification (diğer process'ler için)
				pgListener
					.notify({ id: event.id, projectId: event.projectId, type: event.type })
					.catch((err) => log.warn("[event-bus] Non-blocking operation failed:", err?.message ?? err));

				// Notify project subscribers
				const projectHandlers = this.handlers.get(`project:${event.projectId}`);
				if (projectHandlers) {
					for (const handler of projectHandlers) {
						try {
							handler(event);
						} catch {
							/* subscriber error — ignore */
						}
					}
				}

				// Notify type subscribers
				const typeHandlers = this.handlers.get(`type:${event.type}`);
				if (typeHandlers) {
					for (const handler of typeHandlers) {
						try {
							handler(event);
						} catch {
							/* subscriber error — ignore */
						}
					}
				}
			})
			.catch((err) => {
				log.warn("[event-bus] insertEvent failed:", err instanceof Error ? err.message : err);
			});
	}

	/**
	 * Emit a transient event — notifies subscribers immediately WITHOUT DB persistence.
	 * Ideal for high-frequency ephemeral events like agent:output terminal lines.
	 */
	emitTransient(data: Omit<StudioEvent, "id" | "timestamp">): void {
		const ids = getCorrelationIds();
		const event: StudioEvent = {
			id: "",
			...data,
			correlationId: data.correlationId ?? ids.correlationId,
			causationId: data.causationId ?? ids.causationId,
			timestamp: new Date().toISOString(),
		};

		// Notify project subscribers
		const projectHandlers = this.handlers.get(`project:${event.projectId}`);
		if (projectHandlers) {
			for (const handler of projectHandlers) {
				try {
					handler(event);
				} catch {
					/* subscriber error — ignore */
				}
			}
		}

		// Notify type subscribers
		const typeHandlers = this.handlers.get(`type:${event.type}`);
		if (typeHandlers) {
			for (const handler of typeHandlers) {
				try {
					handler(event);
				} catch {
					/* subscriber error — ignore */
				}
			}
		}
	}

	/** Emit an event and wait for DB persistence + subscriber notification */
	async emitAsync(data: Omit<StudioEvent, "id" | "timestamp">): Promise<StudioEvent> {
		const event = await insertEvent(data);

		// Dedup guard: bu ID'yi aynı process'te pg-listener'dan gelince skip etmek için işaretle
		this._recentlyEmitted.add(event.id);
		setTimeout(() => this._recentlyEmitted.delete(event.id), DEDUP_TTL_MS);

		// PG LISTEN/NOTIFY — durable event notification (diğer process'ler için)
		pgListener
			.notify({ id: event.id, projectId: event.projectId, type: event.type })
			.catch((err) => log.warn("[event-bus] Non-blocking operation failed:", err?.message ?? err));

		// Notify project subscribers
		const projectHandlers = this.handlers.get(`project:${event.projectId}`);
		if (projectHandlers) {
			for (const handler of projectHandlers) {
				try {
					handler(event);
				} catch {
					/* subscriber error — ignore */
				}
			}
		}

		// Notify type subscribers
		const typeHandlers = this.handlers.get(`type:${event.type}`);
		if (typeHandlers) {
			for (const handler of typeHandlers) {
				try {
					handler(event);
				} catch {
					/* subscriber error — ignore */
				}
			}
		}

		return event;
	}

	/**
	 * PG LISTEN/NOTIFY listener'ı başlatır.
	 * Başka bir process'ten gelen pg_notify bildirimleri dinlenir,
	 * event DB'den fetch edilip mevcut handler'lara iletilir.
	 * Aynı process'te emit edilen event'ler _recentlyEmitted ile dedup edilir.
	 */
	async initPgListener(): Promise<void> {
		await pgListener.start();

		pgListener.onNotification((payload) => {
			// Aynı process'te bu event zaten emit edildi — çift tetiklemeyi önle
			if (this._recentlyEmitted.has(payload.id)) return;

			getEvent(payload.id)
				.then((event) => {
					if (!event) return;

					// Notify project subscribers
					const projectHandlers = this.handlers.get(`project:${event.projectId}`);
					if (projectHandlers) {
						for (const handler of projectHandlers) {
							try {
								handler(event);
							} catch {
								/* subscriber error — ignore */
							}
						}
					}

					// Notify type subscribers
					const typeHandlers = this.handlers.get(`type:${event.type}`);
					if (typeHandlers) {
						for (const handler of typeHandlers) {
							try {
								handler(event);
							} catch {
								/* subscriber error — ignore */
							}
						}
					}
				})
				.catch((err) => {
					log.warn("[event-bus] Failed to fetch event from PG notification:", err instanceof Error ? err.message : err);
				});
		});
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
			cleanup: () => {
				unsubscribe?.();
			},
		};
	}
}

export const eventBus = new EventBus();
