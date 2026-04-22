// ---------------------------------------------------------------------------
// Oscorpex — PgListener: Dedicated PostgreSQL LISTEN/NOTIFY connection
// ---------------------------------------------------------------------------
// Pool üzerinden pg_notify (notify methodu) + dedicated pg.Client ile LISTEN.
// Bu ayrım kritik: LISTEN dedicated bir bağlantı gerektirir, pool paylaşımı
// ile çalışmaz çünkü pool bağlantıları sorgu sonrası geri verilir.
// ---------------------------------------------------------------------------

import pg from "pg";
import { execute } from "./db.js";
import { createLogger } from "./logger.js";
const log = createLogger("pg-listener");

const CHANNEL = "oscorpex_events";
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

type NotificationPayload = {
	id: string;
	projectId: string;
	type: string;
};

type NotificationHandler = (payload: NotificationPayload) => void;

class PgListener {
	private client: pg.Client | null = null;
	private handlers = new Set<NotificationHandler>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private connected = false;
	private stopped = false;
	private reconnectAttempts = 0;

	/**
	 * Dedicated pg.Client bağlantısı açar ve LISTEN başlatır.
	 * Pool'dan ayrı olarak çalışır.
	 */
	async start(): Promise<void> {
		this.stopped = false;
		this.reconnectAttempts = 0;
		await this._connect();
	}

	private async _connect(): Promise<void> {
		const connectionString = process.env.DATABASE_URL ?? "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex";

		const client = new pg.Client({ connectionString });

		try {
			await client.connect();
		} catch (err) {
			log.warn("[pg-listener] Connection failed: " + (err instanceof Error ? err.message : String(err)));
			client.end().catch((err) => log.warn("[pg-listener] Non-blocking operation failed: " + (err?.message ?? String(err))));
			this._scheduleReconnect();
			return;
		}

		this.client = client;
		this.connected = true;
		this.reconnectAttempts = 0;

		client.on("notification", (msg) => {
			if (msg.channel !== CHANNEL || !msg.payload) return;
			try {
				const payload = JSON.parse(msg.payload) as NotificationPayload;
				for (const handler of this.handlers) {
					try {
						handler(payload);
					} catch {
						/* handler hatası — ignore */
					}
				}
			} catch {
				log.warn("[pg-listener] Failed to parse notification payload:" + " " + String(msg.payload));
			}
		});

		client.on("error", (err) => {
			log.warn("[pg-listener] Client error: " + (err instanceof Error ? err.message : String(err)));
			this.connected = false;
			this.client = null;
			if (!this.stopped) this._scheduleReconnect();
		});

		client.on("end", () => {
			this.connected = false;
			this.client = null;
			if (!this.stopped) {
				log.warn("[pg-listener] Connection ended unexpectedly, scheduling reconnect...");
				this._scheduleReconnect();
			}
		});

		try {
			await client.query(`LISTEN ${CHANNEL}`);
			console.info(`[pg-listener] Listening on channel: ${CHANNEL}`);
		} catch (err) {
			log.warn("[pg-listener] LISTEN failed: " + (err instanceof Error ? err.message : String(err)));
			this.connected = false;
			this.client = null;
			client.end().catch((err) => log.warn("[pg-listener] Non-blocking operation failed: " + (err?.message ?? String(err))));
			this._scheduleReconnect();
		}
	}

	private _scheduleReconnect(): void {
		if (this.stopped) return;
		if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			log.warn(`[pg-listener] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
			return;
		}

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.reconnectAttempts++;
		console.info(
			`[pg-listener] Reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
		);

		this.reconnectTimer = setTimeout(async () => {
			this.reconnectTimer = null;
			if (!this.stopped) await this._connect();
		}, RECONNECT_DELAY_MS);
	}

	/** UNLISTEN yapıp bağlantıyı kapatır */
	async stop(): Promise<void> {
		this.stopped = true;

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.client) {
			try {
				await this.client.query(`UNLISTEN ${CHANNEL}`);
			} catch {
				/* unlisten hatası — ignore */
			}
			try {
				await this.client.end();
			} catch {
				/* end hatası — ignore */
			}
			this.client = null;
		}

		this.connected = false;
		this.handlers.clear();
		console.info("[pg-listener] Stopped.");
	}

	/**
	 * Notification handler ekler.
	 * @returns unsubscribe fonksiyonu
	 */
	onNotification(handler: NotificationHandler): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	/**
	 * Pool üzerinden pg_notify gönderir.
	 * Dedicated client değil, execute() (pool) kullanır.
	 */
	async notify(payload: NotificationPayload): Promise<void> {
		await execute(`SELECT pg_notify($1, $2)`, [CHANNEL, JSON.stringify(payload)]);
	}

	get isConnected(): boolean {
		return this.connected;
	}
}

export const pgListener = new PgListener();
