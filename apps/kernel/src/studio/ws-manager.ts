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
import { verifyJwt } from "./auth/jwt.js";
import { eventBus } from "./event-bus.js";
import type { StudioEvent } from "./types.js";
import { createLogger } from "./logger.js";
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
	 * null = auth kapalı (backward compat) → tüm project event'leri iletilir.
	 * Dolu = sadece bu tenant'ın projeleri için gelen event'ler iletilir.
	 */
	tenantId: string | null;
	/** Correlation ID from the HTTP upgrade request (query param) */
	correlationId?: string;
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

	constructor() {
		// noServer: true — HTTP upgrade'ini kendimiz yöneteceğiz
		this.wss = new WebSocketServer({ noServer: true });
		this._setupWSS();
	}

	// -------------------------------------------------------------------------
	// Dışa açık API
	// -------------------------------------------------------------------------

	/**
	 * HTTP upgrade isteğini WebSocket bağlantısına yükseltir.
	 * `src/index.ts` veya Hono adapter'ından çağrılır.
	 */
	handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.wss.emit("connection", ws, req);
		});
	}

	/**
	 * Belirli bir projeye abone olan tüm client'lara mesaj gönderir.
	 * event-bus dışından (örn. agent-runtime) da kullanılabilir.
	 */
	broadcastToProject(projectId: string, message: WSMessage): void {
		const data = JSON.stringify(message);
		for (const [ws, record] of this.clients) {
			if (record.subscriptions.has(projectId) && ws.readyState === WebSocket.OPEN) {
				ws.send(data);
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
		this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
			// M6.4: Tenant isolation — URL query param ?token=<jwt> から tenantId çıkar.
			// Browser WS API header gönderemediğinden token query param olarak iletilir.
			// Auth enabled + no valid token → connection rejected (fail-closed).
			let tenantId: string | null = null;
			const authEnabled = process.env.OSCORPEX_AUTH_ENABLED === "true";
			if (authEnabled) {
				try {
					const url = new URL(req.url ?? "", "http://localhost");
					const token = url.searchParams.get("token");
					if (token) {
						const payload = verifyJwt(token);
						if (payload) {
							tenantId = payload.tenantId ?? null;
						} else {
							// Invalid token — close connection
							ws.close(1008, "Invalid token");
							return;
						}
					} else {
						// Auth enabled but no token — close connection
						ws.close(1008, "Authentication required");
						return;
					}
				} catch {
					// URL parse error — close connection in auth mode
					ws.close(1008, "Invalid connection URL");
					return;
				}
			}

			const record: ClientRecord = {
				ws,
				subscriptions: new Set(),
				lastPong: Date.now(),
				tenantId,
				correlationId: (req as any).correlationId,
			};
			this.clients.set(ws, record);

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
				// M6.4: tenantId varsa _subscribe async tenant kontrolü + "subscribed" yanıtı gönderir.
				// tenantId yoksa (auth kapalı) senkron yol — burada "subscribed" gönderilir.
				const isTenantScoped = record.tenantId !== null;
				this._subscribe(ws, record, projectId);
				if (!isTenantScoped) {
					this._send(ws, { type: "subscribed", projectId });
				}
				break;
			}

			case "unsubscribe": {
				const projectId = msg.projectId;
				if (!projectId) return;
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

	private _subscribe(ws: WebSocket, record: ClientRecord, projectId: string): void {
		if (record.subscriptions.has(projectId)) return; // Zaten abone

		// M6.4: Tenant isolation — eğer client'ın tenantId'si varsa, project'in
		// tenant_id'si ile eşleştiğini async kontrol et. Kontrol başarısız olursa
		// subscribe edilmez ve client'a error gönderilir. Auth kapalıysa (tenantId=null)
		// kontrol atlanır (backward compat).
		if (record.tenantId !== null) {
			import("./db.js")
				.then(({ queryOne: qOne }) =>
					qOne<{ tenant_id: string | null }>("SELECT tenant_id FROM projects WHERE id = $1", [projectId]),
				)
				.then((project) => {
					if (!project) {
						// Proje bulunamadı
						this._send(ws, { type: "error", payload: { message: "Project not found" } });
						return;
					}
					// Legacy projeler (tenant_id=null) tüm tenant'lara açık
					if (project.tenant_id !== null && project.tenant_id !== record.tenantId) {
						this._send(ws, { type: "error", payload: { message: "Access denied: tenant mismatch" } });
						return;
					}
					// Erişim onaylandı — gerçek subscribe işlemi
					this._doSubscribe(record, projectId);
					this._send(ws, { type: "subscribed", projectId });
				})
				.catch(() => {
					// DB hatası — backward compat için subscribe et
					this._doSubscribe(record, projectId);
					this._send(ws, { type: "subscribed", projectId });
				});
			return; // Async yol — _handleClientMessage içindeki "subscribed" yanıtını engelle
		}

		// Auth kapalı — doğrudan subscribe et
		this._doSubscribe(record, projectId);
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
}

// Singleton instance
export const wsManager = new WebSocketManager();
