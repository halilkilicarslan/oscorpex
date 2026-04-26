// ---------------------------------------------------------------------------
// Composition — Barrel Export
// Side-effect wiring that was previously inlined in routes/index.ts.
// ---------------------------------------------------------------------------

export { registerSeeders } from "./register-seeders.js";
export { registerEventBridges } from "./register-event-bridges.js";
export { registerWebhookBridge } from "./register-webhook-bridge.js";
export { registerPluginBridge } from "./register-plugin-bridge.js";
export { registerNotificationBridge } from "./register-notification-bridge.js";
