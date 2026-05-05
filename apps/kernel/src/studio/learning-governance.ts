// ---------------------------------------------------------------------------
// Oscorpex — Learning Governance
// Pattern content validation and prompt injection detection for cross-project learning.
// Pure validation module — no DB dependencies.
// ---------------------------------------------------------------------------

import { createLogger } from "./logger.js";

const log = createLogger("learning-governance");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of pattern content validation */
export interface PatternValidationResult {
	valid: boolean;
	issues: string[];
	score: number; // 0-1, higher = more trustworthy
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prompt injection detection patterns */
const INJECTION_PATTERNS = [
	/ignore\s+(previous|all|above)\s+(instructions?|rules?|constraints?)/i,
	/disregard\s+(previous|all|above)/i,
	/forget\s+(previous|all|your)\s+(instructions?|rules?)/i,
	/you\s+are\s+now\s+/i,
	/new\s+instructions?:/i,
	/system\s*:\s*/i,
	/\boverride\b.*\b(policy|security|safety|restriction)/i,
	/bypass\s+(security|safety|auth|check|guard|filter|validation)/i,
	/execute\s+arbitrary/i,
	/ignore[_ ]safety/i,
	/without\s+(review|approval|check|validation)/i,
	/always\s+approve/i,
	/skip\s+(review|test|check|validation|security)/i,
	/\bRUN\s+AS\s+(ROOT|ADMIN)\b/i,
	/sudo\s+/i,
	/chmod\s+777/i,
	/rm\s+-rf\s+\//i,
	/DROP\s+(DATABASE|TABLE|SCHEMA)/i,
	/DELETE\s+FROM\s+\w+\s*;?\s*$/i,
	/eval\s*\(/i,
	/exec\s*\(/i,
	/<script[\s>]/i,
	/javascript:/i,
];

/** Maximum allowed length for string fields in patterns */
const MAX_FIELD_LENGTH = 500;

/** Maximum allowed depth for pattern JSONB */
const MAX_PATTERN_DEPTH = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects prompt injection attempts in a text string.
 * Returns array of matched injection patterns (empty if clean).
 */
export function detectPromptInjection(text: string): string[] {
	const matches: string[] = [];
	for (const pattern of INJECTION_PATTERNS) {
		if (pattern.test(text)) {
			matches.push(pattern.source);
		}
	}
	return matches;
}

/**
 * Validates a learning pattern's content for safety.
 * Checks for:
 * - Prompt injection in string values
 * - Excessive field lengths
 * - Excessive nesting depth
 * - Suspicious field names
 */
export function validatePatternContent(pattern: Record<string, unknown>): PatternValidationResult {
	const issues: string[] = [];
	let score = 1.0;

	// Check depth
	const depth = measureDepth(pattern);
	if (depth > MAX_PATTERN_DEPTH) {
		issues.push(`Pattern depth ${depth} exceeds max ${MAX_PATTERN_DEPTH}`);
		score -= 0.3;
	}

	// Scan all string values for injection
	const strings = extractStrings(pattern);
	for (const { path, value } of strings) {
		// Length check
		if (value.length > MAX_FIELD_LENGTH) {
			issues.push(`Field "${path}" exceeds max length (${value.length}/${MAX_FIELD_LENGTH})`);
			score -= 0.2;
		}

		// Injection check
		const injections = detectPromptInjection(value);
		if (injections.length > 0) {
			issues.push(`Field "${path}" contains potential prompt injection (${injections.length} pattern(s))`);
			score -= 0.5 * injections.length;
		}
	}

	// Clamp score
	score = Math.max(0, Math.min(1, score));

	if (issues.length > 0) {
		log.warn({ issues, score }, "[learning-governance] Pattern validation issues detected");
	}

	return { valid: issues.length === 0, issues, score };
}

/**
 * Sanitizes a string for safe inclusion in LLM prompts.
 * Strips potential injection markers and truncates to safe length.
 */
export function sanitizeForPrompt(text: string, maxLength = MAX_FIELD_LENGTH): string {
	let clean = text;

	// Remove common injection prefixes
	clean = clean.replace(/^(system|assistant|user)\s*:\s*/gi, "");

	// Strip markdown headers that could override prompt structure
	clean = clean.replace(/^#{1,6}\s+/gm, "");

	// Remove potential code blocks that could contain instructions
	clean = clean.replace(/```[\s\S]*?```/g, "[code block removed]");

	// Truncate
	if (clean.length > maxLength) {
		clean = `${clean.slice(0, maxLength)}…`;
	}

	return clean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function measureDepth(obj: unknown, current = 0): number {
	if (current > 10) return current; // safety bail
	if (obj === null || typeof obj !== "object") return current;
	let max = current;
	for (const val of Object.values(obj as Record<string, unknown>)) {
		max = Math.max(max, measureDepth(val, current + 1));
	}
	return max;
}

function extractStrings(obj: unknown, prefix = ""): Array<{ path: string; value: string }> {
	const result: Array<{ path: string; value: string }> = [];
	if (typeof obj === "string") {
		result.push({ path: prefix || "root", value: obj });
	} else if (obj !== null && typeof obj === "object") {
		for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
			const path = prefix ? `${prefix}.${key}` : key;
			result.push(...extractStrings(val, path));
		}
	}
	return result;
}
