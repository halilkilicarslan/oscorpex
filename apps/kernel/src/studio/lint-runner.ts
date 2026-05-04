/**
 * ESLint / Prettier enforcement for AI-generated code.
 *
 * - initLintConfig(repoPath) — scaffolds default configs if missing
 * - runLintFix(repoPath, files) — runs eslint --fix + prettier --write on given files
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

// ---------------------------------------------------------------------------
// Default configs
// ---------------------------------------------------------------------------

const DEFAULT_ESLINT_CONFIG = `import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { createLogger } from "./logger.js";
const log = createLogger("lint-runner");

export default [
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  { ignores: ["node_modules/", "dist/", "build/", ".next/"] },
];
`;

const DEFAULT_PRETTIER_CONFIG = `{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
`;

// File extensions that should be linted / formatted
const LINTABLE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const FORMATTABLE_EXTS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".css",
	".scss",
	".json",
	".md",
	".html",
	".yaml",
	".yml",
]);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/** Scaffold default ESLint + Prettier configs if they don't exist yet. */
export async function initLintConfig(repoPath: string): Promise<void> {
	const eslintPath = join(repoPath, "eslint.config.mjs");
	const prettierPath = join(repoPath, ".prettierrc");

	const writes: Promise<void>[] = [];

	// Only create if no eslint config exists at all
	const hasEslint =
		existsSync(eslintPath) ||
		existsSync(join(repoPath, ".eslintrc.json")) ||
		existsSync(join(repoPath, ".eslintrc.js")) ||
		existsSync(join(repoPath, "eslint.config.js"));

	if (!hasEslint) {
		writes.push(writeFile(eslintPath, DEFAULT_ESLINT_CONFIG, "utf-8"));
	}

	// Only create if no prettier config exists at all
	const hasPrettier =
		existsSync(prettierPath) ||
		existsSync(join(repoPath, ".prettierrc.json")) ||
		existsSync(join(repoPath, "prettier.config.js"));

	if (!hasPrettier) {
		writes.push(writeFile(prettierPath, DEFAULT_PRETTIER_CONFIG, "utf-8"));
	}

	await Promise.all(writes);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface LintResult {
	eslint: { fixed: number; errors: string[] };
	prettier: { formatted: number; errors: string[] };
}

/** Run a command and capture stdout+stderr. Resolves even on non-zero exit. */
function exec(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		execFile(cmd, args, { cwd, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
			const code =
				err && "code" in err ? ((err as NodeJS.ErrnoException & { code: number }).code as unknown as number) : 0;
			resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: typeof code === "number" ? code : 1 });
		});
	});
}

/** Find npx binary path — prefers project-local, falls back to global. */
function npxBin(repoPath: string): string {
	const local = join(repoPath, "node_modules", ".bin", "npx");
	return existsSync(local) ? local : "npx";
}

/**
 * Run eslint --fix + prettier --write on the given files.
 * Only processes files with relevant extensions. Errors are captured, not thrown.
 */
export async function runLintFix(repoPath: string, files: string[], log?: (msg: string) => void): Promise<LintResult> {
	const result: LintResult = {
		eslint: { fixed: 0, errors: [] },
		prettier: { formatted: 0, errors: [] },
	};

	// Filter to files that actually exist and have relevant extensions
	const lintFiles = files.filter((f) => LINTABLE_EXTS.has(extname(f)) && existsSync(join(repoPath, f)));
	const formatFiles = files.filter((f) => FORMATTABLE_EXTS.has(extname(f)) && existsSync(join(repoPath, f)));

	if (lintFiles.length === 0 && formatFiles.length === 0) {
		return result;
	}

	const npx = npxBin(repoPath);

	// --- ESLint --fix ---
	if (lintFiles.length > 0) {
		log?.(`[lint] ESLint --fix: ${lintFiles.length} dosya`);
		try {
			const { stderr, code } = await exec(npx, ["eslint", "--fix", "--no-warn-ignored", "--", ...lintFiles], repoPath);
			if (code === 0 || code === 1) {
				// code 1 = lint warnings/errors found but fix applied where possible
				result.eslint.fixed = lintFiles.length;
			}
			if (stderr && stderr.trim()) {
				result.eslint.errors.push(stderr.trim().slice(0, 500));
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			result.eslint.errors.push(msg.slice(0, 500));
			log?.(`[lint] ESLint hata: ${msg.slice(0, 200)}`);
		}
	}

	// --- Prettier --write ---
	if (formatFiles.length > 0) {
		log?.(`[lint] Prettier --write: ${formatFiles.length} dosya`);
		try {
			const { stderr, code } = await exec(
				npx,
				["prettier", "--write", "--no-error-on-unmatched-pattern", "--", ...formatFiles],
				repoPath,
			);
			if (code === 0) {
				result.prettier.formatted = formatFiles.length;
			}
			if (stderr && stderr.trim()) {
				result.prettier.errors.push(stderr.trim().slice(0, 500));
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			result.prettier.errors.push(msg.slice(0, 500));
			log?.(`[lint] Prettier hata: ${msg.slice(0, 200)}`);
		}
	}

	const totalFixed = result.eslint.fixed + result.prettier.formatted;
	if (totalFixed > 0) {
		log?.(`[lint] Tamamlandı: ${result.eslint.fixed} eslint, ${result.prettier.formatted} prettier`);
	}

	return result;
}
