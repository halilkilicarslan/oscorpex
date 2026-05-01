import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskOutput } from "./types.js";

export interface DependencyVerificationResult {
	passed: boolean;
	missingDependencies: string[];
	checkedFiles: string[];
}

const JS_TS_FILE_REGEX = /\.(c|m)?(t|j)sx?$/i;

function normalizePackageName(specifier: string): string | null {
	if (
		!specifier ||
		specifier.startsWith(".") ||
		specifier.startsWith("/") ||
		specifier.startsWith("@/") ||
		specifier.startsWith("~") ||
		specifier.startsWith("node:")
	) {
		return null;
	}

	if (specifier.startsWith("@")) {
		const [scope, name] = specifier.split("/");
		return scope && name ? `${scope}/${name}` : null;
	}

	const [name] = specifier.split("/");
	return name || null;
}

function collectImports(source: string): string[] {
	const imports = new Set<string>();
	const patterns = [
		/import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,
		/import\s*['"]([^'"]+)['"]/g,
		/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	];

	for (const pattern of patterns) {
		let match: RegExpExecArray | null;
		match = pattern.exec(source);
		while (match) {
			imports.add(match[1]);
			match = pattern.exec(source);
		}
	}

	return [...imports];
}

function getDeclaredDependencies(repoPath: string): Set<string> {
	const pkgPath = join(repoPath, "package.json");
	if (!existsSync(pkgPath)) return new Set();

	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
		};
		return new Set([
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.devDependencies ?? {}),
			...Object.keys(pkg.peerDependencies ?? {}),
			...Object.keys(pkg.optionalDependencies ?? {}),
		]);
	} catch {
		return new Set();
	}
}

export function verifyDeclaredDependencies(repoPath: string, output: TaskOutput): DependencyVerificationResult {
	const declared = getDeclaredDependencies(repoPath);
	const touchedFiles = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])].filter((file) =>
		JS_TS_FILE_REGEX.test(file),
	);
	const missing = new Set<string>();
	const checkedFiles: string[] = [];

	for (const relPath of touchedFiles) {
		const absPath = join(repoPath, relPath);
		if (!existsSync(absPath)) continue;
		checkedFiles.push(relPath);

		let source = "";
		try {
			source = readFileSync(absPath, "utf-8");
		} catch {
			continue;
		}

		for (const specifier of collectImports(source)) {
			const pkgName = normalizePackageName(specifier);
			if (!pkgName) continue;
			if (!declared.has(pkgName)) {
				missing.add(pkgName);
			}
		}
	}

	return {
		passed: missing.size === 0,
		missingDependencies: [...missing].sort(),
		checkedFiles,
	};
}
