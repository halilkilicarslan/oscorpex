// ---------------------------------------------------------------------------
// Oscorpex — Entry Point
// Default: boots kernel-only (no VoltAgent).
// Set OSCORPEX_MODE=voltagent to start with VoltAgent integration.
// ---------------------------------------------------------------------------

import "dotenv/config";

const mode = process.env.OSCORPEX_MODE ?? "kernel";

if (mode === "voltagent") {
	// Dynamic import — VoltAgent is optional; not imported at the top level
	// so the kernel can start without VoltAgent dependencies installed.
	await import("./entry-voltagent.js");
} else {
	const { bootAndServe } = await import("./boot.js");
	await bootAndServe();
}