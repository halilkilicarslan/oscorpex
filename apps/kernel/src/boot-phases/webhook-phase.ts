// ---------------------------------------------------------------------------
// Boot Phase — Webhook Sender Init
// Non-blocking warning on failure.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";
import { webhookSender } from "../studio/webhook-sender.js";

const log = createLogger("boot:webhook");

export function webhookPhase(): void {
	webhookSender.init();
	log.info("Webhook sender initialized");
}
