// ---------------------------------------------------------------------------
// Oscorpex — Entry Point (kernel-only)
// Boots the Oscorpex kernel directly.
// ---------------------------------------------------------------------------

// boot-guard must be evaluated before boot.js so load-time throws of later imports are reported.
import { disarmBootGuard, reportBootFailure } from "./boot-guard.js";
import "dotenv/config";
import { bootAndServe } from "./boot.js";

try {
	await bootAndServe();
	disarmBootGuard();
} catch (err) {
	reportBootFailure(err);
}
