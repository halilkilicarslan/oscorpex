// ---------------------------------------------------------------------------
// Oscorpex — db.ts (backward-compat shim)
// All logic has been moved to modular src/studio/db/ directory.
// This file re-exports everything from the new modules to maintain
// full backward compatibility with existing imports.
// ---------------------------------------------------------------------------

export * from "./db/index.js";
