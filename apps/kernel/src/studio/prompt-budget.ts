// ---------------------------------------------------------------------------
// Oscorpex — Prompt Budget Helper
// Measures prompt size, enforces limits, and emits telemetry so runaway
// prompts are visible in observability dashboards.
// ---------------------------------------------------------------------------

import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
const log = createLogger("prompt-budget");

// Rough char → token estimation (Anthropic: ~4 chars per token for English/code)
const CHARS_PER_TOKEN = 4;

// Hard limits (characters) before we truncate
export const PROMPT_LIMITS = {
	/** Max chars for a single task.description block (user-supplied, untrusted size) */
	taskDescription: 10_000,
	/** Max total prompt size (user message). Claude Sonnet 4.6 context ~200k tokens. */
	totalPrompt: 400_000, // ~100k tokens — leaves room for system prompt + response
	/** Warn threshold (% of totalPrompt) */
	warnThreshold: 0.75,
} as const;

export interface PromptSizeReport {
	chars: number;
	estimatedTokens: number;
	truncated: boolean;
	overLimit: boolean;
	warn: boolean;
	/** Breakdown of context section sizes (chars) — set by caller if available */
	contextSections?: Record<string, number>;
}

/** Rough token estimate from char count. */
export function estimateTokens(chars: number): number {
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Truncate text with a suffix marker if over the limit. */
export function capText(text: string, maxChars: number, marker = "\n…[truncated]"): string {
	if (!text || text.length <= maxChars) return text;
	return text.slice(0, maxChars - marker.length) + marker;
}

/**
 * Measure a prompt, warn/truncate if needed, and emit telemetry.
 * Returns the (possibly truncated) prompt plus a size report.
 */
export function enforcePromptBudget(
	prompt: string,
	ctx: { projectId: string; taskId?: string; agentId?: string; contextSections?: Record<string, number> },
): { prompt: string; report: PromptSizeReport } {
	const chars = prompt.length;
	const estimatedTokens = estimateTokens(chars);
	const warnLimit = PROMPT_LIMITS.totalPrompt * PROMPT_LIMITS.warnThreshold;

	let finalPrompt = prompt;
	let truncated = false;
	const overLimit = chars > PROMPT_LIMITS.totalPrompt;
	const warn = chars > warnLimit;

	if (overLimit) {
		finalPrompt = capText(prompt, PROMPT_LIMITS.totalPrompt);
		truncated = true;
		log.warn(
			`[prompt-budget] Prompt truncated: ${chars} → ${finalPrompt.length} chars ` +
				`(project=${ctx.projectId}, task=${ctx.taskId ?? "n/a"})`,
		);
	} else if (warn) {
		log.warn(
			`[prompt-budget] Prompt near limit: ${chars} chars (~${estimatedTokens} tokens) ` +
				`(project=${ctx.projectId}, task=${ctx.taskId ?? "n/a"})`,
		);
	}

	const report: PromptSizeReport = {
		chars: finalPrompt.length,
		estimatedTokens: estimateTokens(finalPrompt.length),
		truncated,
		overLimit,
		warn,
		contextSections: ctx.contextSections,
	};

	// Emit telemetry so analytics/observability can pick it up
	eventBus.emitTransient({
		projectId: ctx.projectId,
		type: "prompt:size",
		agentId: ctx.agentId,
		taskId: ctx.taskId,
		payload: {
			chars: report.chars,
			estimatedTokens: report.estimatedTokens,
			truncated: report.truncated,
			overLimit: report.overLimit,
			warn: report.warn,
			limit: PROMPT_LIMITS.totalPrompt,
			...(report.contextSections ? { contextSections: report.contextSections } : {}),
		},
	});

	return { prompt: finalPrompt, report };
}
