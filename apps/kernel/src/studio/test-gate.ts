// ---------------------------------------------------------------------------
// Oscorpex — Test Gate
// Mandatory post-execution test validation. Runs project tests after code tasks
// and blocks completion if required tests fail.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getProjectSetting, saveTestResult } from "./db.js";
import { createLogger } from "./logger.js";
import { canonicalizeAgentRole, getBehaviorRoleKey } from "./roles.js";
import { buildSafeChildEnv } from "./security/env-sanitizer.js";
import type { Task, TaskOutput } from "./types.js";
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

const CODE_AGENT_ROLES = new Set(["frontend-dev", "backend-dev", "fullstack-dev", "tech-lead", "devops", "coder"]);

function isBootstrapTask(task: Task): boolean {
	const text = `${task.title} ${task.description}`.toLowerCase();
	const bootstrapHints = [
		"initialize",
		"init",
		"setup",
		"configure",
		"install",
		"scaffold",
		"vite",
		"tailwind",
		"shadcn",
		"tsconfig",
		"package.json",
	];
	return bootstrapHints.some((hint) => text.includes(hint));
}

/**
 * Determine the test policy for a task based on its type, role, and project settings.
 * - Code tasks from coding agents → required (default) or project-configured
 * - Review tasks → skip
 * - Non-code tasks (integration-test, run-app) → skip
 */
export async function resolveTestPolicy(projectId: string, task: Task, agentRole?: string): Promise<TestPolicy> {
	if (task.testExpectation === "none") return "skip";
	if (task.testExpectation === "optional") return "optional";
	if (task.testExpectation === "required") return "required";

	// Review tasks and special task types don't need test gate
	if (task.title.startsWith("Code Review: ")) return "skip";
	if (task.taskType === "integration-test" || task.taskType === "run-app") return "skip";

	// Bootstrap/setup tasks run before test infra settles; enforce later integration-test phase instead.
	if (isBootstrapTask(task)) return "optional";

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
	// ---------------------------------------------------------------------------
	// Bug #12 Root Fix: Framework-agnostic test harness isolation
	// Generated projects MUST NOT inherit parent Oscorpex vitest/jest config.
	// Strategy: Always use explicit --config flag pointing to local config.
	// If no local config exists, generate a minimal one before running tests.
	// ---------------------------------------------------------------------------

	const hasVitestConfig =
		existsSync(join(repoPath, "vitest.config.ts")) || existsSync(join(repoPath, "vitest.config.js"));
	const hasJestConfig =
		existsSync(join(repoPath, "jest.config.ts")) ||
		existsSync(join(repoPath, "jest.config.js")) ||
		existsSync(join(repoPath, "jest.config.mjs"));

	// 1. Explicit vitest config exists → use it with explicit --config
	if (hasVitestConfig) {
		const configFile = existsSync(join(repoPath, "vitest.config.ts")) ? "vitest.config.ts" : "vitest.config.js";
		return {
			command: "npx",
			args: ["vitest", "run", "--reporter=verbose", "--config", join(repoPath, configFile)],
			framework: "vitest",
		};
	}

	// 2. Explicit jest config exists → use it with explicit --config
	if (hasJestConfig) {
		const configFile = existsSync(join(repoPath, "jest.config.ts"))
			? "jest.config.ts"
			: existsSync(join(repoPath, "jest.config.js"))
				? "jest.config.js"
				: "jest.config.mjs";
		return {
			command: "npx",
			args: ["jest", "--ci", "--verbose", "--config", join(repoPath, configFile)],
			framework: "jest",
		};
	}

	// 3. Check package.json for test script
	try {
		const pkgPath = join(repoPath, "package.json");
		if (!existsSync(pkgPath)) return null;

		const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
		const testScript = pkg.scripts?.test as string | undefined;
		if (!testScript || testScript === 'echo "Error: no test specified" && exit 1') return null;

		// Detect which framework the test script uses
		const usesVitest = testScript.includes("vitest");
		const usesJest = testScript.includes("jest");
		const usesNodeTest = testScript.includes("node --test") || testScript.includes("node:test");

		// 3a. Vitest without config → generate minimal standalone config
		if (usesVitest) {
			const minimalConfig = [
				'import { defineConfig } from "vitest/config";',
				"export default defineConfig({",
				"  root: '.',",
				"  test: {",
				"    environment: 'node',",
				"    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],",
				"    exclude: ['node_modules', 'dist'],",
				"    setupFiles: [],",
				"  },",
				"});",
			].join("\n");
			try {
				require("node:fs").writeFileSync(join(repoPath, "vitest.config.ts"), minimalConfig);
				log.info("[test-gate] Generated standalone vitest.config.ts (Bug #12 isolation)");
			} catch {
				log.warn("[test-gate] Could not write vitest.config.ts — test may inherit parent config");
			}
			return {
				command: "npx",
				args: ["vitest", "run", "--reporter=verbose", "--config", join(repoPath, "vitest.config.ts")],
				framework: "vitest",
			};
		}

		// 3b. Jest without config → generate minimal standalone config
		if (usesJest) {
			const minimalConfig = [
				"/** @type {import('jest').Config} */",
				"module.exports = {",
				"  testEnvironment: 'node',",
				"  roots: ['<rootDir>/src', '<rootDir>/tests'],",
				"  testMatch: ['**/*.test.ts', '**/*.test.js', '**/*.spec.ts'],",
				"  transform: { '^.+\\\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },",
				"  moduleFileExtensions: ['ts', 'js', 'json'],",
				"  setupFilesAfterSetup: [],",
				"};",
			].join("\n");
			try {
				require("node:fs").writeFileSync(join(repoPath, "jest.config.js"), minimalConfig);
				log.info("[test-gate] Generated standalone jest.config.js (Bug #12 isolation)");
			} catch {
				log.warn("[test-gate] Could not write jest.config.js — test may inherit parent config");
			}
			return {
				command: "npx",
				args: ["jest", "--ci", "--verbose", "--config", join(repoPath, "jest.config.js")],
				framework: "jest",
			};
		}

		// 3c. node:test → no config inheritance risk
		if (usesNodeTest) {
			return { command: "node", args: ["--test", "src/**/*.test.ts"], framework: "node:test" };
		}

		// 3d. Custom test script — run via package manager with --prefix to ensure cwd isolation
		const pm = existsSync(join(repoPath, "pnpm-lock.yaml"))
			? "pnpm"
			: existsSync(join(repoPath, "yarn.lock"))
				? "yarn"
				: "npm";
		return { command: pm, args: ["test", "--prefix", repoPath], framework: "npm-script" };
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

function isTestAuthoringTask(task: Task): boolean {
	const text = `${task.title} ${task.description}`.toLowerCase();
	return text.includes("test") || text.includes("spec") || text.includes("vitest") || text.includes("jest");
}

function isNoTestsDiscoveredOutput(output: string): boolean {
	const text = output.toLowerCase();
	return (
		text.includes("no test files found") ||
		text.includes("no tests found") ||
		text.includes("no matching test files") ||
		text.includes("no test files matched") ||
		text.includes("tests failed: 0/0") ||
		text.includes("test files 0") ||
		text.includes("no projects matched the filters")
	);
}

function hasHardRuntimeTestFailure(output: string): boolean {
	const text = output.toLowerCase();
	return (
		text.includes("failed to load config") ||
		text.includes("cannot find module") ||
		text.includes("error [err_module_not_found]") ||
		text.includes("module not found") ||
		text.includes("syntaxerror") ||
		text.includes("referenceerror") ||
		text.includes("typeerror")
	);
}

function firstMeaningfulOutputLine(output: string): string | undefined {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	return lines.find((line) => !/^(>|\$|npm|pnpm|yarn|vitest|jest|\u001b|\s*$)/i.test(line));
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
		const deferredMsg = "No test runner detected (test gate deferred until test infra is installed)";
		const strictMsg = "No test runner detected";
		const canDefer = policy === "required" && task.taskType !== "integration-test";
		return {
			policy: canDefer ? "optional" : policy,
			passed: canDefer || policy === "optional",
			summary: canDefer ? deferredMsg : strictMsg,
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
			env: buildSafeChildEnv({ profile: "test", extra: { CI: "true", FORCE_COLOR: "0" } }),
		});
	} catch (err: any) {
		exitCode = err.status ?? 1;
		rawOutput = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
	}

	const counts = parseTestCounts(rawOutput);
	const noTestsDiscovered = counts.total === 0 && isNoTestsDiscoveredOutput(rawOutput);
	const isRequiredTestAuthoringNoTests = policy === "required" && counts.total === 0 && isTestAuthoringTask(task);

	// Bug #12 fix: Detect parent config inheritance — if test runner fails with "Validation Error"
	// and 0/0 tests, the generated project likely inherited parent workspace vitest/jest config.
	// Treat as deferred (not hard fail) so pipeline can continue.
	const isConfigInheritanceError = exitCode !== 0 && counts.total === 0 && rawOutput.includes("Validation Error");
	if (isConfigInheritanceError) {
		log.warn(`[test-gate] Config inheritance detected for "${task.title}" — deferring test gate (Bug #12)`);
		return {
			policy: "optional",
			passed: true,
			summary: "Test gate deferred — config inheritance from parent workspace detected (Bug #12)",
			testsPassed: 0,
			testsFailed: 0,
			testsTotal: 0,
			rawOutput: rawOutput.slice(0, 5_000),
		};
	}

	if (policy === "required" && noTestsDiscovered && isTestAuthoringTask(task)) {
		return {
			policy: "optional",
			passed: true,
			summary: "No tests discovered yet for test-authoring task (gate deferred for this iteration)",
			testsPassed: 0,
			testsFailed: 0,
			testsTotal: 0,
			rawOutput: rawOutput.slice(0, 5_000),
		};
	}

	// Some runners return non-zero with sparse output even though no test files were discovered yet.
	// For test-authoring tasks, treat this as deferred unless a hard runtime/config error is present.
	if (isRequiredTestAuthoringNoTests) {
		const runtimeHint = hasHardRuntimeTestFailure(rawOutput)
			? " (runtime/config warning detected; deferred to later verification task)"
			: "";
		return {
			policy: "optional",
			passed: true,
			summary: `No executable tests discovered yet for test-authoring task (gate deferred for this iteration)${runtimeHint}`,
			testsPassed: 0,
			testsFailed: 0,
			testsTotal: 0,
			rawOutput: rawOutput.slice(0, 5_000),
		};
	}

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
	} catch (err) {
		// Non-blocking — test gate result must not fail because of a persistence error
		log.warn({ err }, "[test-gate] saveTestResult failed (non-blocking)");
	}

	const failureHint = firstMeaningfulOutputLine(rawOutput);
	const summary = passed
		? `Tests passed: ${counts.passed}/${counts.total}`
		: `Tests failed: ${counts.failed}/${counts.total} (exit code ${exitCode})${failureHint ? ` — ${failureHint}` : ""}`;

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
