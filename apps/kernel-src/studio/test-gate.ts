// ---------------------------------------------------------------------------
// Oscorpex — Test Gate
// Mandatory post-execution test validation. Runs project tests after code tasks
// and blocks completion if required tests fail.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getProjectSetting, saveTestResult } from "./db.js";
import type { Task, TaskOutput } from "./types.js";
import { canonicalizeAgentRole, getBehaviorRoleKey } from "./roles.js";
import { createLogger } from "./logger.js";
const log = createLogger("test-gate");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestPolicy = "required" | "optional" | "skip";

export interface TestGateResult {
	policy: TestPolicy;
	passed: boolean;
	summary: string;
	testsPassed: number;
	testsFailed: number;
	testsTotal: number;
	rawOutput?: string;
}

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

const CODE_AGENT_ROLES = new Set([
	"frontend-dev",
	"backend-dev",
	"fullstack-dev",
	"tech-lead",
	"devops",
	"coder",
]);

/**
 * Determine the test policy for a task based on its type, role, and project settings.
 * - Code tasks from coding agents → required (default) or project-configured
 * - Review tasks → skip
 * - Non-code tasks (integration-test, run-app) → skip
 */
export async function resolveTestPolicy(
	projectId: string,
	task: Task,
	agentRole?: string,
): Promise<TestPolicy> {
	// Review tasks and special task types don't need test gate
	if (task.title.startsWith("Code Review: ")) return "skip";
	if (task.taskType === "integration-test" || task.taskType === "run-app") return "skip";

	// Check project-level override
	const override = await getProjectSetting(projectId, "test_gate", "policy");
	if (override === "skip" || override === "optional" || override === "required") {
		return override as TestPolicy;
	}

	// Code-affecting agents → required by default
	const normalizedRole = agentRole ? getBehaviorRoleKey(canonicalizeAgentRole(agentRole)) : "";
	if (normalizedRole && CODE_AGENT_ROLES.has(normalizedRole)) return "required";

	// All other tasks → optional
	return "optional";
}

// ---------------------------------------------------------------------------
// Test runner detection & execution
// ---------------------------------------------------------------------------

interface DetectedRunner {
	command: string;
	args: string[];
	framework: string;
}

function detectTestRunner(repoPath: string): DetectedRunner | null {
	// Check for common test configurations
	if (existsSync(join(repoPath, "vitest.config.ts")) || existsSync(join(repoPath, "vitest.config.js"))) {
		return { command: "npx", args: ["vitest", "run", "--reporter=verbose"], framework: "vitest" };
	}
	if (existsSync(join(repoPath, "jest.config.ts")) || existsSync(join(repoPath, "jest.config.js"))) {
		return { command: "npx", args: ["jest", "--ci", "--verbose"], framework: "jest" };
	}
	// Check package.json for test script
	try {
		const pkgPath = join(repoPath, "package.json");
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
			if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
				// Detect package manager
				const pm = existsSync(join(repoPath, "pnpm-lock.yaml"))
					? "pnpm"
					: existsSync(join(repoPath, "yarn.lock"))
						? "yarn"
						: "npm";
				return { command: pm, args: ["test"], framework: "npm-script" };
			}
		}
	} catch {
		// Ignore parse errors
	}
	return null;
}

/** Parse test output for pass/fail counts (best-effort) */
function parseTestCounts(output: string): { passed: number; failed: number; total: number } {
	// Vitest/Jest format: "Tests: 5 passed, 2 failed, 7 total"
	const testsMatch = output.match(/Tests?\s*:?\s*(\d+)\s*passed.*?(\d+)\s*failed.*?(\d+)\s*total/i);
	if (testsMatch) {
		return { passed: Number(testsMatch[1]), failed: Number(testsMatch[2]), total: Number(testsMatch[3]) };
	}
	// Vitest format: "Tests  5 passed (5)"
	const vitestMatch = output.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
	if (vitestMatch) {
		return { passed: Number(vitestMatch[1]), failed: 0, total: Number(vitestMatch[2]) };
	}
	// Generic: count "PASS" and "FAIL" lines
	const passLines = (output.match(/\bPASS\b/g) || []).length;
	const failLines = (output.match(/\bFAIL\b/g) || []).length;
	if (passLines + failLines > 0) {
		return { passed: passLines, failed: failLines, total: passLines + failLines };
	}
	return { passed: 0, failed: 0, total: 0 };
}

// ---------------------------------------------------------------------------
// Main test gate entry point
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 120_000; // 2 minutes max for test execution

/**
 * Run the test gate for a completed task.
 * Returns the gate result — caller decides whether to block completion.
 */
export async function runTestGate(
	projectId: string,
	task: Task,
	repoPath: string,
	output: TaskOutput,
	agentRole?: string,
): Promise<TestGateResult> {
	const policy = await resolveTestPolicy(projectId, task, agentRole);

	if (policy === "skip") {
		return { policy, passed: true, summary: "Test gate skipped", testsPassed: 0, testsFailed: 0, testsTotal: 0 };
	}

	// Detect test runner
	const runner = detectTestRunner(repoPath);
	if (!runner) {
		const msg = "No test runner detected";
		return {
			policy,
			passed: policy === "optional",
			summary: msg,
			testsPassed: 0,
			testsFailed: 0,
			testsTotal: 0,
		};
	}

	let rawOutput = "";
	let exitCode = 0;

	try {
		rawOutput = execFileSync(runner.command, runner.args, {
			cwd: repoPath,
			timeout: TEST_TIMEOUT_MS,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
		});
	} catch (err: any) {
		exitCode = err.status ?? 1;
		rawOutput = (err.stdout ?? "") + "\n" + (err.stderr ?? "");
	}

	const counts = parseTestCounts(rawOutput);
	const passed = exitCode === 0 && counts.failed === 0;

	// Persist test result
	try {
		await saveTestResult({
			projectId,
			taskId: task.id,
			framework: runner.framework,
			passed: counts.passed,
			failed: counts.failed,
			skipped: 0,
			total: counts.total,
			rawOutput: rawOutput.slice(0, 10_000), // cap storage
		});
	} catch {
		// Non-blocking — don't fail the gate on persistence error
	}

	const summary = passed
		? `Tests passed: ${counts.passed}/${counts.total}`
		: `Tests failed: ${counts.failed}/${counts.total} (exit code ${exitCode})`;

	return {
		policy,
		passed: passed || policy === "optional",
		summary,
		testsPassed: counts.passed,
		testsFailed: counts.failed,
		testsTotal: counts.total,
		rawOutput: rawOutput.slice(0, 5_000),
	};
}
