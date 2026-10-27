import { createLogger } from "../logger.js";

const log = createLogger("secret-guard");

const SECRET_PATTERNS = [
	/API_KEY\s*[=:]/i,
	/SECRET\s*[=:]/i,
	/TOKEN\s*[=:]/i,
	/DATABASE_URL\s*[=:]/i,
	/PRIVATE\s*KEY/i,
	/BEGIN\s+(RSA|OPENSSH|EC|DSA)\s+PRIVATE\s+KEY/i,
	/sk-[a-zA-Z0-9]{20,}/,
	/ghp_[a-zA-Z0-9]{36,}/,
	/gho_[a-zA-Z0-9]{36,}/,
	/xoxb-[a-zA-Z0-9-]+/,
	/xoxp-[a-zA-Z0-9-]+/,
	/AKIA[A-Z0-9]{16}/,
	/password\s*[=:]\s*["'][^"']+["']/i,
	// Expanded patterns (P10-J)
	/(?:aws_secret|AWS_SECRET)[A-Z_]*\s*[=:]/i, // AWS Secret Key assignment
	/github_pat_[a-zA-Z0-9_]{20,}/, // GitHub fine-grained PAT
	/glpat-[a-zA-Z0-9_-]{20,}/, // GitLab PAT
	/sk_live_[a-zA-Z0-9]{24,}/, // Stripe live key
	/sk_test_[a-zA-Z0-9]{24,}/, // Stripe test key
	/rk_live_[a-zA-Z0-9]{24,}/, // Stripe restricted key
	/AIza[A-Za-z0-9_-]{35}/, // Google API key
	/-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/, // PEM private key header
	/ssh-(?:rsa|ed25519|ecdsa)\s+[A-Za-z0-9+/=]{40,}/, // SSH public key (high-entropy)
	/redis:\/\/[^:]*:[^@]+@/, // Redis URL with embedded password
	/SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/, // SendGrid API key
	/sq0[a-z]{3}-[a-zA-Z0-9_-]{22,}/, // Square API key
];

export interface SecretCheckResult {
	safe: boolean;
	detectedPatterns: string[];
}

export function checkForSecrets(content: string): SecretCheckResult {
	const detected: string[] = [];
	for (const pattern of SECRET_PATTERNS) {
		if (pattern.test(content)) {
			detected.push(pattern.source.slice(0, 40));
		}
	}
	if (detected.length > 0) {
		log.warn({ patterns: detected.length }, "[secret-guard] Secret-like content detected in write payload");
	}
	return { safe: detected.length === 0, detectedPatterns: detected };
}

/** Sanitize content for audit logs — redact potential secrets */
export function redactForAudit(content: string): string {
	let redacted = content;
	for (const pattern of SECRET_PATTERNS) {
		redacted = redacted.replace(pattern, "[REDACTED]");
	}
	return redacted.slice(0, 1000); // Limit audit payload size
}
