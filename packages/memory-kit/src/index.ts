// @oscorpex/memory-kit — Context packet builder and memory management
// Pure context assembly functions extracted from kernel's context-packet.ts.
// No DB or event-bus dependencies — those remain in the kernel layer.

// Re-export canonical types from @oscorpex/core
export type {
	ContextPacketMode,
	ContextPacket,
	ContextPacketOptions,
	ProjectContextSnapshot,
	MemoryFact,
} from "@oscorpex/core";

// Context packet builder utilities (pure functions)
export {
	CHARS_PER_TOKEN,
	DEFAULT_MAX_TOKENS,
	SECTION_BUDGETS,
	estimateTokens,
	capSection,
	buildSection,
	summarizeAgent,
	summarizeTask,
	assemblePlannerPrompt,
	assembleTeamArchitectPrompt,
} from "./context-packet.js";
export type { SectionResult, ContextData } from "./context-packet.js";