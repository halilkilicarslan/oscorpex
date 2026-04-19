// ---------------------------------------------------------------------------
// Oscorpex — TestRunner (V6 M2)
// Auto-detects test framework in generated project repos and runs tests.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestFramework = "vitest" | "jest" | "mocha" | "pytest" | "unknown";

export interface TestRunResult {
	framework: TestFramework;
	passed: number;
	failed: number;
	skipped: number;
	total: number;
	coverage: number | null;
	durationMs: number;
	rawOutput: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function readJsonFile(p: string): Promise<Record<string, unknown> | null> {
	try {
		const raw = await readFile(p, "utf8");
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// TestRunner class
// ---------------------------------------------------------------------------

export class TestRunner {
	// -------------------------------------------------------------------------
	// detectFramework
	// -------------------------------------------------------------------------

	async detectFramework(repoPath: string): Promise<TestFramework> {
		// 1) Check package.json scripts / devDependencies
		const pkgPath = join(repoPath, "package.json");
		const pkg = await readJsonFile(pkgPath);
		if (pkg) {
			const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
			const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
			const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
			const allDeps = { ...devDeps, ...deps };

			// Vitest takes precedence if present
			if ("vitest" in allDeps || scripts.test?.includes("vitest")) return "vitest";
			if ("jest" in allDeps || scripts.test?.includes("jest")) return "jest";
			if ("mocha" in allDeps || scripts.test?.includes("mocha")) return "mocha";
		}

		// 2) Check config files
		const vitestConfigs = ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"];
		for (const cfg of vitestConfigs) {
			if (await fileExists(join(repoPath, cfg))) return "vitest";
		}

		const jestConfigs = ["jest.config.ts", "jest.config.js", "jest.config.cjs"];
		for (const cfg of jestConfigs) {
			if (await fileExists(join(repoPath, cfg))) return "jest";
		}

		if (await fileExists(join(repoPath, ".mocharc.js")) || await fileExists(join(repoPath, ".mocharc.yml"))) {
			return "mocha";
		}

		// 3) Python — check for pytest
		if (
			await fileExists(join(repoPath, "pytest.ini")) ||
			await fileExists(join(repoPath, "setup.cfg")) ||
			await fileExists(join(repoPath, "pyproject.toml"))
		) {
			// Confirm pytest is actually installed / used
			const pyproject = await readFile(join(repoPath, "pyproject.toml"), "utf8").catch(() => "");
			if (pyproject.includes("pytest") || await fileExists(join(repoPath, "pytest.ini"))) {
				return "pytest";
			}
		}

		return "unknown";
	}

	// -------------------------------------------------------------------------
	// buildCommand — returns [cmd, args] for the detected framework
	// -------------------------------------------------------------------------

	private buildCommand(framework: TestFramework): [string, string[]] {
		switch (framework) {
			case "vitest":
				return ["npx", ["vitest", "run", "--reporter=verbose"]];
			case "jest":
				return ["npx", ["jest", "--ci", "--verbose"]];
			case "mocha":
				return ["npx", ["mocha", "--reporter", "spec"]];
			case "pytest":
				return ["python", ["-m", "pytest", "-v", "--tb=short"]];
			default:
				// Fallback: try npm test
				return ["npm", ["test", "--", "--watchAll=false"]];
		}
	}

	// -------------------------------------------------------------------------
	// parseTestOutput
	// -------------------------------------------------------------------------

	parseTestOutput(stdout: string, framework: TestFramework): Pick<TestRunResult, "passed" | "failed" | "skipped" | "total" | "coverage"> {
		let passed = 0;
		let failed = 0;
		let skipped = 0;
		let coverage: number | null = null;

		const combined = stdout;

		if (framework === "vitest") {
			// vitest verbose: "Tests  3 passed | 1 failed | 2 skipped"
			// or: "Test Files  2 passed (2)"
			const testsLine = combined.match(/Tests\s+([\d]+)\s+passed(?:\s*\|\s*([\d]+)\s+failed)?(?:\s*\|\s*([\d]+)\s+skipped)?/i);
			if (testsLine) {
				passed = parseInt(testsLine[1] ?? "0", 10);
				failed = parseInt(testsLine[2] ?? "0", 10);
				skipped = parseInt(testsLine[3] ?? "0", 10);
			} else {
				// Alternative: count individual lines "✓" / "✕" / "↓"
				const passMatches = combined.match(/✓|✔|√/g);
				const failMatches = combined.match(/✕|✗|×/g);
				const skipMatches = combined.match(/↓|⊘/g);
				passed = passMatches?.length ?? 0;
				failed = failMatches?.length ?? 0;
				skipped = skipMatches?.length ?? 0;
			}

			// Coverage: "All files  |  85.71 |"
			const covMatch = combined.match(/All files\s*\|\s*([\d.]+)/);
			if (covMatch) coverage = parseFloat(covMatch[1]);
		} else if (framework === "jest") {
			// jest: "Tests: 2 failed, 5 passed, 1 skipped, 8 total"
			const summary = combined.match(/Tests:\s*(.*)/i);
			if (summary) {
				const line = summary[1];
				const p = line.match(/([\d]+)\s+passed/);
				const f = line.match(/([\d]+)\s+failed/);
				const s = line.match(/([\d]+)\s+skipped/);
				passed = parseInt(p?.[1] ?? "0", 10);
				failed = parseInt(f?.[1] ?? "0", 10);
				skipped = parseInt(s?.[1] ?? "0", 10);
			}

			// Jest coverage: "Stmts | Branch | Funcs | Lines"
			const covMatch = combined.match(/All files\s*\|\s*([\d.]+)/);
			if (covMatch) coverage = parseFloat(covMatch[1]);
		} else if (framework === "mocha") {
			// mocha: "5 passing" / "2 failing" / "1 pending"
			const passMatch = combined.match(/([\d]+)\s+passing/i);
			const failMatch = combined.match(/([\d]+)\s+failing/i);
			const skipMatch = combined.match(/([\d]+)\s+pending/i);
			passed = parseInt(passMatch?.[1] ?? "0", 10);
			failed = parseInt(failMatch?.[1] ?? "0", 10);
			skipped = parseInt(skipMatch?.[1] ?? "0", 10);
		} else if (framework === "pytest") {
			// pytest: "5 passed, 2 failed, 1 skipped in 0.5s"
			const summaryMatch = combined.match(/([\d]+)\s+passed(?:,\s*([\d]+)\s+failed)?(?:,\s*([\d]+)\s+skipped)?/);
			if (summaryMatch) {
				passed = parseInt(summaryMatch[1] ?? "0", 10);
				failed = parseInt(summaryMatch[2] ?? "0", 10);
				skipped = parseInt(summaryMatch[3] ?? "0", 10);
			}
		} else {
			// Generic: scan for numbers near "pass" / "fail" keywords
			const passMatch = combined.match(/([\d]+)\s+(?:test[s]?\s+)?pass/i);
			const failMatch = combined.match(/([\d]+)\s+(?:test[s]?\s+)?fail/i);
			passed = parseInt(passMatch?.[1] ?? "0", 10);
			failed = parseInt(failMatch?.[1] ?? "0", 10);
		}

		const total = passed + failed + skipped;
		return { passed, failed, skipped, total, coverage };
	}

	// -------------------------------------------------------------------------
	// runTests — main entry point
	// -------------------------------------------------------------------------

	async runTests(projectId: string, repoPath: string, taskId?: string): Promise<TestRunResult> {
		const framework = await this.detectFramework(repoPath);
		const [cmd, args] = this.buildCommand(framework);
		const startMs = Date.now();

		return new Promise<TestRunResult>((resolve) => {
			let rawOutput = "";

			const child = spawn(cmd, args, {
				cwd: repoPath,
				shell: process.platform === "win32",
				env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
				timeout: 120_000, // 2 min hard cap
			});

			child.stdout?.on("data", (chunk: Buffer) => {
				rawOutput += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				rawOutput += chunk.toString();
			});

			child.on("error", (err) => {
				const durationMs = Date.now() - startMs;
				resolve({
					framework,
					passed: 0,
					failed: 0,
					skipped: 0,
					total: 0,
					coverage: null,
					durationMs,
					rawOutput: rawOutput || err.message,
					error: err.message,
				});
			});

			child.on("close", () => {
				const durationMs = Date.now() - startMs;
				const parsed = this.parseTestOutput(rawOutput, framework);
				resolve({
					framework,
					...parsed,
					durationMs,
					rawOutput,
				});
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const testRunner = new TestRunner();
