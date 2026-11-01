// ---------------------------------------------------------------------------
// I0 review fixes — S4 / S6: unit tests for safe-install.ts (`hardenInstall`, `hardenInstallCommand`).
//   * pnpm: --ignore-scripts --ignore-pnpmfile; npm install / ci: --ignore-scripts + the git override;
//   * yarn classic keeps --ignore-scripts; yarn Berry (packageManager yarn@2+ or a .yarnrc.yml) has no such flag
//     and uses YARN_ENABLE_SCRIPTS=false / --mode=skip-build;
//   * yarnPath and plugins in .yarnrc(.yml) are refused, quoted or not;
//   * commands that are not installs pass through unchanged (`npm run build`, `pnpm test`, `yarn dev`, `npx vite`);
//     a bare `yarn` is an install.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hardenInstall, hardenInstallCommand } from "../safe-install.js";
import { freshTmp, makeVersionedYarn, prependPath, yarnVersionProbes } from "./helpers/i0-fakes.js";

let work: string;
let n = 0;
let restorePath: () => void;
let bin: string;

beforeAll(() => {
	work = freshTmp("oscx-i0-rf-install-");
	// a deterministic `yarn`: `--version` prints ./.fake-yarn-version (default 1.22.22), never the host's real yarn
	bin = join(work, "bin");
	mkdirSync(bin);
	makeVersionedYarn(bin);
	restorePath = prependPath(bin);
});
afterAll(() => {
	restorePath();
	rmSync(work, { recursive: true, force: true });
});
beforeEach(() => rmSync(join(bin, "yarn-version-probes.log"), { force: true }));

/** `yarnVersion` is what the fake yarn binary reports; it is independent of the repo's files. */
function mk(files: Record<string, string> = {}, packageManager?: string, yarnVersion?: string): string {
	const dir = join(work, `r${++n}`);
	mkdirSync(dir);
	if (yarnVersion) writeFileSync(join(dir, ".fake-yarn-version"), `${yarnVersion}\n`);
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "x", ...(packageManager ? { packageManager } : {}) }),
	);
	for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
	return dir;
}

const gitForced = (r: { command: string; env: Record<string, string> }) =>
	r.command.includes("--git=git") || r.env.npm_config_git === "git" || r.env.NPM_CONFIG_GIT === "git";
const scriptsOff = (r: { command: string; env: Record<string, string> }) =>
	r.env.YARN_ENABLE_SCRIPTS === "false" || r.command.includes("--mode=skip-build");

describe("hardenInstallCommand: pnpm / npm", () => {
	it("pnpm install gets --ignore-scripts and --ignore-pnpmfile", () => {
		const r = hardenInstallCommand("pnpm install", mk());
		expect(r.ok).toBe(true);
		expect(r.command).toContain("--ignore-scripts");
		expect(r.command).toContain("--ignore-pnpmfile");
	});

	for (const cmd of ["npm install", "npm ci", "npm i", "npm install left-pad"]) {
		it(`${cmd} gets --ignore-scripts and the git override`, () => {
			const r = hardenInstallCommand(cmd, mk());
			expect(r.ok).toBe(true);
			expect(r.command).toContain("--ignore-scripts");
			expect(gitForced(r)).toBe(true);
		});
	}

	it("an already-hardened command is not given duplicate flags", () => {
		const r = hardenInstallCommand("pnpm install --ignore-scripts --ignore-pnpmfile", mk());
		expect(r.command.match(/--ignore-scripts/g)).toHaveLength(1);
		expect(r.command.match(/--ignore-pnpmfile/g)).toHaveLength(1);
	});
});

describe("hardenInstallCommand: yarn classic vs Berry", () => {
	it("yarn classic (1.x) still gets --ignore-scripts and YARN_IGNORE_PATH=1", () => {
		for (const dir of [mk(), mk({}, "yarn@1.22.19")]) {
			const r = hardenInstallCommand("yarn install", dir);
			expect(r.ok).toBe(true);
			expect(r.command).toContain("--ignore-scripts");
			expect(r.env.YARN_IGNORE_PATH).toBe("1");
		}
	});

	for (const [label, dir] of [
		["the yarn binary reports 4.1.0", () => mk({}, "yarn@4.1.0", "4.1.0")],
		["the yarn binary reports 3.6.4", () => mk({}, undefined, "3.6.4")],
		["the yarn binary reports 4.5.0 and there is no .yarnrc*", () => mk({}, undefined, "4.5.0")],
	] as const) {
		it(`Berry (${label}): no --ignore-scripts; scripts are disabled the Berry way`, () => {
			const r = hardenInstallCommand("yarn install", dir());
			expect(r.ok).toBe(true);
			expect(r.command).not.toContain("--ignore-scripts");
			expect(scriptsOff(r)).toBe(true);
		});
	}

	it("no .yarnrc*: yarn 1.x gets --ignore-scripts and no Berry flags (flags come from the probed version)", () => {
		const r = hardenInstallCommand("yarn install", mk({}, undefined, "1.22.22"));
		expect(r.ok).toBe(true);
		expect(r.command).toContain("--ignore-scripts");
		expect(r.command).not.toContain("--mode=skip-build");
		expect(r.env.YARN_ENABLE_SCRIPTS).toBeUndefined();
		expect(yarnVersionProbes(bin)).toBe(1);
	});

	it("the flags follow the binary, not the repo: packageManager says yarn@4 but the binary reports 1.22.22", () => {
		const r = hardenInstallCommand("yarn install", mk({}, "yarn@4.1.0", "1.22.22"));
		expect(r.command).toContain("--ignore-scripts");
		expect(r.command).not.toContain("--mode=skip-build");
	});

	it("Berry: hardenInstall (flags API) does not return --ignore-scripts either", () => {
		const h = hardenInstall("yarn", mk({}, "yarn@4.1.0", "4.1.0"));
		expect(h.ok).toBe(true);
		expect(h.flags).not.toContain("--ignore-scripts");
		expect(h.flags.includes("--mode=skip-build") || h.env.YARN_ENABLE_SCRIPTS === "false").toBe(true);
	});

	it("a bare `yarn` is an install and is hardened", () => {
		const r = hardenInstallCommand("yarn", mk());
		expect(r.ok).toBe(true);
		expect(r.command).toContain("--ignore-scripts");
		expect(r.env.YARN_IGNORE_PATH).toBe("1");
	});

	it("`yarn add x` is hardened too", () => {
		expect(hardenInstallCommand("yarn add left-pad", mk()).command).toContain("--ignore-scripts");
	});
});

describe("hardenInstallCommand: refusals", () => {
	for (const [label, rc] of [
		["yarnPath", "yarnPath: .yarn/releases/evil.cjs\n"],
		['"yarnPath"', '"yarnPath": .yarn/releases/evil.cjs\n'],
		["'yarnPath'", "'yarnPath': .yarn/releases/evil.cjs\n"],
		["plugins", "plugins:\n  - path: ./evil-plugin.cjs\n"],
		['"plugins"', '"plugins":\n  - path: ./evil-plugin.cjs\n'],
		["'plugins'", "'plugins':\n  - path: ./evil-plugin.cjs\n"],
	] as const) {
		it(`yarn with ${label} in .yarnrc.yml is refused`, () => {
			const r = hardenInstallCommand("yarn install", mk({ ".yarnrc.yml": rc }));
			expect(r.ok).toBe(false);
			expect(r.error ?? "").toMatch(/yarnrc/i);
		});
	}

	for (const [label, rc] of [
		["flow-style plugins", '{"plugins": [{"path": "./evil-plugin.cjs"}]}\n'],
		["flow-style plugins (unquoted keys)", "{plugins: [{path: ./evil-plugin.cjs}]}\n"],
		["flow-style yarnPath", "{yarnPath: .yarn/releases/evil.cjs}\n"],
		["flow-style quoted yarnPath", '{"yarnPath": ".yarn/releases/evil.cjs"}\n'],
	] as const) {
		it(`yarn with ${label} in .yarnrc.yml is refused`, () => {
			const r = hardenInstallCommand("yarn install", mk({ ".yarnrc.yml": rc }));
			expect(r.ok).toBe(false);
			expect(r.error ?? "").toMatch(/yarnrc/i);
		});
	}

	for (const [label, rc] of [
		["yarnPath", "yarnPath: .yarn/releases/evil.cjs\n"],
		["plugins", "plugins:\n  - path: ./evil-plugin.cjs\n"],
	] as const) {
		it(`yarn: a ${label} in a PARENT directory's .yarnrc.yml (monorepo service path) is refused`, () => {
			const root = mk({ ".yarnrc.yml": rc }, undefined, "4.5.0");
			mkdirSync(join(root, ".git")); // the repo root: the walk up ends here
			const service = join(root, "services", "api");
			mkdirSync(service, { recursive: true });
			writeFileSync(join(service, "package.json"), JSON.stringify({ name: "api" }));
			writeFileSync(join(service, ".fake-yarn-version"), "4.5.0\n");
			const r = hardenInstallCommand("yarn install", service, root);
			expect(r.ok).toBe(false);
			expect(r.error ?? "").toBeTruthy();
			expect(yarnVersionProbes(bin)).toBe(0);
		});
	}

	for (const [label, files] of [
		[".yarnrc.yml with only nodeLinker", { ".yarnrc.yml": "nodeLinker: node-modules\n" }],
		["an empty .yarnrc.yml", { ".yarnrc.yml": "" }],
		["a classic .yarnrc with an innocent setting", { ".yarnrc": "--install.silent true\n" }],
	] as const) {
		it(`yarn: ${label} is refused (repo content is not parsed) BEFORE the version probe`, () => {
			for (const version of ["1.22.22", "4.5.0"]) {
				const dir = mk({ ...files }, undefined, version);
				const r = hardenInstallCommand("yarn install", dir);
				expect(r.ok).toBe(false);
				expect(r.error).toBeTruthy();
			}
			expect(yarnVersionProbes(bin)).toBe(0);
		});
	}

	for (const [label, rc] of [
		["plugins", "plugins:\n  - path: ./evil-plugin.cjs\n"],
		["nodeLinker only", "nodeLinker: node-modules\n"],
	] as const) {
		it(`yarn: the walk does not stop at an empty svc/.git: a repo-root .yarnrc.yml (${label}) still refuses`, () => {
			const root = mk({ ".yarnrc.yml": rc }, undefined, "4.5.0");
			execFileSync("git", ["init", "-q", root], { stdio: "ignore" }); // the real repo root
			const svc = join(root, "svc");
			mkdirSync(join(svc, ".git"), { recursive: true }); // an empty, fake nested .git
			writeFileSync(join(svc, "package.json"), JSON.stringify({ name: "svc" }));
			writeFileSync(join(svc, ".fake-yarn-version"), "4.5.0\n");
			const r = hardenInstallCommand("yarn install", svc, root);
			expect(r.ok).toBe(false);
			expect(yarnVersionProbes(bin)).toBe(0);
		});
	}

	it("a classic .yarnrc with yarn-path is still refused", () => {
		const r = hardenInstallCommand("yarn install", mk({ ".yarnrc": 'yarn-path ".yarn/releases/evil.js"\n' }));
		expect(r.ok).toBe(false);
	});
});

describe("hardenInstallCommand: non-install commands pass through unchanged", () => {
	for (const cmd of ["npm run build", "pnpm test", "yarn dev", "npx vite", "pnpm run lint", "yarn build", "npm test"]) {
		it(`${cmd}`, () => {
			const r = hardenInstallCommand(cmd, mk());
			expect(r).toEqual({ ok: true, command: cmd, env: {} });
		});
	}

	it("a non-install command in a repo with a yarnPath is not refused (nothing is being installed)", () => {
		const r = hardenInstallCommand("npx vite", mk({ ".yarnrc.yml": "yarnPath: x.cjs\n" }));
		expect(r.ok).toBe(true);
		expect(r.command).toBe("npx vite");
	});
});
