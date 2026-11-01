// ---------------------------------------------------------------------------
// Hardened dependency installs. A repo that is installed into is tenant-controlled: its lifecycle scripts,
// `.pnpmfile.cjs` hooks and yarn `yarnPath` release binary would all run as the kernel. Every package-manager
// install in the kernel goes through `hardenInstall` so none of them can.
//   npm  : --ignore-scripts, npm_config_git=git (a project .npmrc `git=<program>` cannot pick the git binary)
//   pnpm : --ignore-scripts --ignore-pnpmfile
//   yarn 1.x     : --ignore-scripts + YARN_IGNORE_PATH=1
//   yarn >= 2    : YARN_ENABLE_SCRIPTS=false + YARN_IGNORE_PATH=1 + --mode=skip-build (Berry rejects --ignore-scripts);
//                  the major comes from `yarn --version` (same env/cwd); undeterminable → refused
//   yarn (both)  : refused when any .yarnrc(.yml) exists from the cwd up to the repo root (content not parsed)
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveContainedCwd } from "./security/contained-fs.js";
import { buildSafeChildEnv } from "./security/env-sanitizer.js";

// Non-JS installs (mvnw, gradlew, bundle, pip, cargo, ...) are NOT hardened here: they pass through unchanged and
// remain an open residual until the I5 runner confines them. Likewise any repo with a yarn rc file (effectively every
// Yarn Berry repo) is refused until I5.

export type PackageManager = "npm" | "pnpm" | "yarn";

export interface HardenedInstall {
	ok: boolean;
	/** Command line with the hardening flags appended (unchanged when it is not an npm/pnpm/yarn install). */
	command: string;
	/** Extra environment entries the caller must merge into the child env. */
	env: Record<string, string>;
	/** Set when the install must not run at all. */
	error?: string;
	/** The REAL (symlink-free) directory to run in; callers must spawn with it, not with the path they passed. */
	cwd?: string;
}

// Install verbs only (`yarn run build`, `npm test`, ... pass through unchanged).
const PM_INSTALL_RX =
	/^(?:npm\s+(?:install|i|ci|add)|pnpm\s+(?:install|i|add)|yarn(?=\s*$)|yarn\s+(?:install|add))(?=\s|$)/;

function readText(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "yarnpath"; // unreadable config → fail closed
	}
}

/**
 * Refused when ANY `.yarnrc.yml` / `.yarnrc` exists in a directory from the install cwd up to and including the
 * project repo root (yarn walks up, so a parent's rc counts; the walk does NOT stop at an intermediate `.git`).
 * The content is not parsed: an rc file can pull in code through keys we would have to keep chasing (yarnPath,
 * plugins, aliases, ...). This effectively refuses Yarn Berry repos until I5 (the isolated runner).
 */
function yarnRcFile(realCwd: string, realRoot: string): string | undefined {
	// physical parents: yarn walks up from its real cwd, so a symlinked service dir must not hide a parent's rc
	let dir = realCwd;
	for (let depth = 0; depth < 64; depth++) {
		for (const file of [".yarnrc.yml", ".yarnrc"]) {
			if (existsSync(join(dir, file))) return file;
		}
		if (dir === realRoot) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

/** Major version of the `yarn` binary that will actually run, asked in the same hardened env and cwd. */
function yarnMajorVersion(cwd: string): number | undefined {
	try {
		const out = execFileSync("yarn", ["--version"], {
			cwd,
			encoding: "utf-8",
			timeout: 15_000,
			stdio: ["ignore", "pipe", "pipe"],
			env: buildSafeChildEnv({ profile: "build_tool", extra: { YARN_IGNORE_PATH: "1" } }),
		});
		const m = /^\s*(\d+)\./.exec(out);
		return m ? Number(m[1]) : undefined;
	} catch {
		return undefined;
	}
}

/** Flags/env/refusal for installing with `pm` in `cwd`. */
export function hardenInstall(
	pm: PackageManager,
	cwd: string,
	repoRoot: string = cwd,
): Omit<HardenedInstall, "command"> & { flags: string[] } {
	let real: { realRoot: string; realCwd: string };
	try {
		real = resolveContainedCwd(repoRoot, cwd);
	} catch (err) {
		return {
			ok: false,
			flags: [],
			env: {},
			error: `Refusing install: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	switch (pm) {
		case "pnpm":
			return { ok: true, flags: ["--ignore-scripts", "--ignore-pnpmfile"], env: {} };
		case "yarn": {
			// BEFORE the version probe: nothing runs while a repo-controlled yarn config is in play
			const rc = yarnRcFile(real.realCwd, real.realRoot);
			if (rc) {
				return {
					ok: false,
					flags: [],
					env: {},
					error: `Refusing to run yarn: the repository has a ${rc} (a repo-controlled yarn config can run repo code)`,
				};
			}
			// The flags depend on the yarn that will really run (1.x vs Berry), not on repo files an attacker controls
			const major = yarnMajorVersion(real.realCwd);
			if (major === undefined) {
				return { ok: false, flags: [], env: {}, error: "Refusing to run yarn: its version could not be determined" };
			}
			if (major >= 2) {
				// Berry rejects --ignore-scripts; scripts are switched off through the environment (+ skip-build)
				return {
					ok: true,
					flags: ["--mode=skip-build"],
					env: { YARN_IGNORE_PATH: "1", YARN_ENABLE_SCRIPTS: "false" },
				};
			}
			return { ok: true, flags: ["--ignore-scripts"], env: { YARN_IGNORE_PATH: "1" } };
		}
		default:
			// npm_config_git beats a project .npmrc `git=<program>`, so git dependencies cannot run a repo-chosen program
			return { ok: true, flags: ["--ignore-scripts"], env: { npm_config_git: "git" } };
	}
}

/** Hardens a free-form install command line (e.g. `pnpm install`); other commands pass through unchanged. */
export function hardenInstallCommand(command: string, cwd: string, repoRoot: string = cwd): HardenedInstall {
	// Every install (JS or not) runs from a directory whose REAL path is inside the repo
	let realCwd: string;
	try {
		realCwd = resolveContainedCwd(repoRoot, cwd).realCwd;
	} catch (err) {
		return {
			ok: false,
			command,
			env: {},
			error: `Refusing install: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	const m = PM_INSTALL_RX.exec(command.trim());
	if (!m) return { ok: true, command, env: {} }; // containment was still checked above
	const h = hardenInstall(m[0].split(/\s+/)[0] as PackageManager, cwd, repoRoot);
	if (!h.ok) return { ok: false, command, env: {}, error: h.error };
	const missing = h.flags.filter((f) => !command.includes(f));
	return { ok: true, command: [command, ...missing].join(" "), env: h.env, cwd: realCwd };
}
