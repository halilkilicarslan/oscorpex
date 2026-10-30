// ---------------------------------------------------------------------------
// Oscorpex — Standalone WebSocket HTTP Server
//
// Ana Hono sunucusu ile aynı portu paylaşmak mümkün olmadığından
// WebSocket bağlantıları için bağımsız bir HTTP sunucusu açılır.
//
// Varsayılan port: 3142 (STUDIO_WS_PORT env değişkeniyle değiştirilebilir)
//
// Endpoint: ws://localhost:3142/api/studio/ws?ticket=<ticket>
//   Ticket: POST /api/studio/ws/ticket (authenticated), 30 s, single use. Origin must be in OSCORPEX_CORS_ORIGINS.
//
// Protokol:
//   Client -> Server:
//     { type: 'subscribe',   projectId: string }  — Projeye abone ol
//     { type: 'unsubscribe', projectId: string }  — Aboneliği iptal et
//     { type: 'ping' }                             — Heartbeat
//
//   Server -> Client:
//     { type: 'subscribed',   projectId }          — Abone onayı
//     { type: 'unsubscribed', projectId }          — Abonelik iptali onayı
//     { type: 'event',        projectId, payload } — StudioEvent
//     { type: 'agent:output', projectId, agentId, payload: { line, index } }
//     { type: 'pong' }                             — Heartbeat yanıtı
//     { type: 'error',        payload: { message } }
// ---------------------------------------------------------------------------

import type { IncomingMessage, Server } from "node:http";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import {
	DEV_USER_ID,
	LOCAL_TENANT_ID,
	devAuthBypassEnabled,
	lookupApiKey,
	lookupIdentity,
} from "./auth/auth-middleware.js";
import { getAllowedOrigins } from "./auth/cors-origins.js";
import { createLogger } from "./logger.js";
import { getWsConfig } from "./performance-config.js";
import { wsManager } from "./ws-manager.js";
import type { WsIdentity } from "./ws-manager.js";
import { consumeWsTicket } from "./ws-ticket.js";
const log = createLogger("ws-server");

/** IncomingMessage augmented with the correlation id parsed during upgrade handling. */
interface AugmentedRequest extends IncomingMessage {
	correlationId?: string;
}

const WS_PATH = "/api/studio/ws";

function reject(socket: Duplex, status: 401 | 403 | 404): void {
	const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Not Found";
	socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
	socket.destroy();
}

/** Browsers always send Origin on a WebSocket handshake; its absence means a non-browser client (a ticket is still required). */
function originAllowed(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	return origin === undefined || getAllowedOrigins().includes(origin);
}

/** Resolves the connecting identity: a valid single-use ticket, or the dev bypass. Null = reject with 401. */
async function authenticate(ticket: string | null): Promise<WsIdentity | null> {
	const now = Date.now();
	const sessionEnd = now + getWsConfig().sessionMaxMs;
	if (!ticket) {
		if (!devAuthBypassEnabled()) return null;
		return { userId: DEV_USER_ID, tenantId: LOCAL_TENANT_ID, endsAt: sessionEnd, systemIdentity: true };
	}
	const stored = consumeWsTicket(ticket);
	if (!stored) return null;
	if (stored.tokenExpiresAt !== undefined && stored.tokenExpiresAt <= now) return null;
	const endsAt = Math.min(sessionEnd, stored.tokenExpiresAt ?? sessionEnd);
	const base = { userId: stored.userId, tenantId: stored.tenantId, endsAt };

	if (stored.authType === "api-key" || stored.authType === "none") return { ...base, systemIdentity: true };
	if (stored.authType === "api-key-db") {
		if (!stored.apiKeyId || !stored.apiKeyHash) return null;
		const key = await lookupApiKey(stored.apiKeyHash);
		if (!key || key.id !== stored.apiKeyId || key.tenant_id !== stored.tenantId || !key.role) return null;
		return { ...base, apiKey: { id: stored.apiKeyId, hash: stored.apiKeyHash } };
	}
	// The user may have been deleted or removed from the tenant since the ticket was minted.
	const identity = await lookupIdentity(stored.userId, stored.tenantId);
	if (!identity || !identity.role) return null;
	return base;
}

export function startWSServer(opts: { port?: number } = {}): Server {
	const port = opts.port ?? Number(process.env.STUDIO_WS_PORT ?? 3142);
	const httpServer = createServer((_req, res) => {
		// HTTP isteklerini reddeder — bu sunucu yalnızca WebSocket için
		res.writeHead(426, { "Content-Type": "text/plain" });
		res.end("WebSocket yükseltmesi gerekli");
	});

	// WebSocket upgrade isteklerini yönlendir; kimlik ve Origin, WebSocket oluşturulmadan önce doğrulanır
	httpServer.on("upgrade", (req, socket, head) => {
		const url = req.url ?? "";

		// Yalnızca doğru path'e gelen istekleri kabul et
		if (url !== WS_PATH && !url.startsWith(`${WS_PATH}?`)) {
			reject(socket, 404);
			return;
		}

		if (!originAllowed(req)) {
			reject(socket, 403);
			return;
		}

		let ticket: string | null = null;
		try {
			const parsed = new URL(url, "http://localhost");
			const correlationId = parsed.searchParams.get("correlationId");
			if (correlationId) (req as AugmentedRequest).correlationId = correlationId;
			ticket = parsed.searchParams.get("ticket");
		} catch {
			reject(socket, 401);
			return;
		}

		socket.on("error", () => {});
		authenticate(ticket)
			.then((identity) => {
				if (socket.destroyed) return;
				if (!identity) {
					reject(socket, 401);
					return;
				}
				wsManager.handleUpgrade(req, socket, head, identity);
			})
			.catch((err) => {
				log.warn({ err }, "[ws-server] upgrade authentication failed");
				if (!socket.destroyed) reject(socket, 401);
			});
	});

	const hostname = process.env.NODE_ENV === "production" ? "0.0.0.0" : (process.env.HOST ?? "127.0.0.1");
	httpServer.listen(port, hostname, () => {
		log.info(`[ws-server] WebSocket sunucusu dinleniyor: ws://${hostname}:${port}${WS_PATH}`);
	});

	httpServer.on("error", (err) => {
		log.error(`[ws-server] Sunucu hatası: ${String(err.message)}`);
	});

	return httpServer;
}
