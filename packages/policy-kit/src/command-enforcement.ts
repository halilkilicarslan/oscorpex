// @oscorpex/policy-kit — Runtime command validation
// Pure command policy enforcement functions.
// No DB or event-bus dependencies — those remain in the kernel layer.

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CommandCheckResult {
	allowed: boolean;
	command: string;
	matchedPattern?: string; // Which deny/allow pattern matched
	reason: string;
}

export interface CommandAuditResult {
	commands: CommandCheckResult[];
	totalChecked: number;
	violations: CommandCheckResult[]; // Only denied ones
	hasViolations: boolean;
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/**
 * Simple glob matching where `*` matches any sequence of characters.
 * Case-insensitive so SQL patterns like `DROP DATABASE*` work correctly.
 */
export function matchesGlobPattern(command: string, pattern: string): boolean {
	const lowerCommand = command.toLowerCase();
	const lowerPattern = pattern.toLowerCase();

	// Fast path: no wildcard
	if (!lowerPattern.includes("*")) {
		return lowerCommand === lowerPattern;
	}

	// Split pattern on `*` and match sequentially
	const segments = lowerPattern.split("*");
	let pos = 0;

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];

		if (i === 0) {
			// First segment must match at the start
			if (!lowerCommand.startsWith(seg)) return false;
			pos = seg.length;
		} else if (i === segments.length - 1) {
			// Last segment must match at the end
			if (seg === "") break; // trailing `*` — anything matches
			if (!lowerCommand.endsWith(seg)) return false;
			if (lowerCommand.length - seg.length < pos) return false;
		} else {
			// Middle segment must appear somewhere after current position
			if (seg === "") continue; // consecutive `**` — skip
			const found = lowerCommand.indexOf(seg, pos);
			if (found === -1) return false;
			pos = found + seg.length;
		}
	}

	return true;
}

// ---------------------------------------------------------------------------
// Single-command check
// ---------------------------------------------------------------------------

/**
 * Determine whether a command is allowed by the given policy.
 *
 * Evaluation order:
 * 1. Denied patterns — if any match, the command is denied immediately.
 * 2. Allowed patterns — if none match (and the allow-list is non-empty and
 *    does not contain the wildcard `*`), the command is denied.
 * 3. Otherwise the command is allowed.
 */
export function checkCommandAllowed(
	command: string,
	allowedPatterns: string[],
	deniedPatterns: string[],
): CommandCheckResult {
	// Step 1: check deny-list first
	for (const pattern of deniedPatterns) {
		if (matchesGlobPattern(command, pattern)) {
			return {
				allowed: false,
				command,
				matchedPattern: pattern,
				reason: `Command matches denied pattern "${pattern}"`,
			};
		}
	}

	// Step 2: check allow-list
	if (allowedPatterns.length === 0) {
		// No allow-list configured — deny everything not explicitly denied
		return { allowed: false, command, reason: "No allowed patterns configured" };
	}

	// Wildcard allow-list — permit all non-denied commands
	if (allowedPatterns.includes("*")) {
		return { allowed: true, command, matchedPattern: "*", reason: "Allowed by wildcard pattern" };
	}

	for (const pattern of allowedPatterns) {
		if (matchesGlobPattern(command, pattern)) {
			return {
				allowed: true,
				command,
				matchedPattern: pattern,
				reason: `Command matches allowed pattern "${pattern}"`,
			};
		}
	}

	return {
		allowed: false,
		command,
		reason: "Command does not match any allowed pattern",
	};
}

// ---------------------------------------------------------------------------
// Batch validation
// ---------------------------------------------------------------------------

/**
 * Validate a list of commands against the policy and aggregate results.
 */
export function validateCommandBatch(
	commands: string[],
	allowedPatterns: string[],
	deniedPatterns: string[],
): CommandAuditResult {
	const results = commands.map((cmd) => checkCommandAllowed(cmd, allowedPatterns, deniedPatterns));
	const violations = results.filter((r) => !r.allowed);

	return {
		commands: results,
		totalChecked: results.length,
		violations,
		hasViolations: violations.length > 0,
	};
}

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

/**
 * Known shell commands used to detect bare command lines in log output.
 * Sorted by specificity (longer prefixes first) to avoid false negatives.
 */
const KNOWN_SHELL_COMMANDS = [
	"git",
	"npm",
	"npx",
	"pnpm",
	"yarn",
	"node",
	"python",
	"python3",
	"pip",
	"pip3",
	"rm",
	"cp",
	"mv",
	"mkdir",
	"chmod",
	"chown",
	"curl",
	"wget",
	"tar",
	"unzip",
	"zip",
	"grep",
	"find",
	"cat",
	"echo",
	"export",
	"source",
	"sh",
	"bash",
	"zsh",
	"docker",
	"kubectl",
	"make",
	"cargo",
	"go",
	"rustc",
	"tsc",
	"eslint",
	"prettier",
	"vitest",
	"jest",
	"mocha",
	"psql",
	"mysql",
	"redis-cli",
	"ffmpeg",
	"ssh",
	"scp",
	"rsync",
	"openssl",
	"sed",
	"awk",
	"sort",
	"head",
	"tail",
	"wc",
	"xargs",
	"env",
	"kill",
	"pkill",
	"ps",
	"lsof",
	"netstat",
	"ping",
	"nslookup",
	"dig",
	"ln",
	"touch",
	"dd",
	"df",
	"du",
	"mount",
	"umount",
	"systemctl",
	"service",
	"apt",
	"apt-get",
	"yum",
	"brew",
];

// Pre-built regex for prompt-prefixed lines: `$ cmd`, `> cmd`, `Running: cmd`
const PROMPT_LINE_RE = /^(?:\$|>|Running:)\s+(.+)$/;

// Pre-built regex to detect a line that starts with a known shell command token
const KNOWN_CMD_RE = new RegExp(
	`^(${KNOWN_SHELL_COMMANDS.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:\\s|$)`,
);

/**
 * Extract shell commands from Claude CLI log output.
 * Detects lines prefixed with `$`, `>`, or `Running:`, and bare lines that
 * begin with a known shell command token. Returns a deduplicated list.
 */
export function parseCommandsFromLog(logLines: string[]): string[] {
	const seen = new Set<string>();
	const commands: string[] = [];

	for (const raw of logLines) {
		const line = raw.trim();
		if (!line) continue;

		let candidate: string | null = null;

		// Priority 1: explicit prompt prefix
		const promptMatch = PROMPT_LINE_RE.exec(line);
		if (promptMatch) {
			candidate = promptMatch[1].trim();
		} else if (KNOWN_CMD_RE.test(line)) {
			// Priority 2: bare line starting with a known command
			candidate = line;
		}

		if (candidate && !seen.has(candidate)) {
			seen.add(candidate);
			commands.push(candidate);
		}
	}

	return commands;
}
