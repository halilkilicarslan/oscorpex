// ---------------------------------------------------------------------------
// F3-0 — Static coverage: every child_process call in the kernel (and provider-sdk) must
// pass an env built by buildSafeChildEnv() — tenant code must never receive kernel secrets.
//
// AST-based (TypeScript compiler API). Per file it resolves every local binding of
// child_process functions:
//   - named / default / namespace / mixed imports (`import cp, { execSync as x } from ...`)
//   - `import cp = require("child_process")`
//   - `const { execFile } = await import("node:child_process")`, `const cp = await import(...)`,
//     `require("child_process")`
//   - `promisify(execFile)` / `util.promisify(cp.execFile)` aliases and `const run = execSync`
//   - re-exports (`export { execSync } from ...`, `export * from ...`) — always flagged
//
// A call is SAFE only if its arguments reference buildSafeChildEnv(...) — directly, or through a
// const initialised from it in the same function — AND the arguments do not spread/reference
// `process.env` outside a buildSafeChildEnv() call.
//
// Scanned: apps/kernel/src (including legacy/) and packages/provider-sdk/src.
// Platform-only calls (no tenant cwd, no tenant input) are exempt via ALLOWLIST below.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const SCAN_ROOTS = [join(REPO_ROOT, "apps/kernel/src"), join(REPO_ROOT, "packages/provider-sdk/src")];
const EXCLUDED_DIRS = new Set(["__tests__", "node_modules"]);
const CP_MODULES = new Set(["child_process", "node:child_process"]);
const CP_FUNCTIONS = new Set(["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"]);
const FIX_HINT = "pass env: buildSafeChildEnv({ profile })";

/**
 * Platform-only (or caller-controlled) child_process calls. `file` is repo-relative.
 * `pattern` is matched against the call text (callee + arguments).
 */
const ALLOWLIST: { file: string; pattern: RegExp; reason: string }[] = [
	{
		file: "apps/kernel/src/studio/app-runner/port-manager.ts",
		pattern: /"lsof"/,
		reason: "lsof -ti :<numeric port> — port availability probe; no cwd, no tenant input",
	},
	{
		file: "apps/kernel/src/studio/db-provisioner.ts",
		pattern: /^execSync\(`lsof -i :\$\{port\}/,
		reason: "lsof against a numeric port; no tenant cwd or input",
	},
	{
		file: "apps/kernel/src/studio/db-provisioner.ts",
		pattern: /^execSync\("docker info"/,
		reason: "docker CLI liveness probe; fixed command, no tenant cwd",
	},
	{
		file: "apps/kernel/src/studio/db-provisioner.ts",
		pattern: /^execFileSync\(\s*"docker",\s*(?:\[\s*"(?:inspect|rm|stop)"|dockerArgs|retryArgs|healthArgs)/,
		reason:
			"docker CLI against platform-named containers. The image may come from a tenant compose file, " +
			"but the docker CLI's own env (daemon socket, PATH) never reaches the container process",
	},
	{
		file: "apps/kernel/src/studio/cli-usage/oauth.ts",
		pattern: /security find-generic-password/,
		reason: "macOS keychain read of the operator's own Claude credentials; fixed command",
	},
	{
		file: "apps/kernel/src/studio/cli-usage/probes/cursor-probe.ts",
		pattern: /sqlite3/,
		reason: "reads the operator's Cursor state db at a fixed home path; fixed command",
	},
	{
		file: "apps/kernel/src/studio/preflight-warmup.ts",
		pattern: /"which"/,
		reason: "`which <provider binary>` — binary name from provider config, no cwd",
	},
	{
		file: "packages/provider-sdk/src/cli-runner.ts",
		pattern: /env:\s*opts\.env \?\? \{\}/,
		reason: "caller-supplied env, defaults to empty (never inherits process.env)",
	},
	{
		file: "packages/provider-sdk/src/cli-runner.ts",
		pattern: /^execFile(?:Sync)?\(binary,\s*versionArgs,/,
		reason: "`<provider binary> --version` probe; binary from provider config, no cwd, no tenant input",
	},
];
// NOTE: cli-usage/binary-locator.ts is deliberately NOT allowlisted — it already uses buildSafeChildEnv.

interface CallSite {
	file: string;
	line: number;
	callee: string;
	text: string;
	safe: boolean;
}

// ---------------------------------------------------------------------------
// AST analysis
// ---------------------------------------------------------------------------

function isCpSpecifier(n: ts.Node | undefined): boolean {
	return !!n && ts.isStringLiteralLike(n) && CP_MODULES.has(n.text);
}

/** `import("cp")`, `require("cp")`, optionally awaited / parenthesised. */
function isCpModuleExpr(expr: ts.Expression): boolean {
	let e: ts.Expression = expr;
	while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
	if (ts.isCallExpression(e) && e.arguments.length === 1 && isCpSpecifier(e.arguments[0])) {
		return (
			e.expression.kind === ts.SyntaxKind.ImportKeyword ||
			(ts.isIdentifier(e.expression) && e.expression.text === "require")
		);
	}
	return false;
}

function isPromisifyCall(e: ts.Node): e is ts.CallExpression {
	if (!ts.isCallExpression(e) || e.arguments.length < 1) return false;
	const callee = e.expression;
	return (
		(ts.isIdentifier(callee) && callee.text === "promisify") ||
		(ts.isPropertyAccessExpression(callee) && callee.name.text === "promisify")
	);
}

interface Bindings {
	names: Map<string, string>; // local identifier -> child_process function
	namespaces: Set<string>; // local identifier -> child_process module object
	reexports: ts.Node[];
}

function collectBindings(sf: ts.SourceFile): Bindings {
	const b: Bindings = { names: new Map(), namespaces: new Set(), reexports: [] };

	const cpFnOf = (expr: ts.Node): string | undefined => {
		if (ts.isIdentifier(expr)) return b.names.get(expr.text);
		if (
			ts.isPropertyAccessExpression(expr) &&
			ts.isIdentifier(expr.expression) &&
			b.namespaces.has(expr.expression.text) &&
			CP_FUNCTIONS.has(expr.name.text)
		) {
			return expr.name.text;
		}
		return undefined;
	};

	let changed = true;
	const visit = (node: ts.Node) => {
		if (ts.isImportDeclaration(node) && isCpSpecifier(node.moduleSpecifier) && node.importClause) {
			const clause = node.importClause;
			if (!clause.isTypeOnly) {
				if (clause.name) b.namespaces.add(clause.name.text);
				const nb = clause.namedBindings;
				if (nb && ts.isNamespaceImport(nb)) b.namespaces.add(nb.name.text);
				if (nb && ts.isNamedImports(nb)) {
					for (const el of nb.elements) {
						if (el.isTypeOnly) continue;
						const orig = (el.propertyName ?? el.name).text;
						if (CP_FUNCTIONS.has(orig)) b.names.set(el.name.text, orig);
					}
				}
			}
		}
		if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference) &&
			isCpSpecifier(node.moduleReference.expression)
		) {
			b.namespaces.add(node.name.text);
		}
		if (ts.isExportDeclaration(node) && isCpSpecifier(node.moduleSpecifier) && !node.isTypeOnly) {
			if (!b.reexports.includes(node)) b.reexports.push(node);
		}
		if (ts.isVariableDeclaration(node) && node.initializer) {
			const init = node.initializer;
			const before = b.names.size + b.namespaces.size;
			if (isCpModuleExpr(init)) {
				if (ts.isIdentifier(node.name)) b.namespaces.add(node.name.text);
				else if (ts.isObjectBindingPattern(node.name)) {
					for (const el of node.name.elements) {
						const orig = ((el.propertyName ?? el.name) as ts.Identifier).text;
						if (ts.isIdentifier(el.name) && CP_FUNCTIONS.has(orig)) b.names.set(el.name.text, orig);
					}
				}
			} else if (ts.isIdentifier(node.name)) {
				if (isPromisifyCall(init)) {
					const fn = cpFnOf(init.arguments[0]);
					if (fn) b.names.set(node.name.text, fn);
				} else {
					const fn = cpFnOf(init);
					if (fn) b.names.set(node.name.text, fn);
					else if (ts.isIdentifier(init) && b.namespaces.has(init.text)) b.namespaces.add(node.name.text);
				}
			} else if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(init) && b.namespaces.has(init.text)) {
				for (const el of node.name.elements) {
					const orig = ((el.propertyName ?? el.name) as ts.Identifier).text;
					if (ts.isIdentifier(el.name) && CP_FUNCTIONS.has(orig)) b.names.set(el.name.text, orig);
				}
			}
			if (b.names.size + b.namespaces.size !== before) changed = true;
		}
		ts.forEachChild(node, visit);
	};

	// iterate so aliases declared before/after their source (hoisted functions) still resolve
	for (let pass = 0; pass < 4 && changed; pass++) {
		changed = false;
		visit(sf);
	}
	return b;
}

/** A bare `process.env` (whole object) — reading a single key (`process.env.SHELL`) is not a leak. */
function isWholeProcessEnv(n: ts.Node): boolean {
	if (!isProcessEnv(n)) return false;
	const p = n.parent;
	if (p && ts.isPropertyAccessExpression(p) && p.expression === n) return false;
	if (p && ts.isElementAccessExpression(p) && p.expression === n) return false;
	return true;
}

function isProcessEnv(n: ts.Node): boolean {
	if (ts.isPropertyAccessExpression(n)) {
		return ts.isIdentifier(n.expression) && n.expression.text === "process" && n.name.text === "env";
	}
	if (ts.isElementAccessExpression(n)) {
		return (
			ts.isIdentifier(n.expression) &&
			n.expression.text === "process" &&
			ts.isStringLiteralLike(n.argumentExpression) &&
			n.argumentExpression.text === "env"
		);
	}
	return false;
}

function isSafeEnvCall(n: ts.Node): boolean {
	if (!ts.isCallExpression(n)) return false;
	const c = n.expression;
	return (
		(ts.isIdentifier(c) && c.text === "buildSafeChildEnv") ||
		(ts.isPropertyAccessExpression(c) && c.name.text === "buildSafeChildEnv")
	);
}

/** Initializer of a const/let/var `name` declared in the nearest enclosing function chain of `from`. */
function findDecl(name: string, from: ts.Node): ts.Expression | undefined {
	for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
		if (!(ts.isFunctionLike(scope) || ts.isSourceFile(scope))) continue;
		let found: ts.Expression | undefined;
		const visit = (c: ts.Node) => {
			if (found) return;
			if (ts.isFunctionLike(c)) return; // do not look into nested functions
			if (ts.isVariableDeclaration(c) && ts.isIdentifier(c.name) && c.name.text === name && c.initializer) {
				found = c.initializer;
				return;
			}
			ts.forEachChild(c, visit);
		};
		ts.forEachChild(scope, visit);
		if (found) return found;
	}
	return undefined;
}

function analyzeArgs(args: readonly ts.Node[], ctx: ts.Node): { hasSafe: boolean; rawEnv: boolean } {
	const out = { hasSafe: false, rawEnv: false };
	const seen = new Set<ts.Node>();
	const visit = (node: ts.Node, depth: number) => {
		if (seen.has(node)) return;
		seen.add(node);
		if (isSafeEnvCall(node)) {
			out.hasSafe = true; // process.env inside buildSafeChildEnv(...) is sanitized
			return;
		}
		if (isProcessEnv(node)) {
			if (isWholeProcessEnv(node)) out.rawEnv = true;
			return;
		}
		if (ts.isFunctionLike(node)) return; // callbacks
		if (ts.isPropertyAccessExpression(node)) return visit(node.expression, depth);
		if (ts.isPropertyAssignment(node)) return visit(node.initializer, depth);
		if (ts.isIdentifier(node)) {
			if (depth >= 4) return;
			const init = findDecl(node.text, ts.isIdentifier(node) && node.parent ? node : ctx);
			if (init) visit(init, depth + 1);
			return;
		}
		ts.forEachChild(node, (c) => visit(c, depth));
	};
	for (const a of args) visit(a, 0);
	return out;
}

function analyzeSource(rel: string, text: string): CallSite[] {
	if (!/child_process/.test(text)) return [];
	const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const b = collectBindings(sf);
	const calls: CallSite[] = [];
	const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

	for (const node of b.reexports) {
		calls.push({ file: rel, line: lineOf(node), callee: "re-export", text: node.getText(sf), safe: false });
	}

	const cpFnOf = (expr: ts.Node): string | undefined => {
		if (ts.isIdentifier(expr)) return b.names.get(expr.text);
		if (
			ts.isPropertyAccessExpression(expr) &&
			ts.isIdentifier(expr.expression) &&
			b.namespaces.has(expr.expression.text) &&
			CP_FUNCTIONS.has(expr.name.text)
		) {
			return expr.name.text;
		}
		// util.promisify(cp.execFile)(...)
		if (isPromisifyCall(expr)) return cpFnOf(expr.arguments[0]);
		return undefined;
	};

	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node)) {
			const fn = cpFnOf(node.expression);
			if (fn) {
				const { hasSafe, rawEnv } = analyzeArgs(node.arguments, node);
				calls.push({
					file: rel,
					line: lineOf(node),
					callee: fn,
					text: node.getText(sf),
					safe: hasSafe && !rawEnv,
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return calls;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (!EXCLUDED_DIRS.has(entry)) walk(full, out);
		} else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !entry.endsWith(".test.ts")) {
			out.push(full);
		}
	}
	return out;
}

function scanFile(path: string): CallSite[] {
	return analyzeSource(relative(REPO_ROOT, path), readFileSync(path, "utf8"));
}

function allowlisted(call: CallSite): boolean {
	return ALLOWLIST.some((a) => a.file === call.file && a.pattern.test(call.text));
}

const ALL_CALLS = SCAN_ROOTS.flatMap((r) => walk(r)).flatMap(scanFile);

describe("F3-0 child env — static coverage of child_process call sites", () => {
	it("scanner is not vacuous (finds the known call sites)", () => {
		const files = new Set(ALL_CALLS.map((c) => c.file));
		for (const expected of [
			"apps/kernel/src/studio/app-runner/starter.ts",
			"apps/kernel/src/studio/app-runner/process-manager.ts",
			"apps/kernel/src/studio/routes/terminal-routes.ts",
			"apps/kernel/src/studio/lint-runner.ts",
			"apps/kernel/src/studio/task-runners.ts",
			"apps/kernel/src/studio/routes/runtime-routes.ts",
			"apps/kernel/src/studio/planner-cli.ts",
			"apps/kernel/src/studio/git/commit-executor.ts",
			"apps/kernel/src/studio/diff-capture.ts",
			"packages/provider-sdk/src/cli-runner.ts",
		]) {
			expect(files.has(expected), `scanner did not find child_process calls in ${expected}`).toBe(true);
		}
		expect(ALL_CALLS.length).toBeGreaterThan(30);
	});

	it("every child_process call passes env built by buildSafeChildEnv (or is allowlisted)", () => {
		const offenders = ALL_CALLS.filter((c) => !c.safe && !allowlisted(c));
		const report = offenders.map((c) => `  ${c.file}:${c.line}  ${c.callee}()  → fix: ${FIX_HINT}`).join("\n");
		expect(
			offenders.length,
			`${offenders.length} child_process call(s) inherit/leak the full process.env:\n${report}`,
		).toBe(0);
	});

	it("every allowlist entry still matches a real call (no stale exemptions)", () => {
		const stale = ALLOWLIST.filter((a) => !ALL_CALLS.some((c) => c.file === a.file && a.pattern.test(c.text)));
		expect(stale.map((a) => `${a.file} /${a.pattern.source}/`)).toEqual([]);
	});

	it("allowlisted calls never carry a tenant repo cwd", () => {
		const bad = ALL_CALLS.filter(
			(c) => allowlisted(c) && /\bcwd\s*:\s*(?:repoPath|svcPath|projectPath|workspace)/i.test(c.text),
		);
		expect(bad.map((c) => `${c.file}:${c.line}`)).toEqual([]);
	});

	it("allowlist entries all carry a reason", () => {
		for (const a of ALLOWLIST) expect(a.reason.length, `${a.file} /${a.pattern.source}/`).toBeGreaterThan(10);
	});
});

// ---------------------------------------------------------------------------
// Detector self-checks (in-memory sources)
// ---------------------------------------------------------------------------
describe("F3-0 static detector — self-check", () => {
	const SAFE = `buildSafeChildEnv({ profile: "build_tool" })`;
	const run = (src: string) => analyzeSource("fake.ts", src);

	it("named import: flags unsanitized, accepts inline buildSafeChildEnv", () => {
		const calls = run(
			`import { execFileSync } from "node:child_process";
execFileSync("git", ["status"], { cwd: repo });
execFileSync("git", ["status"], { cwd: repo, env: ${SAFE} });`,
		);
		expect(calls.map((c) => c.safe)).toEqual([false, true]);
		expect(calls[0].line).toBe(2);
	});

	it("aliased named import", () => {
		const calls = run(`import { execSync as sh } from "child_process";\nsh("ls");`);
		expect(calls).toHaveLength(1);
		expect(calls[0].callee).toBe("execSync");
		expect(calls[0].safe).toBe(false);
	});

	it("default import and mixed default + named import", () => {
		const calls = run(
			`import cp, { spawn } from "node:child_process";\ncp.execSync("ls");\nspawn("ls", [], { env: ${SAFE} });`,
		);
		expect(calls.map((c) => [c.callee, c.safe])).toEqual([
			["execSync", false],
			["spawn", true],
		]);
	});

	it("namespace import", () => {
		const calls = run(`import * as cp from "node:child_process";\ncp.exec("ls");`);
		expect(calls).toHaveLength(1);
		expect(calls[0].safe).toBe(false);
	});

	it("import cp = require(...)", () => {
		const calls = run(`import cp = require("child_process");\ncp.execSync("ls");`);
		expect(calls).toHaveLength(1);
	});

	it("dynamic import, destructured and namespace", () => {
		const d = run(
			`async function f() { const { execFile } = await import("node:child_process"); execFile("x", [], {}, () => {}); }`,
		);
		expect(d).toHaveLength(1);
		expect(d[0].safe).toBe(false);
		const n = run(`async function f() { const cp = await import("node:child_process"); cp.spawn("x"); }`);
		expect(n).toHaveLength(1);
		expect(n[0].safe).toBe(false);
	});

	it("promisify(execFile) and promisify(cp.execFile) aliases, plus inline use", () => {
		const calls = run(
			`import { execFile } from "node:child_process";
import * as cp from "node:child_process";
import { promisify } from "node:util";
const a = promisify(execFile);
const b = promisify(cp.execFile);
a("x", [], { env: ${SAFE} });
b("x", []);
promisify(cp.execFile)("y", []);`,
		);
		expect(calls.map((c) => c.safe)).toEqual([true, false, false]);
	});

	it("re-exports are flagged", () => {
		expect(run(`export { execSync } from "node:child_process";`).map((c) => [c.callee, c.safe])).toEqual([
			["re-export", false],
		]);
		expect(run(`export * from "child_process";`)).toHaveLength(1);
	});

	it("const initialised from buildSafeChildEnv in the same function is safe (explicit and shorthand)", () => {
		const calls = run(
			`import { execFileSync } from "node:child_process";
function a() { const env = ${SAFE}; execFileSync("git", [], { cwd: r, env }); }
function b() { const e2 = ${SAFE}; execFileSync("git", [], { env: e2 }); }
function c() { const opts = { env: ${SAFE} }; execFileSync("git", [], opts); }`,
		);
		expect(calls.map((c) => c.safe)).toEqual([true, true, true]);
	});

	it("a safe const in ANOTHER function does not count", () => {
		const calls = run(
			`import { execFileSync } from "node:child_process";
function a() { const env = ${SAFE}; return env; }
function b() { const env = {}; execFileSync("git", [], { env }); }`,
		);
		expect(calls.map((c) => c.safe)).toEqual([false]);
	});

	it("process.env (direct, spread, or via a safe-looking const) makes the call unsafe", () => {
		const calls = run(
			`import { execFileSync } from "node:child_process";
execFileSync("git", [], { env: process.env });
execFileSync("git", [], { env: { ...process.env, ...${SAFE} } });
execFileSync("git", [], { env: { ...${SAFE}, ...process["env"] } });
function f() { const env = { ...process.env, ...${SAFE} }; execFileSync("git", [], { env }); }
execFileSync("git", [], { env: ${SAFE.replace("}", ", base: process.env }")} });`,
		);
		expect(calls.map((c) => c.safe)).toEqual([false, false, false, false, true]);
	});

	it("reading a single process.env key (e.g. SHELL as the binary) is not an env leak", () => {
		const calls = run(
			`import { spawn } from "node:child_process";
function f() { const shell = process.env.SHELL || "/bin/zsh"; spawn(shell, ["-lc", "x"], { env: ${SAFE} }); }
function g() { spawn("x", [], { env: { TOKEN: process.env.TOKEN } }); }`,
		);
		expect(calls.map((c) => c.safe)).toEqual([true, false]);
	});

	it("type-only imports and unrelated functions are ignored", () => {
		expect(run(`import type { execSync } from "node:child_process";\nexecSync("x");`)).toEqual([]);
		expect(run(`import { spawn } from "node:child_process";\nconst x = other.spawn("y");`)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// simple-git: every simpleGit(...) factory call must chain .env(buildSafeChildEnv(...))
// ---------------------------------------------------------------------------

interface GitSite {
	file: string;
	line: number;
	safe: boolean;
}

function analyzeSimpleGit(rel: string, text: string): GitSite[] {
	if (!/simple-git/.test(text)) return [];
	const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const names = new Set<string>();
	const visitImports = (node: ts.Node) => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteralLike(node.moduleSpecifier) &&
			node.moduleSpecifier.text === "simple-git"
		) {
			const nb = node.importClause?.namedBindings;
			if (node.importClause?.name) names.add(node.importClause.name.text);
			if (nb && ts.isNamedImports(nb)) {
				for (const el of nb.elements) {
					if ((el.propertyName ?? el.name).text === "simpleGit" || (el.propertyName ?? el.name).text === "default")
						names.add(el.name.text);
				}
			}
		}
		ts.forEachChild(node, visitImports);
	};
	visitImports(sf);
	const sites: GitSite[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) {
			let safe = false;
			let cur: ts.Node = node;
			// walk up the call chain: simpleGit(x).env(...).foo()
			while (
				cur.parent &&
				ts.isPropertyAccessExpression(cur.parent) &&
				cur.parent.expression === cur &&
				cur.parent.parent &&
				ts.isCallExpression(cur.parent.parent)
			) {
				const call = cur.parent.parent;
				if (
					cur.parent.name.text === "env" &&
					call.arguments.some((a) => /buildSafeChildEnv\s*\(/.test(a.getText(sf)))
				) {
					safe = true;
				}
				cur = call;
			}
			sites.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, safe });
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return sites;
}

const ALL_GIT_SITES = SCAN_ROOTS.flatMap((r) => walk(r)).flatMap((p) =>
	analyzeSimpleGit(relative(REPO_ROOT, p), readFileSync(p, "utf8")),
);

describe("F3-0 simple-git — static coverage", () => {
	it("scanner finds the git-manager simpleGit() call", () => {
		expect(ALL_GIT_SITES.some((s) => s.file === "apps/kernel/src/studio/git-manager.ts")).toBe(true);
	});

	it("every simpleGit() call chains .env(buildSafeChildEnv(...))", () => {
		const offenders = ALL_GIT_SITES.filter((s) => !s.safe).map(
			(s) =>
				`  ${s.file}:${s.line} simpleGit() → fix: simpleGit(path).env(buildSafeChildEnv({ profile: "build_tool" }))`,
		);
		expect(offenders.join("\n")).toBe("");
	});
});

describe("F3-0 simple-git — detector self-check", () => {
	const SAFE = `buildSafeChildEnv({ profile: "build_tool" })`;
	const run = (src: string) => analyzeSimpleGit("fake.ts", src).map((s) => s.safe);
	const IMPORT = `import { simpleGit } from "simple-git";\n`;

	it("flags a bare call, accepts .env(buildSafeChildEnv()) anywhere in the chain", () => {
		expect(
			run(
				`${IMPORT}simpleGit(p);\nsimpleGit(p).env(${SAFE});\nsimpleGit(p).env(${SAFE}).outputHandler(h);\nsimpleGit(p).outputHandler(h).env(${SAFE});`,
			),
		).toEqual([false, true, true, true]);
	});

	it("rejects .env() with raw process.env or an arbitrary object", () => {
		expect(run(`${IMPORT}simpleGit(p).env(process.env);\nsimpleGit(p).env({ A: "1" });`)).toEqual([false, false]);
	});

	it("handles aliased and default imports; ignores unrelated functions", () => {
		expect(run(`import { simpleGit as sg } from "simple-git";\nsg(p);\nsg(p).env(${SAFE});`)).toEqual([false, true]);
		expect(run(`import simpleGit from "simple-git";\nsimpleGit(p);`)).toEqual([false]);
		expect(run(`${IMPORT}other(p);\nfoo.simpleGit(p);`)).toEqual([]);
	});
});
