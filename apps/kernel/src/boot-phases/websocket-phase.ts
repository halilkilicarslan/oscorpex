// ---------------------------------------------------------------------------
// Boot Phase — WebSocket Server
// Non-blocking. Starts on fixed port 3142.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";
import { startWSServer } from "../studio/ws-server.js";

const log = createLogger("boot:websocket");

export function websocketPhase(): void {
	startWSServer();
	log.info("WebSocket server started");
}
