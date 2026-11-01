// ---------------------------------------------------------------------------
// I0 item 4 / scenario 4 — dependency installs never execute repo-controlled code.
//   * `--ignore-scripts` on every install, `--ignore-pnpmfile` for pnpm, `YARN_IGNORE_PATH=1` for yarn;
//   * a `.yarnrc.yml` carrying `yarnPath` makes the install refuse with a clear error (the fake never runs).
// The fake package managers mimic the dangerous behaviour: unless the hardening is present they run the repo's
// postinstall script / .pnpmfile.cjs / yarnPath, each of which writes a canary file.
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTmp, makeFakeBin, makeVersionedYarn, prependPath, readInvocations } from "./helpers/i0-fakes.js";

const KERNEL_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SIMULATE = `
const { execFileSync } = require("child_process");
const path = require("path");
const args = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!args.includes("--ignore-scripts") && pkg.scripts && pkg.scripts.postinstall) {
	execFileSync("/bin/sh", ["-c", pkg.scripts.postinstall], { stdio: "ignore" });
}
if (path.basename(process.argv[1]) === "pnpm" && !args.includes("--ignore-pnpmfile") && fs.existsSync(".pnpmfile.cjs")) {
	require(path.resolve(".pnpmfile.cjs"));
}
if (path.basename(process.argv[1]).startsWith("yarn") && process.env.YARN_IGNORE_PATH !== "1" && fs.existsSync(".yarnrc.yml")) {
	const m = /yarnPath:\\s*(\\S+)/.exec(fs.readFileSync(".yarnrc.yml", "utf8"));
	if (m) execFileSync("/bin/sh", [path.resolve(m[1])], { stdio: "ignore" });
}
`;

let work: string;
let bin: string;
const rec: Record<string, string> = {};
let restorePath: () => void;
let n = 0;

beforeAll(() => {
	work = freshTmp("oscx-i0-install-");
	bin = join(work, "bin");
	mkdirSync(bin);
	for (const pm of ["npm", "pnpm"]) rec[pm] = makeFakeBin(bin, pm, { extra: SIMULATE });
	rec.yarn = makeVersionedYarn(bin, { extra: SIMULATE });
	restorePath = prependPath(bin);
});
afterAll(() => {
	restorePath();
	rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
	for (const f of Object.values(rec)) rmSync(f, { force: true });
});

function mkRepo(lock: "pnpm-lock.yaml" | "yarn.lock" | "package-lock.json", extra: Record<string, string> = {}) {
	const repo = join(work, `repo-${++n}`);
	mkdirSync(repo);
	const canary = join(work, `canary-${n}`);
	writeFileSync(
		join(repo, "package.json"),
		JSON.stringify({
			name: "victim",
			dependencies: { "left-pad": "1.3.0" },
			scripts: { postinstall: `touch ${canary}-postinstall` },
		}),
	);
	writeFileSync(join(repo, lock), "");
	writeFileSync(
		join(repo, ".pnpmfile.cjs"),
		`require("fs").writeFileSync(${JSON.stringify(`${canary}-pnpmfile`)}, "x");\n`,
	);
	for (const [name, content] of Object.entries(extra)) writeFileSync(join(repo, name), content);
	return { repo, canary };
}

function canaries(canary: string): string[] {
	return readdirSync(work).filter((f) => f.startsWith(`${canary.split("/").pop()}-`));
}

describe("syncDeclaredDependencies hardening (scenario 4)", () => {
	it("pnpm: --ignore-scripts and --ignore-pnpmfile; neither the postinstall nor .pnpmfile.cjs runs", async () => {
		const { syncDeclaredDependencies } = await import("../repo-dependency-sync.js");
		const { repo, canary } = mkRepo("pnpm-lock.yaml");
		const outcome = syncDeclaredDependencies(repo, 20_000);
		expect(outcome.ranInstall).toBe(true);
		const [inv] = readInvocations(rec.pnpm);
		expect(inv.argv).toContain("install");
		expect(inv.argv).toContain("--ignore-scripts");
		expect(inv.argv).toContain("--ignore-pnpmfile");
		expect(canaries(canary)).toEqual([]);
	});

	it("npm: --ignore-scripts; the postinstall never runs", async () => {
		const { syncDeclaredDependencies } = await import("../repo-dependency-sync.js");
		const { repo, canary } = mkRepo("package-lock.json");
		syncDeclaredDependencies(repo, 20_000);
		const [inv] = readInvocations(rec.npm);
		expect(inv.argv).toContain("--ignore-scripts");
		expect(canaries(canary)).toEqual([]);
	});

	it("yarn: --ignore-scripts and YARN_IGNORE_PATH=1", async () => {
		const { syncDeclaredDependencies } = await import("../repo-dependency-sync.js");
		const { repo, canary } = mkRepo("yarn.lock");
		syncDeclaredDependencies(repo, 20_000);
		const [inv] = readInvocations(rec.yarn);
		expect(inv.argv).toContain("--ignore-scripts");
		expect(inv.env.YARN_IGNORE_PATH).toBe("1");
		expect(canaries(canary)).toEqual([]);
	});

	it("yarn with a yarnPath in .yarnrc.yml is refused with a clear error and nothing runs", async () => {
		const { syncDeclaredDependencies } = await import("../repo-dependency-sync.js");
		const { repo, canary } = mkRepo("yarn.lock", { ".yarnrc.yml": "yarnPath: .yarn/releases/evil.cjs\n" });
		mkdirSync(join(repo, ".yarn", "releases"), { recursive: true });
		writeFileSync(join(repo, ".yarn", "releases", "evil.cjs"), `touch ${canary}-yarnpath\n`);
		const outcome = syncDeclaredDependencies(repo, 20_000);
		expect(outcome.ok).toBe(false);
		expect(outcome.error ?? "").toMatch(/yarnrc/i);
		expect(readInvocations(rec.yarn)).toEqual([]);
		expect(canaries(canary)).toEqual([]);
	});
});

// Every other install path (app-runner starter, runtime route, ...) must carry the same flags, or go through a
// shared hardening helper that does.
describe("all install call sites are hardened (static)", () => {
	function walk(dir: string, out: string[] = []): string[] {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.name === "__tests__" || e.name === "node_modules") continue;
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p, out);
			else if (p.endsWith(".ts")) out.push(p);
		}
		return out;
	}

	it("each file that runs a package-manager install mentions --ignore-pnpmfile and YARN_IGNORE_PATH (or a shared helper)", () => {
		const offenders: string[] = [];
		for (const file of walk(KERNEL_SRC)) {
			const src = readFileSync(file, "utf8");
			const runsInstall = /--ignore-scripts/.test(src) || /args\s*=\s*\[\s*["']install["']\s*\]/.test(src);
			if (!runsInstall) continue;
			const hardened = /--ignore-pnpmfile/.test(src) && /YARN_IGNORE_PATH/.test(src);
			const viaHelper = /from\s+["'][^"']*(safe-?install|install-?(safe|harden)|package-?install)[^"']*["']/i.test(src);
			if (!hardened && !viaHelper) offenders.push(relative(KERNEL_SRC, file));
		}
		expect(offenders).toEqual([]);
	});

	it("nobody installs without --ignore-scripts", () => {
		const offenders: string[] = [];
		for (const file of walk(KERNEL_SRC)) {
			const src = readFileSync(file, "utf8");
			if (/args\s*=\s*\[\s*["']install["']\s*\]/.test(src) && !/--ignore-scripts/.test(src)) {
				offenders.push(relative(KERNEL_SRC, file));
			}
		}
		expect(offenders).toEqual([]);
	});
});
