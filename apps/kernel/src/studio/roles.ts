// ---------------------------------------------------------------------------
// Oscorpex — Agent Role Helpers
// Canonical role format is hyphen-case. Underscore and legacy variants are
// accepted on input and normalized before persistence / default resolution.
// ---------------------------------------------------------------------------

const ROLE_ALIASES: Record<string, string> = {
	backend_dev: "backend-dev",
	backend_developer: "backend-dev",
	frontend_dev: "frontend-dev",
	frontend_developer: "frontend-dev",
	frontend_qa: "frontend-qa",
	backend_qa: "backend-qa",
	qa_engineer: "qa",
	"qa-engineer": "qa",
	frontend_reviewer: "frontend-reviewer",
	backend_reviewer: "backend-reviewer",
	code_reviewer: "reviewer",
	tech_lead: "tech-lead",
	product_owner: "product-owner",
	scrum_master: "scrum-master",
	business_analyst: "business-analyst",
	design_lead: "design-lead",
	security_auditor: "security-reviewer",
	docs_writer: "docs-writer",
};

function normalizeRawRole(role: string): string {
	return role.trim().toLowerCase().replace(/_/g, "-");
}

export function canonicalizeAgentRole(role?: string | null): string {
	if (!role) return "";
	const normalized = normalizeRawRole(role);
	return ROLE_ALIASES[normalized.replace(/-/g, "_")] ?? ROLE_ALIASES[normalized] ?? normalized;
}

export function getBehaviorRoleKey(role?: string | null): string {
	const canonical = canonicalizeAgentRole(role);
	if (!canonical) return "";

	if (canonical === "frontend-dev" || canonical === "backend-dev") return canonical;
	if (canonical === "tech-lead" || canonical === "architect") return "tech-lead";
	if (canonical === "devops") return "devops";
	if (canonical.includes("review")) return "reviewer";
	if (canonical.includes("qa") || canonical.includes("test")) return "qa";
	if (canonical === "product-owner" || canonical === "pm") return "product-owner";
	if (canonical === "scrum-master") return "scrum-master";
	if (canonical === "business-analyst") return "business-analyst";
	if (canonical === "design-lead" || canonical === "designer") return "design-lead";
	if (canonical === "docs-writer") return "docs-writer";
	if (canonical.includes("coder") || canonical === "developer") return "coder";

	return canonical;
}

export function roleVariants(role?: string | null): string[] {
	const canonical = canonicalizeAgentRole(role);
	const behavior = getBehaviorRoleKey(role);
	const variants = new Set<string>();

	for (const candidate of [role ?? "", canonical, behavior]) {
		if (!candidate) continue;
		const lower = candidate.toLowerCase();
		variants.add(lower);
		variants.add(lower.replace(/-/g, "_"));
		variants.add(lower.replace(/_/g, "-"));
	}

	return Array.from(variants);
}

export function roleMatches(actualRole: string | undefined, expectedRole: string | undefined): boolean {
	if (!actualRole || !expectedRole) return false;
	const actual = roleVariants(actualRole);
	const expected = roleVariants(expectedRole);
	return actual.some((candidate) => expected.includes(candidate));
}
