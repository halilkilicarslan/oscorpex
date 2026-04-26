// ---------------------------------------------------------------------------
// Boot Phase — Webhook Sender Init
// Non-blocking warning on failure.
// ---------------------------------------------------------------------------

import { webhookSender } from "../studio/webhook-sender.js";
import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:webhook");

export function webhookPhase(): void {
	webhookSender.init();
	log.info("Webhook sender initialized");
}
