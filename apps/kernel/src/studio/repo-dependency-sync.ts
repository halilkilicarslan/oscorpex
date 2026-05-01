// ---------------------------------------------------------------------------
// Ensure repo root declares dependencies are present under node_modules.
// Handles partial/corrupt installs (node_modules exists but packages missing).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("repo-dependency-sync");

/** Path to hoisted folder for package name (handles @scope/name). */
export function hoistPathForDeclaredPackage(repoRoot: string, packageName: string): string {
	if (!packageName.startsWith("@")) {
		return join(repoRoot, "node_modules", packageName);
	}
	const rest = packageName.slice(1);
	const slash = rest.indexOf("/");
	if (slash === -1) return join(repoRoot, "node_modules", packageName);
	return join(repoRoot, "node_modules", `@${rest.slice(0, slash)}`, rest.slice(slash + 1));
}

function isHoistedPresenceOk(dir: string): boolean {
	if (!existsSync(dir)) return false;
	return existsSync(join(dir, "package.json"));
}

function readMergedDeps(repoRoot: string): string[] | null {
	const pkgPath = join(repoRoot, "package.json");
	if (!existsSync(pkgPath)) return null;
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const names = [
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.devDependencies ?? {}),
		];
		return [...new Set(names)];
	} catch {
		return null;
	}
}

/**
 * Declared direct deps/devDeps that lack a usable hoisted node_modules entry.
 */
export function findMissingHoistedDependencies(repoRoot: string): string[] {
	const deps = readMergedDeps(repoRoot);
	if (!deps) return [];
	const missing: string[] = [];
	for (const name of deps) {
		const p = hoistPathForDeclaredPackage(repoRoot, name);
		if (!isHoistedPresenceOk(p)) missing.push(name);
	}
	return missing;
}

function resolveInstaller(repoRoot: string): "pnpm" | "yarn" | "npm" {
	if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(repoRoot, "yarn.lock"))) return "yarn";
	return "npm";
}

export interface DependencySyncOutcome {
	command: string;
	missingBefore: string[];
	missingAfter: string[];
	ranInstall: boolean;
	ok: boolean;
	error?: string;
}

/**
 * If any declared deps are missing from node_modules, run package manager install once.
 */
export function syncDeclaredDependencies(repoRoot: string, timeoutMs = 420_000): DependencySyncOutcome {
	const missingBefore = findMissingHoistedDependencies(repoRoot);
	if (missingBefore.length === 0) {
		return { command: "(none)", missingBefore, missingAfter: [], ranInstall: false, ok: true };
	}

	const pm = resolveInstaller(repoRoot);
	let exe: string;
	let args: string[];
	switch (pm) {
		case "pnpm":
			exe = "pnpm";
			args = ["install"];
			break;
		case "yarn":
			exe = "yarn";
			args = ["install"];
			break;
		default:
			exe = "npm";
			args = ["install"];
			break;
	}
	const cmdline = `${exe} ${args.join(" ")}`;

	try {
		log.info(`[repo-dependency-sync] ${repoRoot}: missing=${missingBefore.join(", ")} → running ${cmdline}`);
		execFileSync(exe, args, {
			cwd: repoRoot,
			encoding: "utf-8",
			timeout: timeoutMs,
			stdio: "pipe",
			env: process.env as NodeJS.ProcessEnv,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.warn(`[repo-dependency-sync] install failed (${cmdline}): ${message}`);
		return {
			command: cmdline,
			missingBefore,
			missingAfter: findMissingHoistedDependencies(repoRoot),
			ranInstall: true,
			ok: false,
			error: message.slice(0, 500),
		};
	}

	const missingAfter = findMissingHoistedDependencies(repoRoot);
	return {
		command: cmdline,
		missingBefore,
		missingAfter,
		ranInstall: true,
		ok: missingAfter.length === 0,
	};
}
