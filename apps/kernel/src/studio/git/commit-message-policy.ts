// ---------------------------------------------------------------------------
// P9-E: Commit Message Policy
// Validates commit messages against subject-length rules and a basic
// secret-leakage check. Conventional Commit prefixes are detected but
// not enforced as hard errors (reserved for future stricter policy).
// ---------------------------------------------------------------------------

import type { CommitMessageValidation } from "./git-types.js";

const MAX_SUBJECT_LENGTH = 72;
const MIN_SUBJECT_LENGTH = 10;

const CONVENTIONAL_PREFIXES = [
	"feat",
	"fix",
	"docs",
	"style",
	"refactor",
	"perf",
	"test",
	"build",
	"ci",
	"chore",
	"revert",
];

/** Patterns that indicate a secret may have been accidentally pasted into the message */
const SECRET_PATTERNS: RegExp[] = [
	/sk-[A-Za-z0-9]{20,}/,
	/ghp_[A-Za-z0-9]{36,}/,
	/AKIA[A-Z0-9]{16}/,
	/password\s*[:=]/i,
];

/**
 * Validate a commit message string.
 * Returns `valid: true` only when all checks pass.
 * All violations are accumulated before returning so callers get the full list.
 */
export function validateCommitMessage(message: string): CommitMessageValidation {
	const errors: string[] = [];
	const trimmed = message.trim();

	if (!trimmed) {
		return { valid: false, errors: ["Commit message is empty"] };
	}

	const [subject] = trimmed.split("\n");

	// Subject line length
	if (subject.length > MAX_SUBJECT_LENGTH) {
		errors.push(`Subject line exceeds ${MAX_SUBJECT_LENGTH} characters (${subject.length})`);
	}
	if (subject.length < MIN_SUBJECT_LENGTH) {
		errors.push(`Subject line too short (minimum ${MIN_SUBJECT_LENGTH} characters)`);
	}

	// Trailing period is a common convention violation
	if (subject.endsWith(".")) {
		errors.push("Subject line should not end with a period");
	}

	// Conventional commit prefix — informational only, not enforced
	const _hasConventionalPrefix = CONVENTIONAL_PREFIXES.some(
		(p) => subject.startsWith(`${p}:`) || subject.startsWith(`${p}(`),
	);

	// Secret leakage check
	for (const pattern of SECRET_PATTERNS) {
		if (pattern.test(trimmed)) {
			errors.push("Commit message appears to contain a secret or credential");
			break;
		}
	}

	return { valid: errors.length === 0, errors };
}
