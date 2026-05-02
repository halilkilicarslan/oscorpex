// ---------------------------------------------------------------------------
// Oscorpex — Execution Watchdog
// Periodically kicks dispatch recovery when running pipelines have ready work
// but no visible active execution.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";

const log = createLogger("execution-watchdog");

export class ExecutionWatchdog {
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly runDispatchWatchdog: () => Promise<void>,
		private readonly intervalMs = 15_000,
	) {}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.runDispatchWatchdog().catch((err) => {
				log.warn("[execution-watchdog] Dispatch watchdog failed (non-blocking):" + " " + String(err));
			});
		}, this.intervalMs);
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}
}
