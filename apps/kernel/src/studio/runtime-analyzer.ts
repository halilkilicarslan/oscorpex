// ---------------------------------------------------------------------------
// Oscorpex — Runtime Analyzer — Thin re-export facade
// ---------------------------------------------------------------------------

export { analyzeProject, generateStudioConfig, writeEnvFile } from "./runtime-analyzer/index.js";
export type {
	DatabaseType,
	DetectedDatabase,
	DetectedService,
	EnvVarRequirement,
	FrameworkDetection,
	FrameworkType,
	RuntimeRequirements,
} from "./runtime-analyzer/types.js";
