// ---------------------------------------------------------------------------
// P9-D: Secret Scan
// Scans staged files for common secret patterns before allowing a commit
// proposal to proceed. Binary files are skipped. One finding per line
// (first matching pattern wins to avoid duplicate alerts for the same line).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../logger.js";
import type { SecretScanResult } from "./git-types.js";

const log = createLogger("secret-scan");

/** Extensions that are always binary — skip them entirely */
const BINARY_EXTENSION_RE =
	/\.(png|jpe?g|gif|ico|woff2?|ttf|eot|svg|mp4|webm|zip|tar|gz|pdf|bin|exe|so|dylib|class|wasm)$/i;

interface SecretPattern {
	category: string;
	pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
	{ category: "aws_access_key", pattern: /AKIA[A-Z0-9]{16}/ },
	{
		category: "aws_secret_key",
		pattern: /(?:aws_secret|AWS_SECRET)[_A-Z]*\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/,
	},
	{ category: "github_token", pattern: /gh[ps]_[A-Za-z0-9]{36,}/ },
	{ category: "private_key", pattern: /-----BEGIN\s+(?:RSA|OPENSSH|EC|DSA)\s+PRIVATE\s+KEY-----/ },
	{
		category: "generic_api_key",
		pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}/i,
	},
	{
		category: "generic_secret",
		pattern: /(?:secret|password)\s*[=:]\s*["']?[^\s"']{8,}/i,
	},
	{ category: "jwt_token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/ },
	{ category: "connection_string", pattern: /(?:postgres|mysql|mongodb):\/\/[^:]+:[^@]+@/ },
	{ category: "anthropic_key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
	{ category: "openai_key", pattern: /sk-[A-Za-z0-9]{20,}/ },
	{
		category: "env_assignment",
		pattern: /^[A-Z_]{3,}(?:_SECRET|_TOKEN|_KEY|_PASSWORD)\s*=\s*\S+/m,
	},
	{ category: "slack_token", pattern: /xox[bpras]-[A-Za-z0-9-]+/ },
];

/**
 * Scan the given staged files for known secret patterns.
 *
 * @param repoPath - Absolute path to the git repository root
 * @param stagedFiles - Relative file paths from `git diff --cached --name-only`
 */
export function scanStagedForSecrets(repoPath: string, stagedFiles: string[]): SecretScanResult {
	const findings: Array<{ file: string; category: string; line: number }> = [];

	for (const file of stagedFiles) {
		// Skip binary files by extension
		if (BINARY_EXTENSION_RE.test(file)) continue;

		let content: string;
		try {
			content = readFileSync(join(repoPath, file), "utf8");
		} catch {
			// File may be deleted (staged deletion) or unreadable — skip silently
			continue;
		}

		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			for (const { category, pattern } of SECRET_PATTERNS) {
				if (pattern.test(lines[i])) {
					findings.push({ file, category, line: i + 1 });
					break; // One finding per line — first match wins
				}
			}
		}
	}

	if (findings.length > 0) {
		log.warn(
			{ count: findings.length, files: [...new Set(findings.map((f) => f.file))] },
			"[secret-scan] Secrets detected in staged files",
		);
	}

	return { passed: findings.length === 0, findings };
}
