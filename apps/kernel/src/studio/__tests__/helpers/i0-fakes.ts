// ---------------------------------------------------------------------------
// I0 — shared fakes for the urgent-hardening suites. Every fake is a tiny node script that records its argv, cwd,
// stdin, env and the entries of its cwd to a JSONL file, then exits with a canned result. No real CLI, package
// manager or scanner is ever run, and nothing is written outside the directories the caller passes in.
// ---------------------------------------------------------------------------

import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface FakeInvocation {
	argv: string[];
	cwd: string;
	cwdEntries: string[];
	stdin: string;
	env: Record<string, string | undefined>;
}

export interface FakeBinOptions {
	stdout?: string;
	exitCode?: number;
	/** Extra node source executed after the record is written (e.g. to plant a canary). */
	extra?: string;
}

/** Creates `<dir>/<name>` as an executable node script; returns the JSONL record path. */
export function makeFakeBin(dir: string, name: string, opts: FakeBinOptions = {}): string {
	const recordFile = join(dir, `${name}.record.jsonl`);
	const source = `#!/usr/bin/env node
const fs = require("fs");
const rec = ${JSON.stringify(recordFile)};
let stdin = "";
let done = false;
function finish() {
	if (done) return;
	done = true;
	let cwdEntries = [];
	try { cwdEntries = fs.readdirSync(process.cwd()); } catch {}
	fs.appendFileSync(rec, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), cwdEntries, stdin, env: process.env }) + "\\n");
	${opts.extra ?? ""}
	process.stdout.write(${JSON.stringify(opts.stdout ?? "")});
	process.exit(${opts.exitCode ?? 0});
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { stdin += d; });
process.stdin.on("end", finish);
process.stdin.on("error", finish);
setTimeout(finish, 1500);
`;
	const path = join(dir, name);
	writeFileSync(path, source);
	chmodSync(path, 0o755);
	return recordFile;
}

/**
 * Creates `<dir>/yarn`: answers `--version` itself (the contents of `./.fake-yarn-version` in its cwd, default
 * 1.22.22 — flags must follow the binary that runs, not the repo's files) and forwards every other call to a
 * recording fake (`<dir>/yarn-impl`). Returns the JSONL record path of the recording fake.
 */
export function makeVersionedYarn(dir: string, opts: FakeBinOptions = {}): string {
	const recordFile = makeFakeBin(dir, "yarn-impl", opts);
	const path = join(dir, "yarn");
	writeFileSync(
		path,
		`#!/bin/sh
if [ "$1" = "--version" ]; then
	echo probe >> ${JSON.stringify(join(dir, "yarn-version-probes.log"))}
	if [ -f ./.fake-yarn-version ]; then cat ./.fake-yarn-version; else echo 1.22.22; fi
	exit 0
fi
exec ${JSON.stringify(join(dir, "yarn-impl"))} "$@"
`,
	);
	chmodSync(path, 0o755);
	return recordFile;
}

/** Number of `yarn --version` probes answered by a `makeVersionedYarn` fake in `dir`. */
export function yarnVersionProbes(dir: string): number {
	const file = join(dir, "yarn-version-probes.log");
	return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
}

export function readInvocations(recordFile: string): FakeInvocation[] {
	if (!existsSync(recordFile)) return [];
	return readFileSync(recordFile, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as FakeInvocation);
}

/** Polls until the fake has been invoked `count` times (it exits within ~1.5 s even when stdin never closes). */
export async function waitForInvocations(recordFile: string, count = 1, timeoutMs = 10_000): Promise<FakeInvocation[]> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const got = readInvocations(recordFile);
		if (got.length >= count) return got;
		await new Promise((r) => setTimeout(r, 50));
	}
	return readInvocations(recordFile);
}

/** Resolves a fresh temp directory (realpath'd so macOS /var → /private/var does not confuse comparisons). */
export function freshTmp(prefix: string): string {
	return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** Prepends `dir` to PATH for the test process; returns a restore function. */
export function prependPath(dir: string): () => void {
	const prev = process.env.PATH;
	process.env.PATH = `${dir}${delimiter}${prev ?? ""}`;
	return () => {
		if (prev === undefined) Reflect.deleteProperty(process.env, "PATH");
		else process.env.PATH = prev;
	};
}

/**
 * True when `text` can reach the CLI only as stdin or as an argv entry that follows a `--` separator — i.e. it can
 * never be parsed as an option.
 */
export function deliveredWithoutFlagParsing(inv: FakeInvocation, text: string): boolean {
	const dd = inv.argv.indexOf("--");
	const inArgv = inv.argv.map((a, i) => ({ a, i })).filter(({ a }) => a.includes(text));
	if (inArgv.some(({ i }) => dd === -1 || i < dd)) return false;
	return inv.stdin.includes(text) || inArgv.length > 0;
}

/** Waits for an invocation whose argv or stdin mentions `text`; fails the calling test if none shows up. */
export async function waitForInvocationWith(
	recordFile: string,
	text: string,
	timeoutMs = 10_000,
): Promise<FakeInvocation> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const hit = readInvocations(recordFile).find((i) => i.stdin.includes(text) || i.argv.some((a) => a.includes(text)));
		if (hit) return hit;
		if (Date.now() > deadline) throw new Error(`no fake invocation mentioned ${JSON.stringify(text)}`);
		await new Promise((r) => setTimeout(r, 50));
	}
}
