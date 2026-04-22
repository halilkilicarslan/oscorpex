// ---------------------------------------------------------------------------
// Oscorpex — Agent Runtime: barrel export
// ---------------------------------------------------------------------------

export { loadBehavioralContext, formatBehavioralPrompt } from "./agent-memory.js";
export { selectStrategy, BUILTIN_STRATEGIES, type StrategySelection } from "./agent-strategy.js";
export {
	initSession,
	recordStep,
	completeSession,
	failSession,
	type SessionContext,
} from "./agent-session.js";
export {
	loadProtocolContext,
	acknowledgeMessages,
	requestInfo,
	signalBlocker,
	handoffArtifact,
	recordDesignDecision,
} from "./agent-protocol.js";
export {
	checkConstraints,
	canAutoApprove,
	classifyRisk,
	type ConstraintCheck,
} from "./agent-constraints.js";
import { createLogger } from "../logger.js";
const log = createLogger("index");
export { proposeTask, type InjectionRequest, type InjectionResult } from "./task-injection.js";
