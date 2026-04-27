// ---------------------------------------------------------------------------
// Oscorpex — Standalone WebSocket HTTP Server
//
// Ana Hono sunucusu ile aynı portu paylaşmak mümkün olmadığından
// WebSocket bağlantıları için bağımsız bir HTTP sunucusu açılır.
//
// Varsayılan port: 3142 (STUDIO_WS_PORT env değişkeniyle değiştirilebilir)
//
// Endpoint: ws://localhost:3142/api/studio/ws
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

import { createServer } from "node:http";
import { wsManager } from "./ws-manager.js";
import { createLogger } from "./logger.js";
const log = createLogger("ws-server");

const WS_PORT = Number(process.env.STUDIO_WS_PORT ?? 3142);
const WS_PATH = "/api/studio/ws";

export function startWSServer(): void {
	const httpServer = createServer((_req, res) => {
		// HTTP isteklerini reddeder — bu sunucu yalnızca WebSocket için
		res.writeHead(426, { "Content-Type": "text/plain" });
		res.end("WebSocket yükseltmesi gerekli");
	});

	// WebSocket upgrade isteklerini yönlendir
	httpServer.on("upgrade", (req, socket, head) => {
		const url = req.url ?? "";

		// Yalnızca doğru path'e gelen istekleri kabul et
		if (url !== WS_PATH && !url.startsWith(`${WS_PATH}?`)) {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}

		// Extract correlationId from query param for tracing WebSocket events
		try {
			const parsed = new URL(url, "http://localhost");
			const correlationId = parsed.searchParams.get("correlationId");
			if (correlationId) {
				(req as any).correlationId = correlationId;
			}
		} catch {
			// ignore parse errors
		}

		wsManager.handleUpgrade(req, socket, head);
	});

	httpServer.listen(WS_PORT, "0.0.0.0", () => {
		log.info(`[ws-server] WebSocket sunucusu dinleniyor: ws://localhost:${WS_PORT}${WS_PATH}`);
	});

	httpServer.on("error", (err) => {
		log.error("[ws-server] Sunucu hatası:" + " " + String(err.message));
	});
}
