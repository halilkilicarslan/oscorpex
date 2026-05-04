// ---------------------------------------------------------------------------
// Oscorpex — AI Planner — Public API (re-exports from focused modules)
// ---------------------------------------------------------------------------

import { createLogger } from "./logger.js";

export { PM_SYSTEM_PROMPT } from "./pm-agent-prompts.js";
export {
	AVG_INPUT_TOKENS_PER_TASK,
	AVG_OUTPUT_TOKENS_PER_TASK,
	buildPlan,
	estimatePlanCost,
	phaseSchema,
	pmToolkit,
} from "./pm-agent-tools.js";
export type { PhaseInput, PlanCostEstimate } from "./pm-agent-tools.js";

const log = createLogger("pm-agent");

// Module loaded — logger available for future use
void log;
