// ---------------------------------------------------------------------------
// Oscorpex — WebSocket Manager
//
// Mimari:
//   - Tek bir WebSocketServer instance'ı (port paylaşımı için `noServer: true`)
//   - Her client bağlandığında projectId ile bir veya daha fazla "room"a subscribe olur
//   - event-bus'tan gelen olaylar ilgili room'daki tüm client'lara broadcast edilir
//   - Agent output satırları da aynı kanal üzerinden iletilir
//   - Bidirectional: client'dan gelen mesajlar `handleClientMessage` ile işlenir
//   - Heartbeat: 30 saniyede bir ping gönderilir, pong alınmazsa bağlantı kesilir
// ---------------------------------------------------------------------------

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { lookupApiKey, lookupIdentity } from "./auth/auth-middleware.js";
import { lookupProjectTenant } from "./auth/project-access.js";
import { GLOBAL_PROJECT_ID, eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import { getWsConfig } from "./performance-config.js";
import type { StudioEvent } from "./types.js";
const log = createLogger("ws-manager");

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

/** WebSocket üzerinden gönderilen / alınan mesaj zarfı */
export interface WSMessage {
	/** Mesaj türü */
	type: WSMessageType;
	/** İlgili proje kimliği */
	projectId?: string;
	/** Agent kimliği (agent mesajları için) */
	agentId?: string;
	/** Taşınan veri */
	payload?: unknown;
}

export type WSMessageType =
	// Client -> Server
	| "subscribe" // Bir projeye abone ol
	| "unsubscribe" // Aboneliği iptal et
	| "ping" // Client heartbeat
	// Server -> Client
	| "event" // StudioEvent
	| "agent:output" // Agent çıktı satırı
	| "pong" // Server heartbeat yanıtı
	| "error" // Hata bildirimi
	| "subscribed" // Abone onayı
	| "unsubscribed"; // Abonelik iptali onayı

/** IncomingMessage augmented with the correlation id set by ws-server during upgrade handling. */
interface AugmentedRequest extends IncomingMessage {
	correlationId?: string;
}

/** Identity the upgrade gate resolved from a ticket (or the dev bypass). */
export interface WsIdentity {
	userId: string;
	tenantId: string;
	/** Epoch ms at which the socket must end. */
	endsAt: number;
	/** No users row to re-check (legacy env key / dev bypass). */
	systemIdentity?: boolean;
	/** DB-backed API key the socket was opened with; re-validated on every subscribe. */
	apiKey?: { id: string; hash: string };
}

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Bağlı client'ı temsil eden dahili kayıt */
interface ClientRecord {
	ws: WebSocket;
	/** Client'ın abone olduğu proje ID'leri */
	subscriptions: Set<string>;
	/** Heartbeat için son pong zamanı */
	lastPong: number;
	/** Ölü bağlantı tespiti için ping timer'ı */
	pingTimer?: ReturnType<typeof setInterval>;
	/**
	 * M6.4: Tenant isolation — JWT'den çıkarılan tenantId.
	 * Dolu = sadece bu tenant'ın projeleri için gelen event'ler (ve platform-safe event'ler) iletilir.
	 * null = tenant'ı çözülemeyen client: hiçbir event almaz ve hiçbir projeye abone olamaz.
	 */
	tenantId: string | null;
	/** Correlation ID from the HTTP upgrade request (query param) */
	correlationId?: string;
	/** Ticket owner, re-checked on every subscribe */
	userId?: string;
	/** True when there is no users row to re-check */
	systemIdentity?: boolean;
	apiKey?: { id: string; hash: string };
	/** Subscribes whose checks are still in flight (they count toward the per-socket limit); an unsubscribe drops the entry */
	pendingSubscriptions?: Map<string, symbol>;
	/** Closes the socket when the bound credential expires */
	expiryTimer?: ReturnType<typeof setTimeout>;
}

/** Platform events ("__global__") that carry no tenant data and may reach every tenant's clients. */
const PLATFORM_SAFE_TYPES: ReadonlySet<string> = new Set(["provider:degraded"]);

function isPlatformSafe(projectId: string, message: WSMessage): boolean {
	if (projectId !== GLOBAL_PROJECT_ID || message.type !== "event") return false;
	const type = (message.payload as { type?: unknown } | null | undefined)?.type;
	return typeof type === "string" && PLATFORM_SAFE_TYPES.has(type);
}

/** Tenant carried by an event message; anything else has no tenant and only reaches tenant-less clients. */
function tenantOf(message: WSMessage): string | undefined {
	if (message.type !== "event") return undefined;
	const tenantId = (message.payload as { tenantId?: unknown } | null | undefined)?.tenantId;
	return typeof tenantId === "string" ? tenantId : undefined;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 saniye
const HEARTBEAT_TIMEOUT_MS = 10_000; // Pong için bekleme süresi

// ---------------------------------------------------------------------------
// WebSocketManager
// ---------------------------------------------------------------------------

class WebSocketManager {
	private wss: WebSocketServer;
	/** Tüm bağlı client'lar */
	private clients = new Map<WebSocket, ClientRecord>();
	/** projectId -> event-bus unsubscribe fonksiyonu */
	private projectUnsubscribers = new Map<string, () => void>();
	/** projectId -> aktif client sayısı */
	private projectRefCounts = new Map<string, number>();
	/** Batching: 50ms penceresi içinde biriken mesajlar (projectId -> mesaj listesi); tenant mesaj başına tutulur */
	private _pendingBroadcasts = new Map<
		string,
		Array<{ type: string; payload: unknown; tenantId?: string; platform: boolean }>
	>();
	/** Batching: proje başına zamanlayıcı (projectId -> timer handle) */
	private _flushTimers = new Map<string, NodeJS.Timeout>();

	constructor() {
		// noServer: true — HTTP upgrade'ini kendimiz yöneteceğiz
		this.wss = new WebSocketServer({ noServer: true, maxPayload: getWsConfig().maxPayloadBytes });
		this._setupWSS();
	}

	// -------------------------------------------------------------------------
	// Dışa açık API
	// -------------------------------------------------------------------------

	/**
	 * HTTP upgrade isteğini WebSocket bağlantısına yükseltir.
	 * `src/index.ts` veya Hono adapter'ından çağrılır.
	 */
	handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, identity: WsIdentity): void {
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.wss.emit("connection", ws, req, identity);
		});
	}

	/**
	 * Belirli bir projeye abone olan tüm client'lara mesaj gönderir.
	 * event-bus dışından (örn. agent-runtime) da kullanılabilir.
	 *
	 * Mesajlar 50ms'lik bir pencere içinde veya batch 20 mesaja ulaştığında
	 * toplu (batch) olarak gönderilir. Tek mesajlar JSON objesi, çoklu mesajlar
	 * JSON dizisi olarak serileştirilir.
	 */
	broadcastToProject(projectId: string, message: WSMessage): void {
		// Mesajı bekleyen listeye ekle
		let pending = this._pendingBroadcasts.get(projectId);
		if (!pending) {
			pending = [];
			this._pendingBroadcasts.set(projectId, pending);
		}
		pending.push({
			type: message.type,
			payload: message,
			tenantId: tenantOf(message),
			platform: isPlatformSafe(projectId, message),
		});

		// 20 mesaja ulaşıldığında hemen gönder
		if (pending.length >= 20) {
			this._flushProject(projectId);
			return;
		}

		// Henüz zamanlayıcı yoksa 50ms'lik flush timer başlat
		if (!this._flushTimers.has(projectId)) {
			const timer = setTimeout(() => this._flushProject(projectId), 50);
			this._flushTimers.set(projectId, timer);
		}
	}

	/**
	 * Proje için bekleyen mesaj batch'ini gönderir ve zamanlayıcıyı temizler.
	 */
	private _flushProject(projectId: string): void {
		const timer = this._flushTimers.get(projectId);
		if (timer) clearTimeout(timer);
		this._flushTimers.delete(projectId);

		const messages = this._pendingBroadcasts.get(projectId);
		this._pendingBroadcasts.delete(projectId);
		if (!messages || messages.length === 0) return;

		// Filtreleme mesaj başına yapılır: tenant'lı client yalnızca kendi tenant'ının event'lerini alır.
		// tenantId=null client hiçbir mesaj almaz; platform-safe mesajlar tüm tenant'lı client'lara gider. Flush sırasında DB işi yapılmaz.
		const serialized = new Map<string | null, string | null>();
		const payloadFor = (tenantId: string | null): string | null => {
			if (tenantId === null) return null;
			if (serialized.has(tenantId)) return serialized.get(tenantId) ?? null;
			const visible = messages.filter((m) => m.platform || m.tenantId === tenantId);
			// Tek mesajsa doğrudan obje, birden fazlaysa dizi olarak gönder
			const data =
				visible.length === 0
					? null
					: visible.length === 1
						? JSON.stringify(visible[0].payload)
						: JSON.stringify(visible.map((m) => m.payload));
			serialized.set(tenantId, data);
			return data;
		};

		for (const [ws, record] of this.clients) {
			if (!record.subscriptions.has(projectId) || ws.readyState !== WebSocket.OPEN) continue;
			const data = payloadFor(record.tenantId);
			if (data === null) continue;
			try {
				ws.send(data);
			} catch {
				// Gönderme hatası — yoksay
			}
		}
	}

	/**
	 * Bağlı client sayısını döndürür (izleme amaçlı).
	 */
	get connectionCount(): number {
		return this.clients.size;
	}

	// -------------------------------------------------------------------------
	// Dahili kurulum
	// -------------------------------------------------------------------------

	private _setupWSS(): void {
		this.wss.on("connection", (ws: WebSocket, req: IncomingMessage, identity: WsIdentity) => {
			// Kimlik ve Origin ws-server'da yükseltmeden önce doğrulandı; burada yalnızca kayıt açılır.
			const record: ClientRecord = {
				ws,
				subscriptions: new Set(),
				lastPong: Date.now(),
				tenantId: identity.tenantId,
				correlationId: (req as AugmentedRequest).correlationId,
				userId: identity.userId,
				systemIdentity: identity.systemIdentity,
				apiKey: identity.apiKey,
			};
			this.clients.set(ws, record);

			const remaining = Math.max(0, identity.endsAt - Date.now());
			record.expiryTimer = setTimeout(() => ws.close(1008, "Session expired"), Math.min(remaining, 2 ** 31 - 1));

			// Heartbeat başlat
			record.pingTimer = setInterval(() => {
				this._checkHeartbeat(ws, record);
			}, HEARTBEAT_INTERVAL_MS);

			// Gelen mesajları işle
			ws.on("message", (raw) => {
				try {
					const msg = JSON.parse(raw.toString()) as WSMessage;
					this._handleClientMessage(ws, record, msg);
				} catch {
					this._send(ws, { type: "error", payload: { message: "Geçersiz JSON" } });
				}
			});

			// Pong — heartbeat yanıtı
			ws.on("pong", () => {
				record.lastPong = Date.now();
			});

			// Bağlantı kapandı
			ws.on("close", () => {
				this._cleanup(ws, record);
			});

			ws.on("error", () => {
				this._cleanup(ws, record);
			});
		});
	}

	// -------------------------------------------------------------------------
	// Client mesaj işleyicisi
	// -------------------------------------------------------------------------

	private _handleClientMessage(ws: WebSocket, record: ClientRecord, msg: WSMessage): void {
		switch (msg.type) {
			case "subscribe": {
				const projectId = msg.projectId;
				if (!projectId) {
					this._send(ws, { type: "error", payload: { message: "projectId zorunlu" } });
					return;
				}
				// Malformed ids get the same answer as a missing project, without touching the DB.
				if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
					this._send(ws, { type: "error", payload: { message: "Project not found" } });
					return;
				}
				// _subscribe async kimlik + tenant kontrolü yapar ve "subscribed" / "error" yanıtını kendisi gönderir.
				void this._subscribe(ws, record, projectId);
				break;
			}

			case "unsubscribe": {
				const projectId = msg.projectId;
				if (typeof projectId !== "string" || !projectId) return;
				record.pendingSubscriptions?.delete(projectId);
				this._unsubscribe(record, projectId);
				this._send(ws, { type: "unsubscribed", projectId });
				break;
			}

			case "ping": {
				this._send(ws, { type: "pong" });
				break;
			}

			default:
				// Bilinmeyen tip — sessizce yoksay
				break;
		}
	}

	// -------------------------------------------------------------------------
	// Abonelik yönetimi
	// -------------------------------------------------------------------------

	private async _subscribe(ws: WebSocket, record: ClientRecord, projectId: string): Promise<void> {
		if (record.subscriptions.has(projectId)) return; // Zaten abone

		const pending = record.pendingSubscriptions ?? new Map<string, symbol>();
		record.pendingSubscriptions = pending;
		if (pending.has(projectId)) return;
		if (record.subscriptions.size + pending.size >= getWsConfig().maxSubscriptionsPerSocket) {
			this._send(ws, { type: "error", payload: { message: "Subscription limit reached" } });
			return;
		}

		// Tenant'ı olmayan client hiçbir projeye abone olamaz; yabancı, olmayan ve tenant'sız projeler aynı hatayı alır.
		if (record.tenantId === null) {
			this._send(ws, { type: "error", payload: { message: "Project not found" } });
			return;
		}

		const token = Symbol(projectId);
		pending.set(projectId, token);
		try {
			// Her abonelikte kimlik yeniden doğrulanır: silinmiş / tenant'tan çıkarılmış kullanıcının veya silinmiş / süresi
			// dolmuş API anahtarının soketi kapanır.
			if (record.apiKey) {
				const key = await lookupApiKey(record.apiKey.hash);
				if (!key || key.id !== record.apiKey.id || key.tenant_id !== record.tenantId || !key.role) {
					ws.close(1008, "Session ended");
					return;
				}
			} else if (record.userId && !record.systemIdentity) {
				const identity = await lookupIdentity(record.userId, record.tenantId);
				if (!identity || !identity.role) {
					ws.close(1008, "Session ended");
					return;
				}
			}

			if (projectId !== GLOBAL_PROJECT_ID) {
				const owner = await lookupProjectTenant(projectId);
				if (!owner || owner !== record.tenantId) {
					this._send(ws, { type: "error", payload: { message: "Project not found" } });
					return;
				}
			}

			// Kontroller sürerken soket kapanmış ya da abonelik iptal edilmiş olabilir; ref count sızdırma
			if (ws.readyState !== WebSocket.OPEN || pending.get(projectId) !== token) return;
			this._doSubscribe(record, projectId);
			this._send(ws, { type: "subscribed", projectId });
		} catch (err) {
			// DB hatası — fail-closed, subscribe etme
			log.warn({ err }, "[ws-manager] Tenant validation failed; subscription denied");
			this._send(ws, { type: "error", payload: { message: "Tenant validation failed" } });
		} finally {
			if (pending.get(projectId) === token) pending.delete(projectId);
		}
	}

	/** Gerçek abonelik mantığı — tenant kontrolü tamamlandıktan sonra çağrılır */
	private _doSubscribe(record: ClientRecord, projectId: string): void {
		if (record.subscriptions.has(projectId)) return;

		record.subscriptions.add(projectId);

		// Proje için ref count'u artır
		const prev = this.projectRefCounts.get(projectId) ?? 0;
		this.projectRefCounts.set(projectId, prev + 1);

		// İlk client aboneyse event-bus'a bağlan
		if (prev === 0) {
			const unsub = eventBus.onProject(projectId, (event: StudioEvent) => {
				this._onProjectEvent(projectId, event);
			});
			this.projectUnsubscribers.set(projectId, unsub);
		}
	}

	private _unsubscribe(record: ClientRecord, projectId: string): void {
		if (!record.subscriptions.has(projectId)) return;

		record.subscriptions.delete(projectId);

		const count = (this.projectRefCounts.get(projectId) ?? 1) - 1;
		if (count <= 0) {
			// Son client — event-bus aboneliğini kaldır
			this.projectRefCounts.delete(projectId);
			const unsub = this.projectUnsubscribers.get(projectId);
			if (unsub) {
				unsub();
				this.projectUnsubscribers.delete(projectId);
			}
		} else {
			this.projectRefCounts.set(projectId, count);
		}
	}

	// -------------------------------------------------------------------------
	// Event-bus olayını client'lara ilet
	// -------------------------------------------------------------------------

	private _onProjectEvent(projectId: string, event: StudioEvent): void {
		this.broadcastToProject(projectId, {
			type: "event",
			projectId,
			payload: event,
		});
	}

	// -------------------------------------------------------------------------
	// Heartbeat
	// -------------------------------------------------------------------------

	private _checkHeartbeat(ws: WebSocket, record: ClientRecord): void {
		if (ws.readyState !== WebSocket.OPEN) return;

		const now = Date.now();
		if (now - record.lastPong > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
			// Pong gelmedi — ölü bağlantı, kapat
			ws.terminate();
			return;
		}

		ws.ping();
	}

	// -------------------------------------------------------------------------
	// Temizlik
	// -------------------------------------------------------------------------

	private _cleanup(ws: WebSocket, record: ClientRecord): void {
		// Heartbeat timer'ı durdur
		if (record.pingTimer) {
			clearInterval(record.pingTimer);
		}
		if (record.expiryTimer) {
			clearTimeout(record.expiryTimer);
		}

		// Tüm abonelikleri kaldır
		for (const projectId of record.subscriptions) {
			this._unsubscribe(record, projectId);
		}

		this.clients.delete(ws);
	}

	// -------------------------------------------------------------------------
	// Yardımcı
	// -------------------------------------------------------------------------

	private _send(ws: WebSocket, msg: WSMessage): void {
		if (ws.readyState === WebSocket.OPEN) {
			try {
				ws.send(JSON.stringify(msg));
			} catch {
				// Gönderme hatası — yoksay
			}
		}
	}

	/** Graceful shutdown — clear all flush timers, close all connections */
	shutdown(): void {
		for (const timer of this._flushTimers.values()) clearTimeout(timer);
		this._flushTimers.clear();
		this._pendingBroadcasts.clear();
		for (const ws of this.clients.keys()) {
			try {
				ws.close(1001, "server shutdown");
			} catch {
				/* ignore */
			}
		}
		this.clients.clear();
		log.info("[ws-manager] Shutdown complete");
	}
}

// Singleton instance
export const wsManager = new WebSocketManager();
