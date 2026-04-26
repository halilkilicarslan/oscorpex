// ---------------------------------------------------------------------------
// Oscorpex — Entry Point (kernel-only)
// Boots the Oscorpex kernel directly.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { bootAndServe } from "./boot.js";

await bootAndServe();