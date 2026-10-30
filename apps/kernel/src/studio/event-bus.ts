// ---------------------------------------------------------------------------
// Oscorpex — Event Bus (in-process pub/sub + PG LISTEN/NOTIFY durable bridge)
//
// Implements the EventPublisher contract from @oscorpex/core, using typed
// event payloads from @oscorpex/event-schema. The class retains full backward
// compatibility with the legacy StudioEvent-based API (emit/emitTransient/emitAsync
// accept Omit<StudioEvent, "id" | "timestamp">) while the EventPublisher contract
// uses BaseEvent with correlationId and causationId.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { BaseEvent, EventPayloadMap } from "@oscorpex/event-schema";
import { getCorrelationIds } from "./correlation-context.js";
import { getEvent, getEventTenantId, getProjectTenantId, insertEvent } from "./db.js";
import { createLogger } from "./logger.js";
import { pgListener } from "./pg-listener.js";
import { projectBelongsToTenant, projectTenantOf } from "./tenancy/project-tenant-cache.js";
import {
	type TenantScope,
	TenantScopeError,
	UnscopedQueryError,
	currentScope,
	isImplicitScope,
	runAsSystem,
	runInTenant,
	runOutsideScope,
	tenantScopeMode,
} from "./tenancy/tenant-scope.js";
import type { EventType, StudioEvent } from "./types.js";
const log = createLogger("event-bus");

type Handler = (event: StudioEvent) => void | Promise<void>;
/** A handler plus the tenant it is bound to (onProject() registered inside a tenant scope); null = unbound. */
interface Registration {
	handler: Handler;
	tenantId: string | null;
}

/** Project id of platform-level events (provider health, cross-project learning): they belong to no tenant. */
export const GLOBAL_PROJECT_ID = "__global__";
/** Caller input: the tenant is always derived by the bus, never taken from the caller. */
type EmitData = Omit<StudioEvent, "id" | "timestamp" | "tenantId">;

export interface EventBusCounters {
	rejected: number;
	handlerErrors: number;
	scopeErrors: number;
	notifyDropped: number;
}

const counters: EventBusCounters = { rejected: 0, handlerErrors: 0, scopeErrors: 0, notifyDropped: 0 };

export function getEventBusCounters(): EventBusCounters {
	return { ...counters };
}

export function resetEventBusCounters(): void {
	counters.rejected = 0;
	counters.handlerErrors = 0;
	counters.scopeErrors = 0;
	counters.notifyDropped = 0;
}

// TTL: aynı process içinde emit edilmiş event'lerin PG notification'ından
// tekrar tetiklenmesini önlemek için 5 saniye tutuyoruz.
const DEDUP_TTL_MS = 5000;
/** A NOTIFY whose event is older than this is not replayed to handlers. */
const NOTIFY_MAX_AGE_MS = 30_000;
const MAX_WARNED_SITES = 200;
const warnedSites = new Set<string>();

/** First stack frame outside this file, used to throttle repeated warnings per emitting call site. */
function callSite(): string {
	const frame = (new Error().stack ?? "")
		.split("\n")
		.slice(1)
		.find((l) => !/[\\/]event-bus\.[jt]s/.test(l));
	return frame?.trim() ?? "unknown";
}

class EventBus {
	private handlers = new Map<string, Set<Registration>>();
	/** Bu process'te emit edilmiş ve henüz TTL süresi dolmamış event ID'leri */
	private _recentlyEmitted = new Set<string>();
	/** Per-project tail of the emit chain: emits of one project resolve, persist and dispatch in emission order */
	private _tails = new Map<string, Promise<void>>();

	// --- EventPublisher contract (BaseEvent with typed payloads) ---

	/** Publish a typed event — persists to DB, notifies subscribers, returns the stored event */
	async publish<T extends keyof EventPayloadMap>(event: BaseEvent<T, EventPayloadMap[T]>): Promise<void> {
		const legacyData: EmitData = {
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
	publishTransient<T extends keyof EventPayloadMap>(event: BaseEvent<T, EventPayloadMap[T]>): void {
		const legacyData: EmitData = {
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

	/** Subscribe to all events for a project; inside a tenant scope the handler only receives that tenant's events */
	onProject(projectId: string, handler: Handler): () => void {
		const scope = currentScope();
		const tenantId = scope?.kind === "tenant" && !isImplicitScope() ? scope.tenantId : null;
		return this.register(`project:${projectId}`, { handler, tenantId });
	}

	/** Subscribe to a specific event type globally (boot-time only: never inside a tenant scope) */
	on(type: EventType, handler: Handler): () => void {
		if (currentScope()?.kind === "tenant" && !isImplicitScope()) {
			throw new TenantScopeError("eventBus.on() must be registered outside a tenant scope");
		}
		return this.register(`type:${type}`, { handler, tenantId: null });
	}

	private register(key: string, registration: Registration): () => void {
		if (!this.handlers.has(key)) this.handlers.set(key, new Set());
		this.handlers.get(key)?.add(registration);
		return () => {
			const set = this.handlers.get(key);
			set?.delete(registration);
			if (set?.size === 0) this.handlers.delete(key);
		};
	}

	/** Emit an event — persists to DB and notifies subscribers */
	emit(data: EmitData): void {
		const scope = this.admit(data);
		if (scope === null) return;
		const enriched = this.enrich(data);
		// Fire-and-forget: persist to DB asynchronously, then notify subscribers
		this.publishEvent(enriched, scope.scope).catch((err) => {
			log.warn({ err }, "[event-bus] emit failed");
		});
	}

	/**
	 * Emit a transient event — notifies subscribers WITHOUT DB persistence.
	 * Ideal for high-frequency ephemeral events like agent:output terminal lines.
	 */
	emitTransient(data: EmitData): void {
		const scope = this.admit(data);
		if (scope === null) return;
		const enriched = this.enrich(data);
		this.sequenced(`transient:${enriched.projectId}`, async () => {
			const tenantId = await this.resolveTenant(enriched.projectId, scope.scope);
			if (tenantId === null) return this.reject(enriched, scope.scope);
			this.dispatch({ id: "", ...enriched, tenantId, timestamp: new Date().toISOString() });
		}).catch((err) => {
			log.warn({ err }, "[event-bus] transient emit failed");
		});
	}

	/** Emit an event and wait for DB persistence + subscriber notification */
	async emitAsync(data: EmitData): Promise<StudioEvent> {
		const scope = this.admit(data);
		if (scope === null) throw new UnscopedQueryError("Event emitted outside a tenant/system scope (strict mode)");
		const event = await this.publishEvent(this.enrich(data), scope.scope);
		if (!event) throw new Error("Event rejected: project does not belong to the current tenant");
		return event;
	}

	/**
	 * PG LISTEN/NOTIFY listener'ı başlatır.
	 * Başka bir process'ten gelen pg_notify bildirimleri dinlenir; payload yalnızca event id taşır,
	 * tenant sys_event_tenant ile çözülür ve event o tenant kapsamında DB'den okunup handler'lara iletilir.
	 * Aynı process'te emit edilen event'ler _recentlyEmitted ile dedup edilir.
	 */
	async initPgListener(): Promise<void> {
		await pgListener.start();

		pgListener.onNotification((payload) => {
			this.handleNotification(payload).catch((err) => {
				log.warn({ err }, "[event-bus] Failed to handle PG notification");
			});
		});
	}

	private async handleNotification(payload: unknown): Promise<void> {
		const id = (payload as { id?: unknown } | null)?.id;
		if (typeof id !== "string" || id.length === 0) {
			counters.notifyDropped++;
			return;
		}
		// Aynı process'te bu event zaten emit edildi — çift tetiklemeyi önle
		if (this._recentlyEmitted.has(id)) return;

		let event: StudioEvent | null;
		try {
			event = await runOutsideScope(async () => {
				const tenantId = await runAsSystem("event-bus:notify-tenant", () => getEventTenantId(id));
				if (!tenantId) return null;
				const stored = await runInTenant(tenantId, () => getEvent(id));
				return stored ? { ...stored, tenantId } : null;
			});
		} catch (err) {
			counters.notifyDropped++;
			log.warn({ err }, "[event-bus] NOTIFY event re-read failed");
			return;
		}
		// A stale or unreadable event is never replayed: the NOTIFY channel is not a durable queue.
		const age = event ? Date.now() - new Date(event.timestamp).getTime() : Number.NaN;
		if (!event || !(age <= NOTIFY_MAX_AGE_MS)) {
			counters.notifyDropped++;
			return;
		}
		this.dispatch(event);
	}

	/**
	 * Unscoped emits warn (once per call site); in strict mode they are rejected and counted, never thrown.
	 * Returns null when rejected, else the ambient scope captured at emit time.
	 */
	private admit(data: EmitData): { scope: TenantScope | undefined } | null {
		const scope = currentScope();
		if (scope) return { scope };
		const site = callSite();
		const first = !warnedSites.has(site) && warnedSites.size < MAX_WARNED_SITES;
		if (first) warnedSites.add(site);
		if (tenantScopeMode() === "strict") {
			counters.rejected++;
			if (first) {
				log.warn(
					{ projectId: data.projectId, eventType: data.type, site },
					"[event-bus] unscoped emit rejected (strict mode)",
				);
			}
			return null;
		}
		if (first) log.warn({ site }, "[event-bus] Event emitted outside a tenant/system scope");
		return { scope: undefined };
	}

	/** Enforce correlation/causation tracking from async context if not provided; drops any caller tenantId */
	private enrich(data: EmitData): EmitData {
		const ids = getCorrelationIds();
		const { tenantId: _callerTenant, ...rest } = data as EmitData & { tenantId?: unknown };
		return {
			...rest,
			correlationId: data.correlationId ?? ids.correlationId,
			causationId: data.causationId ?? ids.causationId,
		};
	}

	private publishEvent(data: EmitData, scope: TenantScope | undefined): Promise<StudioEvent | null> {
		return this.sequenced(data.projectId, async () => {
			const tenantId = await this.resolveTenant(data.projectId, scope);
			if (tenantId === null) {
				this.reject(data, scope);
				return null;
			}

			let event: StudioEvent;
			if (tenantId === undefined) {
				// Tenant-less (platform event, or no project and no ambient tenant): nothing to persist
				event = { id: randomUUID(), ...data, timestamp: new Date().toISOString() };
			} else {
				event = await runOutsideScope(() =>
					runInTenant(tenantId, async () => {
						const stored = await insertEvent(data);
						// Dedup guard: bu ID'yi aynı process'te pg-listener'dan gelince skip etmek için işaretle
						this._recentlyEmitted.add(stored.id);
						setTimeout(() => this._recentlyEmitted.delete(stored.id), DEDUP_TTL_MS);

						// PG LISTEN/NOTIFY — durable event notification (diğer process'ler için)
						pgListener
							.notify({ id: stored.id })
							.catch((err) => log.warn({ err }, "[event-bus] Non-blocking operation failed"));
						return { ...stored, tenantId };
					}),
				);
			}
			this.dispatch(event);
			return event;
		});
	}

	/** Chains work per project so events keep their emission order regardless of how fast each resolves. */
	private sequenced<T>(projectId: string, run: () => Promise<T>): Promise<T> {
		const result = (this._tails.get(projectId) ?? Promise.resolve()).then(run);
		const tail = result.then(
			() => {},
			() => {},
		);
		this._tails.set(projectId, tail);
		void tail.then(() => {
			if (this._tails.get(projectId) === tail) this._tails.delete(projectId);
		});
		return result;
	}

	/**
	 * Tenant of an event: the ambient tenant (verified against the project's owner), the project's owner in
	 * system/unscoped context, or undefined for platform and project-less events without an ambient tenant.
	 * null = reject.
	 */
	private async resolveTenant(projectId: string, scope: TenantScope | undefined): Promise<string | null | undefined> {
		if (projectId === GLOBAL_PROJECT_ID) return undefined;
		if (!projectId) return scope?.kind === "tenant" ? scope.tenantId : undefined;
		if (scope?.kind === "tenant") {
			return (await projectBelongsToTenant(projectId, scope.tenantId)) ? scope.tenantId : null;
		}
		return projectTenantOf(projectId, () =>
			runOutsideScope(() => runAsSystem("event-bus:project-tenant", () => getProjectTenantId(projectId))),
		);
	}

	private reject(data: EmitData, scope: TenantScope | undefined): void {
		counters.rejected++;
		log.error(
			{
				projectId: data.projectId,
				eventType: data.type,
				scopeTenantId: scope?.kind === "tenant" ? scope.tenantId : null,
			},
			"[event-bus] event rejected: project does not belong to the emitting tenant",
		);
	}

	/** Each handler runs from a bus-private boundary in its event's tenant scope (none for tenant-less events). */
	private dispatch(event: StudioEvent): void {
		const registrations = [
			...(this.handlers.get(`project:${event.projectId}`) ?? []),
			...(this.handlers.get(`type:${event.type}`) ?? []),
		];
		for (const { handler, tenantId } of registrations) {
			if (tenantId !== null && tenantId !== event.tenantId) continue;
			void this.runHandler(handler, event);
		}
	}

	private async runHandler(handler: Handler, event: StudioEvent): Promise<void> {
		const { tenantId } = event;
		try {
			await runOutsideScope(() =>
				tenantId ? runInTenant(tenantId, async () => handler(event)) : (async () => handler(event))(),
			);
		} catch (err) {
			counters.handlerErrors++;
			if (err instanceof TenantScopeError || err instanceof UnscopedQueryError) counters.scopeErrors++;
			// P0-10: Log handler errors instead of silently swallowing
			log.warn({ err, eventType: event.type, eventId: event.id }, "[event-bus] subscriber handler threw");
		}
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
