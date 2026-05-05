// ---------------------------------------------------------------------------
// apps/kernel/src/studio/app-runner.ts — Thin re-export facade
// Implementation lives in app-runner/ sub-modules.
// ---------------------------------------------------------------------------

export type { AppRunnerStatus, RunningService, ServiceConfig, StudioConfig } from "./app-runner/types.js";

export {
	autoDetect,
	detectDockerCompose,
	detectLanguage,
	getResolvedConfig,
	loadStudioConfig,
	resolveConfig,
} from "./app-runner/detection.js";

export { isPortInUse, postStartHealthCheck, RESERVED_PORTS, resolvePort } from "./app-runner/port-manager.js";

export { getAppStatus, startService, stopApp, switchPreviewService } from "./app-runner/process-manager.js";

export { startApp, startFromConfig } from "./app-runner/starter.js";
