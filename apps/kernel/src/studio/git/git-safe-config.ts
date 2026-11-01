// Tenant workspaces are untrusted: a repo's own config, attributes and layout can make git run programs as the kernel
// user (hooks, filter/textconv/merge drivers, pagers, ssh/gpg/askpass programs, fsmonitor, includes, ...).
//
// Two layers, both applied by `gitSafeEnv`:
//
// 1. FIXED command-scope overrides (GIT_CONFIG_COUNT/KEY_n/VALUE_n; git ranks command scope above every file, and a
//    repo cannot override it): hooks off, fsmonitor off, signing off + every gpg program set to /bin/false, no pager /
//    editor / ssh / askpass / credential helper / external diff, submodule recursion and inspection off, no `ext::` or
//    `file://` transports, bare-repo discovery only when explicit. Plus GIT_CONFIG_NOSYSTEM/GLOBAL, no terminal prompt,
//    no alternate object directories.
//
// 2. A per-call PRE-FLIGHT (`inspectRepoGitConfig`, nothing is cached) when a repo path is supplied. It never trusts
//    the repo: it resolves the git dir, then reads every non-command config scope (local, worktree, and whatever
//    `include.path` pulls in: once with and once without includes) and classifies EVERY key against an allow-list:
//      (a) KNOWN-SAFE  -> allowed:   core.{repositoryformatversion,filemode,logallrefupdates,ignorecase,
//          precomposeunicode,symlinks,autocrlf,eol,safecrlf,quotepath}, core.bare=false, user.*, color.*, advice.*,
//          i18n.*, init.defaultbranch, remote.<n>.{url,fetch,pushurl,tagopt,prune,push},
//          branch.<n>.{remote,merge,rebase,vscode-merge-base,pushremote,description}, core.{untrackedcache,sparsecheckout},
//          pull.{rebase,ff}, push.{default,autosetupremote}, merge.{conflictstyle,ff}, merge.<n>.name,
//          diff.{algorithm,renames}, diff.<n>.{binary,xfuncname,funcname,wordregex}, extensions.objectformat,
//          fetch.prune, status.showuntrackedfiles, submodule.<n>.{url,active}.
//      (b) NEUTRALISED -> allowed:   the kernel overrides these, so their repo values never run:
//          filter.<n>.* and diff.<n>.{textconv,command,cachetextconv} (overridden BY NAME, discovered here),
//          core.{pager,sshcommand,fsmonitor,hookspath,editor,askpass}, pager.*, diff.external, sequence.editor,
//          gpg.*, log.showsignature, merge.verifysignatures, commit.gpgsign, tag.gpgsign, and unconditional
//          include.path (the included keys are classified too).
//      (c) EVERYTHING ELSE -> refused with UnsafeGitRepoError. That includes includeif.* (its condition can change
//          with the checked-out branch), extensions.worktreeconfig and every other extension, core.bare=true,
//          core.worktree, core.attributesfile, submodule.<n>.update, merge.<n>.driver, url.*.insteadof,
//          credential.*, protocol.*, uploadpack.*, receive.*, remote.<n>.{uploadpack,receivepack,proxy,vcs}, http.*,
//          trailer.*, and any unknown key.
//    Layout rules: `.git` must be a real directory (no symlink, no gitfile), no `commondir`, and
//    `objects/info/alternates` / `http-alternates` are quarantined (renamed), as git has no way to ignore them.
//    A bare layout at the repo root is not discovered (`safe.bareRepository=explicit`, fixed above) and a parent
//    repo is not searched (GIT_CEILING_DIRECTORIES covers the project roots). The pre-flight deliberately costs ONE
//    git spawn (the config read; a spawn is ~150 ms on a dev machine), so it does not also run
//    `git rev-parse --absolute-git-dir`; the config read doubles as the "git accepts this repo" check.
//    Only `init` may run without a `.git` (`allowMissingGit`).
//
// Residual: a repo rewritten between the pre-flight and the git call (I2 moves git out of the kernel entirely).

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync, renameSync } from "node:fs";
import { delimiter, join } from "node:path";
import { resolve } from "node:path";
import { createLogger } from "../logger.js";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";
import { getWorkspaceRoot } from "../security/workspace-resolver.js";
const log = createLogger("git-safe-config");

const SAFE_GIT_CONFIG: [string, string][] = [
	["core.hooksPath", "/dev/null"],
	["core.fsmonitor", "false"],
	["commit.gpgSign", "false"],
	["tag.gpgSign", "false"],
	["log.showSignature", "false"],
	["merge.verifySignatures", "false"],
	["gpg.program", "/bin/false"],
	["gpg.openpgp.program", "/bin/false"],
	["gpg.x509.program", "/bin/false"],
	["gpg.ssh.program", "/bin/false"],
	["core.sshCommand", ""],
	["core.pager", "cat"],
	["core.editor", "true"],
	["sequence.editor", "true"],
	["core.askPass", ""],
	["credential.helper", ""],
	["diff.external", ""],
	["safe.bareRepository", "explicit"],
	["submodule.recurse", "false"],
	["diff.ignoreSubmodules", "all"],
	["status.submoduleSummary", "false"],
	["protocol.ext.allow", "never"],
	// the kernel never clones or fetches from a local path
	["protocol.file.allow", "never"],
];

/**
 * Passed on every kernel `status` / `diff`: `.gitmodules` `ignore=none` overrides the `diff.ignoreSubmodules` config
 * (a fixed override above) but never a command-line flag, and a populated submodule runs ITS OWN repo config.
 */
export const NO_SUBMODULES = "--ignore-submodules=all";

/** Env entries removed because they let the caller's environment pick commands git would run. */
const DROPPED_GIT_ENV = [
	"GIT_EXTERNAL_DIFF",
	"GIT_SSH",
	"GIT_SSH_COMMAND",
	"GIT_PROXY_COMMAND",
	"GIT_ASKPASS",
	"GIT_EDITOR",
	"GIT_SEQUENCE_EDITOR",
	"GIT_PAGER",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_INDEX_FILE",
];

/** Thrown when the pre-flight refuses a repo. The message never carries a server path (it reaches HTTP responses). */
export class UnsafeGitRepoError extends Error {
	constructor(repoPath: string, reason: string) {
		super(`Refusing git operation: ${reason}`);
		this.name = "UnsafeGitRepoError";
		log.warn({ repoPath, reason }, "[git-safe-config] repository refused by the git safety pre-flight");
	}
}

export interface GitSafeOptions {
	/** `git init` runs where no `.git` exists yet. */
	allowMissingGit?: boolean;
	/**
	 * Result of one `inspectRepoGitConfig` call to reuse (callers that spawn git many times for one operation run the
	 * pre-flight once). Ignored when a repo path is passed.
	 */
	preflight?: [string, string][];
}

// ---------------------------------------------------------------------------
// Allow-list
// ---------------------------------------------------------------------------

const ALLOWED_PLAIN = new Set([
	"core.repositoryformatversion",
	"core.filemode",
	"core.logallrefupdates",
	"core.ignorecase",
	"core.precomposeunicode",
	"core.symlinks",
	"core.autocrlf",
	"core.eol",
	"core.safecrlf",
	"core.quotepath",
	"init.defaultbranch",
	"pull.rebase",
	"pull.ff",
	"push.default",
	"push.autosetupremote",
	"merge.conflictstyle",
	"merge.ff",
	"diff.algorithm",
	"diff.renames",
	"extensions.objectformat",
	"fetch.prune",
	"status.showuntrackedfiles",
	"core.untrackedcache",
	"core.sparsecheckout",
]);
const ALLOWED_SECTIONS = new Set(["user", "color", "advice", "i18n"]);
/** section -> variables allowed on a `<section>.<subsection>.<variable>` key */
const ALLOWED_SUB: Record<string, Set<string>> = {
	remote: new Set(["url", "fetch", "pushurl", "tagopt", "prune", "push"]),
	branch: new Set(["remote", "merge", "rebase", "vscode-merge-base", "pushremote", "description"]),
	merge: new Set(["name"]),
	diff: new Set(["binary", "xfuncname", "funcname", "wordregex"]),
	submodule: new Set(["url", "active"]),
};
const NEUTRALISED_PLAIN = new Set([
	"core.pager",
	"core.sshcommand",
	"core.fsmonitor",
	"core.hookspath",
	"core.editor",
	"core.askpass",
	"diff.external",
	"sequence.editor",
	"log.showsignature",
	"merge.verifysignatures",
	"commit.gpgsign",
	"tag.gpgsign",
	"include.path",
]);
const FALSE_VALUES = new Set(["false", "no", "off", "0"]);

type KeyClass = "allowed" | "neutralised" | "refused";

interface ParsedKey {
	section: string;
	/** original-case subsection, if any */
	sub?: string;
	variable: string;
}

function parseKey(key: string): ParsedKey {
	const first = key.indexOf(".");
	const last = key.lastIndexOf(".");
	if (first < 0) return { section: key.toLowerCase(), variable: "" };
	return {
		section: key.slice(0, first).toLowerCase(),
		sub: first === last ? undefined : key.slice(first + 1, last),
		variable: key.slice(last + 1).toLowerCase(),
	};
}

function classifyKey(key: string, value: string | undefined): KeyClass {
	const { section, sub, variable } = parseKey(key);
	const lower = key.toLowerCase();
	if (sub === undefined) {
		if (lower === "core.bare")
			return value !== undefined && FALSE_VALUES.has(value.trim().toLowerCase()) ? "allowed" : "refused";
		if (NEUTRALISED_PLAIN.has(lower)) return "neutralised";
		if (section === "pager" || section === "gpg") return "neutralised";
		if (ALLOWED_PLAIN.has(lower) || ALLOWED_SECTIONS.has(section)) return "allowed";
		return "refused";
	}
	if (section === "filter") return "neutralised";
	if (section === "diff" && ["textconv", "command", "cachetextconv"].includes(variable)) return "neutralised";
	if (section === "gpg") return "neutralised";
	if (section === "pager") return "neutralised";
	if (ALLOWED_SECTIONS.has(section)) return "allowed";
	if (ALLOWED_SUB[section]?.has(variable)) return "allowed";
	return "refused";
}

/** Command-scope overrides for the repo-defined drivers named in `keys`. */
function neutraliseDrivers(keys: string[]): [string, string][] {
	const out: [string, string][] = [];
	const seen = new Set<string>();
	const add = (key: string, value: string) => {
		if (seen.has(key)) return;
		seen.add(key);
		out.push([key, value]);
	};
	for (const key of keys) {
		const { section, sub, variable } = parseKey(key);
		if (sub === undefined) continue;
		if (section === "filter") {
			// clean/smudge become identity filters; `process` fails its handshake and, with required=false, git falls back
			add(`filter.${sub}.clean`, "cat");
			add(`filter.${sub}.smudge`, "cat");
			add(`filter.${sub}.process`, "cat");
			add(`filter.${sub}.required`, "false");
		} else if (section === "diff" && variable === "textconv") {
			add(`diff.${sub}.textconv`, "cat");
		} else if (section === "diff" && variable === "command") {
			add(`diff.${sub}.command`, "");
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

function runGit(repoPath: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd: repoPath,
		encoding: "utf-8",
		timeout: 5000,
		stdio: ["ignore", "pipe", "pipe"],
		env: gitSafeEnv(buildSafeChildEnv({ profile: "build_tool" })),
	});
}

/** Entries of `git config --list` across every non-command scope: key (original case) and value (undefined = bare). */
function readConfigEntries(repoPath: string): { key: string; value?: string }[] {
	let raw: string;
	try {
		raw = runGit(repoPath, ["config", "--includes", "--show-scope", "-z", "--list"]);
	} catch (err) {
		if ((err as { status?: number }).status === 1) return [];
		throw new UnsafeGitRepoError(repoPath, "repository config cannot be read");
	}
	const tokens = raw.split("\0");
	const entries: { key: string; value?: string }[] = [];
	// output is `scope \0 key\nvalue \0 scope \0 key \0 ...`
	for (let i = 0; i + 1 < tokens.length; i += 2) {
		const scope = tokens[i];
		const entry = tokens[i + 1];
		if (scope === "command") continue; // our own overrides
		const nl = entry.indexOf("\n");
		entries.push(nl < 0 ? { key: entry } : { key: entry.slice(0, nl), value: entry.slice(nl + 1) });
	}
	return entries;
}

/**
 * Pre-flight for one kernel git operation in `repoPath` (nothing is cached): validates the layout, quarantines
 * alternates, classifies the config against the allow-list and returns the command-scope overrides that neutralise
 * repo-defined drivers. Throws UnsafeGitRepoError to refuse.
 */
export function inspectRepoGitConfig(repoPath: string, opts: GitSafeOptions = {}): [string, string][] {
	const gitEntry = join(repoPath, ".git");
	let st: ReturnType<typeof lstatSync> | undefined;
	try {
		st = lstatSync(gitEntry);
	} catch {
		st = undefined;
	}
	if (!st) {
		if (opts.allowMissingGit) return [];
		throw new UnsafeGitRepoError(repoPath, "no .git directory in the repository root");
	}
	if (st.isSymbolicLink()) throw new UnsafeGitRepoError(repoPath, ".git is a symlink");
	if (!st.isDirectory()) throw new UnsafeGitRepoError(repoPath, ".git is not a directory");

	const gitDir = realpathSync(gitEntry);
	if (existsSync(join(gitDir, "commondir")))
		throw new UnsafeGitRepoError(repoPath, "repository uses a shared commondir");
	for (const alt of ["alternates", "http-alternates"]) {
		const file = join(gitDir, "objects", "info", alt);
		if (!existsSync(file)) continue;
		renameSync(file, `${file}.oscorpex-quarantined`);
		log.warn({ repoPath, file }, "[git-safe-config] quarantined repository alternates file");
	}

	const seen = new Set<string>();
	const entries = readConfigEntries(repoPath).filter((e) => {
		const id = `${e.key}\n${e.value ?? ""}`;
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
	const neutralise: string[] = [];
	for (const { key, value } of entries) {
		const cls = classifyKey(key, value);
		if (cls === "refused") throw new UnsafeGitRepoError(repoPath, `repository config sets ${key}`);
		if (cls === "neutralised") neutralise.push(key);
	}
	return neutraliseDrivers(neutralise);
}

// ---------------------------------------------------------------------------
// Ceilings + env
// ---------------------------------------------------------------------------

/**
 * Directories git must never search upward past: project repos live under them, so a project dir without its own
 * .git must not resolve to the enclosing Oscorpex checkout. Computed per call (cwd-relative).
 */
export function projectRepoCeilings(): string[] {
	return [resolve(".oscorpex/repos"), getWorkspaceRoot()];
}

/** `existing` GIT_CEILING_DIRECTORIES entries merged with the project roots (roots first, de-duplicated). */
export function mergeGitCeilings(...existing: (string | undefined)[]): string {
	const extra = existing.flatMap((v) => (v ?? "").split(delimiter));
	return [...new Set([...projectRepoCeilings(), ...extra].filter(Boolean))].join(delimiter);
}

/**
 * Returns `env` with the hardening config applied; any GIT_CONFIG_* entries it already carried are dropped.
 * Pass `repoPath` for every call that runs git inside a repo: it triggers the per-call pre-flight above.
 */
export function gitSafeEnv(env: NodeJS.ProcessEnv, repoPath?: string, opts: GitSafeOptions = {}): NodeJS.ProcessEnv {
	const entries = [...SAFE_GIT_CONFIG, ...(repoPath ? inspectRepoGitConfig(repoPath, opts) : (opts.preflight ?? []))];
	const out: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(env)) {
		if (!/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key) && !DROPPED_GIT_ENV.includes(key)) out[key] = value;
	}
	out.GIT_CEILING_DIRECTORIES = mergeGitCeilings(env.GIT_CEILING_DIRECTORIES);
	out.GIT_CONFIG_NOSYSTEM = "1";
	out.GIT_CONFIG_GLOBAL = "/dev/null";
	out.GIT_TERMINAL_PROMPT = "0";
	out.GIT_PAGER = "cat";
	out.GIT_EDITOR = "true";
	out.GIT_SEQUENCE_EDITOR = "true";
	out.GIT_ALTERNATE_OBJECT_DIRECTORIES = "";
	out.GIT_CONFIG_COUNT = String(entries.length);
	entries.forEach(([key, value], i) => {
		out[`GIT_CONFIG_KEY_${i}`] = key;
		out[`GIT_CONFIG_VALUE_${i}`] = value;
	});
	return out;
}
