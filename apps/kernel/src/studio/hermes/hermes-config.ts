const READ_ONLY_TOOLS = new Set([
	"repo.listFiles",
	"repo.readFile",
	"repo.search",
	"git.status",
	"git.diff",
	"project.getTaskState",
	"project.getPipelineState",
	"docs.search",
]);

export function isHermesEnabled(): boolean {
	return process.env.OSCORPEX_ENABLE_HERMES === "true";
}

export function getHermesAllowedTools(): Set<string> {
	return READ_ONLY_TOOLS;
}

export function getDefaultSessionBudget(): number {
	return Number(process.env.OSCORPEX_HERMES_SESSION_BUDGET) || 100;
}

export function getDefaultRateLimit(): number {
	return Number(process.env.OSCORPEX_HERMES_RATE_LIMIT) || 30;
}

// P13-A: Stricter production defaults — lower limits protect against abuse in prod
export function getProductionSessionBudget(): number {
	if (process.env.NODE_ENV === "production") {
		return Number(process.env.OSCORPEX_HERMES_SESSION_BUDGET) || 50;
	}
	return Number(process.env.OSCORPEX_HERMES_SESSION_BUDGET) || 100;
}

export function getProductionRateLimit(): number {
	if (process.env.NODE_ENV === "production") {
		return Number(process.env.OSCORPEX_HERMES_RATE_LIMIT) || 20;
	}
	return Number(process.env.OSCORPEX_HERMES_RATE_LIMIT) || 30;
}
