// ---------------------------------------------------------------------------
// Oscorpex — Agent Constraints: Multi-signal Risk Classifier Tests
// Pure function tests — no DB needed (no vi.mock required for classifyRisk/assessRisk).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

// assessRisk and classifyRisk are pure functions with no DB imports needed.
// However agent-constraints.ts imports from ../db.js at module load time,
// so we mock the DB to prevent connection errors in a pure-function test run.
import { vi } from "vitest";

vi.mock("../db.js", () => ({
	getApprovalRule: vi.fn().mockResolvedValue(null),
	requiresApproval: vi.fn().mockResolvedValue(false),
}));

import { assessRisk, classifyRisk } from "../agent-runtime/agent-constraints.js";
import type { RiskAssessment, RiskSignals } from "../agent-runtime/agent-constraints.js";

// ---------------------------------------------------------------------------
// Helper — build minimal RiskSignals with sane defaults
// ---------------------------------------------------------------------------
function makeSignals(overrides: Partial<RiskSignals> = {}): RiskSignals {
	return { title: "Do some work", ...overrides };
}

// ---------------------------------------------------------------------------
// classifyRisk — backward-compatibility surface
// ---------------------------------------------------------------------------
describe("classifyRisk — backward compatibility", () => {
	it("title containing 'migration' → critical", () => {
		const level = classifyRisk(makeSignals({ title: "Add migration for user roles schema" }));
		expect(level).toBe("critical");
	});

	it("title containing 'schema' → critical", () => {
		const level = classifyRisk(makeSignals({ title: "Update schema definitions" }));
		expect(level).toBe("critical");
	});

	it("title containing 'deploy' → critical", () => {
		const level = classifyRisk(makeSignals({ title: "Deploy service to production" }));
		expect(level).toBe("critical");
	});

	it("title containing 'refactor' → high", () => {
		const level = classifyRisk(makeSignals({ title: "Refactor utils module" }));
		expect(level).toBe("high");
	});

	it("title containing 'upgrade' → high", () => {
		const level = classifyRisk(makeSignals({ title: "Upgrade package dependencies" }));
		expect(level).toBe("high");
	});

	it("title containing 'test' → low", () => {
		// "auth" would trigger CRITICAL_TITLE — use a title with only the low-risk keyword
		const level = classifyRisk(makeSignals({ title: "Add unit tests for payment helper" }));
		expect(level).toBe("low");
	});

	it("title containing 'readme' → low", () => {
		const level = classifyRisk(makeSignals({ title: "Update README docs" }));
		expect(level).toBe("low");
	});

	it("title containing 'lint' → low", () => {
		const level = classifyRisk(makeSignals({ title: "Fix lint issues in module" }));
		expect(level).toBe("low");
	});

	it("neutral title with no keywords falls back to medium", () => {
		// title score = 0.4 (medium-keyword), all other signals at neutral defaults:
		// severity undefined → 0.3, complexity undefined → 0.3, role undefined → 0.3,
		// proposalType undefined → 0.4, fileScope: no files, no branch → 0.2
		// composite = 0.4*0.30 + 0.3*0.25 + 0.3*0.15 + 0.3*0.10 + 0.4*0.10 + 0.2*0.10
		//           = 0.12 + 0.075 + 0.045 + 0.03 + 0.04 + 0.02 = 0.33 → medium
		const level = classifyRisk(makeSignals({ title: "Implement some feature" }));
		expect(level).toBe("medium");
	});

	it("empty string title falls back to medium (no keyword match)", () => {
		const level = classifyRisk(makeSignals({ title: "" }));
		expect(level).toBe("medium");
	});
});

// ---------------------------------------------------------------------------
// assessRisk — composite scoring & level mapping
// ---------------------------------------------------------------------------
describe("assessRisk — composite scoring", () => {
	it("returns a RiskAssessment with all required fields", () => {
		const result = assessRisk(makeSignals({ title: "Do some work" }));

		expect(result).toHaveProperty("level");
		expect(result).toHaveProperty("score");
		expect(result).toHaveProperty("signals");
		expect(result).toHaveProperty("reason");
	});

	it("score is within [0, 1]", () => {
		const cases: RiskSignals[] = [
			makeSignals({ title: "Deploy to production", severity: "critical", complexity: "XL", agentRole: "devops" }),
			makeSignals({ title: "Fix typo in README", severity: "low", complexity: "S", agentRole: "reviewer" }),
			makeSignals({ title: "Do some work" }),
		];
		for (const signals of cases) {
			const { score } = assessRisk(signals);
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(1);
		}
	});

	it("all-critical signals → score >= 0.49, level 'critical'", () => {
		// titleScore=1.0 (migration), severityScore=1.0, complexityScore=0.9 (XL),
		// roleScore=0.8 (devops), typeScore=0.8 (infrastructure_task), fileScore=0.8 (main branch)
		// composite = 1.0*0.30 + 1.0*0.25 + 0.9*0.15 + 0.8*0.10 + 0.8*0.10 + 0.8*0.10
		//           = 0.30 + 0.25 + 0.135 + 0.08 + 0.08 + 0.08 = 0.925
		const result = assessRisk(
			makeSignals({
				title: "Add migration for schema",
				severity: "critical",
				complexity: "XL",
				agentRole: "devops",
				proposalType: "infrastructure_task",
				branch: "main",
			}),
		);

		expect(result.score).toBeGreaterThanOrEqual(0.49);
		expect(result.level).toBe("critical");
	});

	it("all-low signals → score < 0.25, level 'low'", () => {
		// titleScore=0.1 (test), severityScore=0.1, complexityScore=0.1 (S),
		// roleScore=0.1 (reviewer), typeScore=0.1 (test_task), fileScope=0.2 (no files, no branch)
		// composite = 0.1*0.30 + 0.1*0.25 + 0.1*0.15 + 0.1*0.10 + 0.1*0.10 + 0.2*0.10
		//           = 0.03 + 0.025 + 0.015 + 0.01 + 0.01 + 0.02 = 0.11
		const result = assessRisk(
			makeSignals({
				title: "Add unit test for helper",
				severity: "low",
				complexity: "S",
				agentRole: "reviewer",
				proposalType: "test_task",
			}),
		);

		expect(result.score).toBeLessThan(0.25);
		expect(result.level).toBe("low");
	});

	it("mixed signals (high title, low everything else) → medium or high range", () => {
		// titleScore=0.7 (refactor), rest at defaults
		// composite = 0.7*0.30 + 0.3*0.25 + 0.3*0.15 + 0.3*0.10 + 0.4*0.10 + 0.2*0.10
		//           = 0.21 + 0.075 + 0.045 + 0.03 + 0.04 + 0.02 = 0.42 → high
		const result = assessRisk(makeSignals({ title: "Refactor authentication module" }));

		expect(result.score).toBeGreaterThanOrEqual(0.25);
		expect(["medium", "high", "critical"]).toContain(result.level);
	});

	it("per-signal breakdown has exactly 6 keys", () => {
		const result = assessRisk(makeSignals({ title: "Implement feature" }));
		const keys = Object.keys(result.signals);

		expect(keys).toContain("titleKeywords");
		expect(keys).toContain("severity");
		expect(keys).toContain("complexity");
		expect(keys).toContain("agentRole");
		expect(keys).toContain("proposalType");
		expect(keys).toContain("fileScope");
		expect(keys).toHaveLength(6);
	});

	it("per-signal values are each in [0, 1]", () => {
		const result = assessRisk(
			makeSignals({
				title: "Deploy migration",
				severity: "high",
				complexity: "L",
				agentRole: "devops",
				proposalType: "deployment_task",
				filesAffected: ["init.sql", "src/index.ts"],
			}),
		);

		for (const [key, value] of Object.entries(result.signals)) {
			expect(value, `signal '${key}' out of [0,1]`).toBeGreaterThanOrEqual(0);
			expect(value, `signal '${key}' out of [0,1]`).toBeLessThanOrEqual(1);
		}
	});

	it("reason string contains the level and score", () => {
		const result = assessRisk(makeSignals({ title: "Refactor core service" }));
		expect(result.reason).toMatch(/high|medium|critical|low/);
		expect(result.reason).toMatch(/score=/);
	});
});

// ---------------------------------------------------------------------------
// assessRisk — individual signal contributions
// ---------------------------------------------------------------------------
describe("assessRisk — individual signal: complexity", () => {
	it("complexity 'XL' produces a higher composite than 'S'", () => {
		const xl = assessRisk(makeSignals({ title: "Implement feature", complexity: "XL" }));
		const s = assessRisk(makeSignals({ title: "Implement feature", complexity: "S" }));

		expect(xl.score).toBeGreaterThan(s.score);
	});

	it("complexity 'XL' yields signal score 0.9", () => {
		const result = assessRisk(makeSignals({ title: "Implement feature", complexity: "XL" }));
		expect(result.signals.complexity).toBe(0.9);
	});

	it("complexity 'L' yields signal score 0.6", () => {
		const result = assessRisk(makeSignals({ title: "Implement feature", complexity: "L" }));
		expect(result.signals.complexity).toBe(0.6);
	});

	it("complexity 'M' yields signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Implement feature", complexity: "M" }));
		expect(result.signals.complexity).toBe(0.3);
	});

	it("complexity 'S' yields signal score 0.1", () => {
		const result = assessRisk(makeSignals({ title: "Implement feature", complexity: "S" }));
		expect(result.signals.complexity).toBe(0.1);
	});

	it("undefined complexity defaults to signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Implement feature" }));
		expect(result.signals.complexity).toBe(0.3);
	});
});

describe("assessRisk — individual signal: agentRole", () => {
	it("agentRole 'devops' raises composite vs 'reviewer'", () => {
		const devops = assessRisk(makeSignals({ title: "Implement feature", agentRole: "devops" }));
		const reviewer = assessRisk(makeSignals({ title: "Implement feature", agentRole: "reviewer" }));

		expect(devops.score).toBeGreaterThan(reviewer.score);
	});

	it("agentRole 'devops' yields signal score 0.8", () => {
		const result = assessRisk(makeSignals({ title: "Some task", agentRole: "devops" }));
		expect(result.signals.agentRole).toBe(0.8);
	});

	it("agentRole 'backend-dev' yields signal score 0.5", () => {
		const result = assessRisk(makeSignals({ title: "Some task", agentRole: "backend-dev" }));
		expect(result.signals.agentRole).toBe(0.5);
	});

	it("agentRole 'architect' yields signal score 0.5", () => {
		const result = assessRisk(makeSignals({ title: "Some task", agentRole: "architect" }));
		expect(result.signals.agentRole).toBe(0.5);
	});

	it("agentRole 'frontend-dev' yields signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Some task", agentRole: "frontend-dev" }));
		expect(result.signals.agentRole).toBe(0.3);
	});

	it("agentRole 'reviewer' yields signal score 0.1", () => {
		const result = assessRisk(makeSignals({ title: "Some task", agentRole: "reviewer" }));
		expect(result.signals.agentRole).toBe(0.1);
	});

	it("agentRole 'qa' yields signal score 0.1", () => {
		const result = assessRisk(makeSignals({ title: "Some task", agentRole: "qa" }));
		expect(result.signals.agentRole).toBe(0.1);
	});

	it("unknown agentRole defaults to signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Some task", agentRole: "unknown-role" }));
		expect(result.signals.agentRole).toBe(0.3);
	});

	it("undefined agentRole defaults to signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Some task" }));
		expect(result.signals.agentRole).toBe(0.3);
	});
});

describe("assessRisk — individual signal: filesAffected", () => {
	it("init.sql in filesAffected increases fileScope score above baseline", () => {
		const withSensitive = assessRisk(makeSignals({ title: "Some task", filesAffected: ["db/init.sql"] }));
		const withoutFiles = assessRisk(makeSignals({ title: "Some task" }));

		// baseline fileScope with no files = 0.2; with 1 sensitive hit = 0.5
		expect(withSensitive.signals.fileScope).toBeGreaterThan(withoutFiles.signals.fileScope);
	});

	it("init.sql hit produces fileScope 0.5 (0.2 + 1 * 0.3)", () => {
		const result = assessRisk(makeSignals({ title: "Some task", filesAffected: ["db/init.sql"] }));
		expect(result.signals.fileScope).toBeCloseTo(0.5, 5);
	});

	it("two sensitive files cap correctly: 0.2 + 2*0.3 = 0.8", () => {
		const result = assessRisk(
			makeSignals({
				title: "Some task",
				filesAffected: ["db/init.sql", ".env"],
			}),
		);
		expect(result.signals.fileScope).toBeCloseTo(0.8, 5);
	});

	it("three or more sensitive files cap at 1.0", () => {
		const result = assessRisk(
			makeSignals({
				title: "Some task",
				filesAffected: ["db/init.sql", ".env", "dockerfile", "docker-compose.yml"],
			}),
		);
		expect(result.signals.fileScope).toBe(1.0);
	});

	it("non-sensitive files yield the baseline 0.2 fileScope", () => {
		const result = assessRisk(
			makeSignals({
				title: "Some task",
				filesAffected: ["src/utils.ts", "src/index.ts", "src/helpers.ts"],
			}),
		);
		expect(result.signals.fileScope).toBeCloseTo(0.2, 5);
	});

	it("empty filesAffected array yields baseline 0.2 fileScope", () => {
		const result = assessRisk(makeSignals({ title: "Some task", filesAffected: [] }));
		expect(result.signals.fileScope).toBeCloseTo(0.2, 5);
	});

	it("migration path in filesAffected counts as sensitive", () => {
		const result = assessRisk(makeSignals({ title: "Some task", filesAffected: ["db/migrations/001_init.ts"] }));
		expect(result.signals.fileScope).toBeGreaterThan(0.2);
	});

	it(".github/ path in filesAffected counts as sensitive", () => {
		const result = assessRisk(makeSignals({ title: "Some task", filesAffected: [".github/workflows/ci.yml"] }));
		expect(result.signals.fileScope).toBeGreaterThan(0.2);
	});
});

describe("assessRisk — individual signal: branch", () => {
	it("branch 'main' yields fileScope signal score 0.8 (overrides file analysis)", () => {
		const result = assessRisk(makeSignals({ title: "Some task", branch: "main" }));
		expect(result.signals.fileScope).toBe(0.8);
	});

	it("branch 'master' yields fileScope signal score 0.8", () => {
		const result = assessRisk(makeSignals({ title: "Some task", branch: "master" }));
		expect(result.signals.fileScope).toBe(0.8);
	});

	it("branch 'MAIN' (uppercase) yields fileScope signal score 0.8 (case-insensitive)", () => {
		const result = assessRisk(makeSignals({ title: "Some task", branch: "MAIN" }));
		expect(result.signals.fileScope).toBe(0.8);
	});

	it("branch 'main' raises overall composite compared to feature branch", () => {
		const mainBranch = assessRisk(makeSignals({ title: "Some task", branch: "main" }));
		const featureBranch = assessRisk(makeSignals({ title: "Some task", branch: "feature/my-work" }));

		expect(mainBranch.score).toBeGreaterThan(featureBranch.score);
	});

	it("non-protected branch (feature/) yields baseline fileScope 0.2 when no files given", () => {
		const result = assessRisk(makeSignals({ title: "Some task", branch: "feature/add-login" }));
		expect(result.signals.fileScope).toBeCloseTo(0.2, 5);
	});

	it("branch 'main' takes priority over filesAffected in fileScope calculation", () => {
		// When branch is main, scoreFileScope returns 0.8 immediately, ignoring filesAffected
		const withMainAndFiles = assessRisk(
			makeSignals({ title: "Some task", branch: "main", filesAffected: ["src/index.ts"] }),
		);
		const withMainOnly = assessRisk(makeSignals({ title: "Some task", branch: "main" }));

		expect(withMainAndFiles.signals.fileScope).toBe(withMainOnly.signals.fileScope);
	});
});

// ---------------------------------------------------------------------------
// assessRisk — severity signal
// ---------------------------------------------------------------------------
describe("assessRisk — individual signal: severity", () => {
	it("severity 'critical' yields signal score 1.0", () => {
		const result = assessRisk(makeSignals({ title: "Some task", severity: "critical" }));
		expect(result.signals.severity).toBe(1.0);
	});

	it("severity 'high' yields signal score 0.7", () => {
		const result = assessRisk(makeSignals({ title: "Some task", severity: "high" }));
		expect(result.signals.severity).toBe(0.7);
	});

	it("severity 'medium' yields signal score 0.4", () => {
		const result = assessRisk(makeSignals({ title: "Some task", severity: "medium" }));
		expect(result.signals.severity).toBe(0.4);
	});

	it("severity 'low' yields signal score 0.1", () => {
		const result = assessRisk(makeSignals({ title: "Some task", severity: "low" }));
		expect(result.signals.severity).toBe(0.1);
	});

	it("undefined severity defaults to signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Some task" }));
		expect(result.signals.severity).toBe(0.3);
	});

	it("unknown severity value defaults to signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Some task", severity: "extreme" }));
		expect(result.signals.severity).toBe(0.3);
	});
});

// ---------------------------------------------------------------------------
// assessRisk — proposalType signal
// ---------------------------------------------------------------------------
describe("assessRisk — individual signal: proposalType", () => {
	it("proposalType 'infrastructure_task' yields signal score 0.8", () => {
		const result = assessRisk(makeSignals({ title: "Some task", proposalType: "infrastructure_task" }));
		expect(result.signals.proposalType).toBe(0.8);
	});

	it("proposalType 'deployment_task' yields signal score 0.8", () => {
		const result = assessRisk(makeSignals({ title: "Some task", proposalType: "deployment_task" }));
		expect(result.signals.proposalType).toBe(0.8);
	});

	it("proposalType 'new_task' yields signal score 0.5", () => {
		const result = assessRisk(makeSignals({ title: "Some task", proposalType: "new_task" }));
		expect(result.signals.proposalType).toBe(0.5);
	});

	it("proposalType 'bug_fix' yields signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Some task", proposalType: "bug_fix" }));
		expect(result.signals.proposalType).toBe(0.3);
	});

	it("proposalType 'fix_task' yields signal score 0.3", () => {
		const result = assessRisk(makeSignals({ title: "Some task", proposalType: "fix_task" }));
		expect(result.signals.proposalType).toBe(0.3);
	});

	it("proposalType 'test_task' yields signal score 0.1", () => {
		const result = assessRisk(makeSignals({ title: "Some task", proposalType: "test_task" }));
		expect(result.signals.proposalType).toBe(0.1);
	});

	it("undefined proposalType defaults to signal score 0.4", () => {
		const result = assessRisk(makeSignals({ title: "Some task" }));
		expect(result.signals.proposalType).toBe(0.4);
	});

	it("unknown proposalType defaults to signal score 0.4", () => {
		const result = assessRisk(makeSignals({ title: "Some task", proposalType: "custom_type" }));
		expect(result.signals.proposalType).toBe(0.4);
	});
});

// ---------------------------------------------------------------------------
// assessRisk — edge cases
// ---------------------------------------------------------------------------
describe("assessRisk — edge cases", () => {
	it("empty title string does not throw", () => {
		expect(() => assessRisk(makeSignals({ title: "" }))).not.toThrow();
	});

	it("empty title falls back to medium-keyword score 0.4", () => {
		const result = assessRisk(makeSignals({ title: "" }));
		expect(result.signals.titleKeywords).toBe(0.4);
	});

	it("undefined optional fields all default gracefully", () => {
		const result = assessRisk({ title: "Neutral task title" });

		expect(result.signals.severity).toBe(0.3);
		expect(result.signals.complexity).toBe(0.3);
		expect(result.signals.agentRole).toBe(0.3);
		expect(result.signals.proposalType).toBe(0.4);
		expect(result.signals.fileScope).toBeCloseTo(0.2, 5);
	});

	it("all undefined optionals yield deterministic composite score", () => {
		// Validate computed value: 0.4*0.30 + 0.3*0.25 + 0.3*0.15 + 0.3*0.10 + 0.4*0.10 + 0.2*0.10
		// = 0.12 + 0.075 + 0.045 + 0.03 + 0.04 + 0.02 = 0.33
		const result = assessRisk({ title: "Neutral task title" });
		expect(result.score).toBeCloseTo(0.33, 5);
	});

	it("unknown agentRole string (not in enum) does not throw", () => {
		expect(() => assessRisk(makeSignals({ title: "Some task", agentRole: "wizard" }))).not.toThrow();
	});

	it("unknown agentRole produces same score as undefined role", () => {
		const unknown = assessRisk(makeSignals({ title: "Some task", agentRole: "wizard" }));
		const undef = assessRisk(makeSignals({ title: "Some task" }));
		expect(unknown.score).toBe(undef.score);
	});

	it("reason includes dominant signal label for critical title", () => {
		const result = assessRisk(makeSignals({ title: "Schema migration for users" }));
		// titleScore >= 0.7, so title should appear in dominantSignals
		expect(result.reason).toContain("title");
	});

	it("reason includes severity when severity is critical", () => {
		const result = assessRisk(makeSignals({ title: "Neutral task", severity: "critical" }));
		// severityScore = 1.0 >= 0.7 → should appear in dominantSignals
		expect(result.reason).toContain("severity=critical");
	});

	it("reason includes branch name when branch is main", () => {
		const result = assessRisk(makeSignals({ title: "Neutral task", branch: "main" }));
		// fileScore = 0.8 >= 0.6 → branch should appear in dominantSignals
		expect(result.reason).toContain("branch=main");
	});

	it("reason includes role when devops", () => {
		const result = assessRisk(makeSignals({ title: "Neutral task", agentRole: "devops" }));
		// roleScore = 0.8 >= 0.7 → role should appear in dominantSignals
		expect(result.reason).toContain("role=devops");
	});

	it("reason includes proposalType when infrastructure_task", () => {
		const result = assessRisk(makeSignals({ title: "Neutral task", proposalType: "infrastructure_task" }));
		// typeScore = 0.8 >= 0.7 → proposalType should appear in dominantSignals
		expect(result.reason).toContain("type=infrastructure_task");
	});

	it("reason falls back to 'no dominant risk signals' when everything is neutral", () => {
		// A title with no critical/high/low keyword, medium severity, medium complexity
		// titleScore=0.4 (<0.7), severityScore=0.4 (<0.7), complexityScore=0.3 (<0.7)
		// roleScore=0.3 (<0.7), typeScore=0.4 (<0.7), fileScore=0.2 (<0.6)
		// → all below dominant thresholds
		const result = assessRisk({
			title: "Neutral task",
			severity: "medium",
			complexity: "M",
			agentRole: "frontend-dev",
			proposalType: "new_task",
		});
		expect(result.reason).toContain("no dominant risk signals");
	});

	it("classifyRisk is consistent with assessRisk level", () => {
		const signals: RiskSignals[] = [
			makeSignals({ title: "Add migration", severity: "critical" }),
			makeSignals({ title: "Refactor module" }),
			makeSignals({ title: "Add unit test", complexity: "S", agentRole: "reviewer" }),
			makeSignals({ title: "Implement feature" }),
		];

		for (const s of signals) {
			expect(classifyRisk(s)).toBe(assessRisk(s).level);
		}
	});
});

// ---------------------------------------------------------------------------
// assessRisk — type exports (compile-time verification via runtime shape check)
// ---------------------------------------------------------------------------
describe("Type exports from agent-runtime/index.js", () => {
	it("assessRisk is importable from the barrel index", async () => {
		const mod = await import("../agent-runtime/index.js");
		expect(typeof mod.assessRisk).toBe("function");
	});

	it("classifyRisk is importable from the barrel index", async () => {
		const mod = await import("../agent-runtime/index.js");
		expect(typeof mod.classifyRisk).toBe("function");
	});

	it("RiskAssessment shape matches expected structure", () => {
		const result: RiskAssessment = assessRisk(makeSignals({ title: "Check types" }));
		// Structural check — TypeScript enforces at compile time, runtime verifies field presence
		expect(typeof result.level).toBe("string");
		expect(typeof result.score).toBe("number");
		expect(typeof result.signals).toBe("object");
		expect(typeof result.reason).toBe("string");
	});
});
