import { createLogger } from "../logger.js";

const log = createLogger("prompt-injection-guard");

const INJECTION_PATTERNS = [
	/ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)/i,
	/you\s+are\s+now\s+(a|an|the)\s+/i,
	/system\s*:\s*/i,
	/\[INST\]/i,
	/\[\/INST\]/i,
	/<\|im_start\|>/i,
	/forget\s+(everything|all|your)/i,
	/override\s+(safety|security|policy|rules)/i,
	/bypass\s+(security|auth|policy|filter|guard)/i,
	/act\s+as\s+(if|though)\s+you/i,
	/pretend\s+(you|to\s+be)/i,
	/jailbreak/i,
	/DAN\s+mode/i,
	/developer\s+mode\s+(enabled|on|active)/i,
];

export interface PromptInjectionResult {
	safe: boolean;
	detectedPatterns: string[];
}

export function checkPromptInjection(input: string): PromptInjectionResult {
	const detected: string[] = [];
	for (const pattern of INJECTION_PATTERNS) {
		if (pattern.test(input)) {
			detected.push(pattern.source.slice(0, 40));
		}
	}
	if (detected.length > 0) {
		log.warn({ count: detected.length }, "[prompt-injection] Injection attempt detected");
	}
	return { safe: detected.length === 0, detectedPatterns: detected };
}
