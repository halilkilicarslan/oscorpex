// ---------------------------------------------------------------------------
// Oscorpex — Git Manager
// Branch management, commits, merges, file tree, diffs
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";
import { assertGitPaths, assertGitRef, assertGitSha } from "./git/git-input.js";
import { type GitSafeOptions, NO_SUBMODULES, gitSafeEnv } from "./git/git-safe-config.js";
import { createLogger } from "./logger.js";
import {
	readContainedDir,
	readContainedFile,
	removeContainedFile,
	statContainedFile,
	writeContainedFile,
} from "./security/contained-fs.js";
import { buildSafeChildEnv } from "./security/env-sanitizer.js";
import { enforceGitPolicy } from "./security/git-file-policy.js";
import type { FileTreeNode, GitLogEntry, GitStatus, MergeResult } from "./types.js";
const log = createLogger("git-manager");

class GitManager {
	/**
	 * One simple-git instance per public operation: the repo pre-flight (git-safe-config) runs here, once per call.
	 * Only `initRepo` may run where no `.git` exists yet.
	 */
	private getGit(repoPath: string, opts?: GitSafeOptions): SimpleGit {
		return simpleGit(repoPath).env(
			gitSafeEnv(buildSafeChildEnv({ profile: "build_tool" }), repoPath, opts) as Record<string, string>,
		);
	}

	/**
	 * True when something is staged (submodules ignored). Checked before every commit: with nothing staged `git commit`
	 * prints a full status, which recurses into populated submodules (and their own repo config). The names are read
	 * from stdout rather than the exit code because simple-git `raw()` resolves on an empty stderr.
	 */
	private async hasStaged(git: SimpleGit): Promise<boolean> {
		return (await git.raw(["diff", "--cached", "--name-only", NO_SUBMODULES])).trim().length > 0;
	}

	/** Paths of every gitlink (submodule entry) in the index; one `ls-files` spawn. */
	private async gitlinkPaths(git: SimpleGit): Promise<string[]> {
		return (await git.raw(["ls-files", "-z", "--stage"]))
			.split("\0")
			.filter((entry) => entry.startsWith("160000 "))
			.map((entry) => entry.slice(entry.indexOf("\t") + 1))
			.filter(Boolean);
	}

	/**
	 * `git add .` without touching submodule entries. Staging a gitlink makes git inspect the populated submodule (a
	 * `git status` run INSIDE it, with its own repo config and filters), and no flag on `add` turns that off, so every
	 * gitlink in the index is excluded by literal pathspec. Submodules are not part of kernel commits.
	 */
	private async addAll(git: SimpleGit): Promise<void> {
		const gitlinks = await this.gitlinkPaths(git);
		await git.raw(["add", "--", ".", ...gitlinks.map((path) => `:(exclude,literal)${path}`)]);
	}

	/**
	 * `git add` for explicit files (their names come from agent output, i.e. tenant-influenced): any path that is, or
	 * lies under, a gitlink is dropped (same reason as addAll), and the rest are `:(literal)` pathspecs so a file name
	 * can never act as a glob or pathspec magic. Returns how many paths were staged (0 → nothing was run).
	 */
	private async addFiles(git: SimpleGit, files: string[]): Promise<number> {
		const gitlinks = (await this.gitlinkPaths(git)).map((p) => p.replace(/\/+$/, ""));
		const keep = files.filter((file) => {
			const path = normalize(file)
				.replace(/^(\.\/)+/, "")
				.replace(/\/+$/, "");
			return !gitlinks.some((link) => path === link || path.startsWith(`${link}/`));
		});
		if (keep.length === 0) return 0;
		await git.raw(["add", "--", ...keep.map((file) => `:(literal)${file}`)]);
		return keep.length;
	}

	// -------------------------------------------------------------------------
	// Repository setup
	// -------------------------------------------------------------------------

	async initRepo(projectPath: string): Promise<void> {
		const git = this.getGit(projectPath, { allowMissingGit: true });

		// Sandbox/CI friendly: avoid copying system templates (hooks) which may
		// try to write into restricted locations or fail on permission bits.
		const emptyTemplateDir = join(projectPath, ".git-template-empty");
		await mkdir(emptyTemplateDir, { recursive: true });
		await git.raw(["init", "--template", emptyTemplateDir]);

		await git.addConfig("user.name", "Oscorpex");
		await git.addConfig("user.email", "studio@ai-dev.local");

		// Create initial commit so branches work
		await writeFile(join(projectPath, ".gitkeep"), "");
		await git.add(".gitkeep");
		await git.commit("Initial commit");
	}

	async isRepo(projectPath: string): Promise<boolean> {
		try {
			// We intentionally check for a .git directory *in the provided path*
			// to avoid treating nested folders inside a parent repo as repos.
			await stat(join(projectPath, ".git"));
			return true;
		} catch {
			return false;
		}
	}

	// -------------------------------------------------------------------------
	// Branch operations
	// -------------------------------------------------------------------------

	async createBranch(projectPath: string, branchName: string): Promise<void> {
		assertGitRef(branchName, "branch name");
		const git = this.getGit(projectPath);
		await git.raw(["checkout", "--quiet", "-b", branchName]);
	}

	async checkout(projectPath: string, branch: string, projectId = "system"): Promise<void> {
		// P4-2: Policy enforcement before git mutation
		enforceGitPolicy({
			operation: "checkout",
			ref: branch,
			source: "system",
			actorId: "system",
			tenantId: "system",
			projectId,
		});
		assertGitRef(branch, "branch");
		const git = this.getGit(projectPath);
		// --quiet: skips the local-changes report, which recurses into submodules. The trailing `--` forces branch-only
		// interpretation (checkout has no --end-of-options before git 2.43); the ref was already validated (no leading `-`).
		await git.raw(["checkout", "--quiet", branch, "--"]);
	}

	async getCurrentBranch(projectPath: string): Promise<string> {
		const git = this.getGit(projectPath);
		const status = await git.status([NO_SUBMODULES]);
		return status.current ?? "main";
	}

	async listBranches(projectPath: string): Promise<string[]> {
		const git = this.getGit(projectPath);
		const result = await git.branchLocal();
		return result.all;
	}

	// -------------------------------------------------------------------------
	// Commit operations
	// -------------------------------------------------------------------------

	async commit(projectPath: string, message: string, projectId = "system"): Promise<string> {
		// P4-2: Policy enforcement before git mutation
		enforceGitPolicy({
			operation: "commit",
			source: "system",
			actorId: "system",
			tenantId: "system",
			projectId,
		});
		const git = this.getGit(projectPath);
		await this.addAll(git);
		if (!(await this.hasStaged(git))) return "";
		const result = await git.commit(message);
		return result.commit;
	}

	async commitFiles(projectPath: string, files: string[], message: string, projectId = "system"): Promise<string> {
		// P4-2: Policy enforcement before git mutation
		enforceGitPolicy({
			operation: "commit",
			source: "system",
			actorId: "system",
			tenantId: "system",
			projectId,
		});
		assertGitPaths(files);
		const git = this.getGit(projectPath);
		await this.addFiles(git, files);
		if (!(await this.hasStaged(git))) return "";
		const result = await git.commit(message);
		return result.commit;
	}

	// -------------------------------------------------------------------------
	// Merge operations
	// -------------------------------------------------------------------------

	async merge(projectPath: string, source: string, target: string, projectId = "system"): Promise<MergeResult> {
		// P4-2: Policy enforcement before git mutation
		enforceGitPolicy({
			operation: "merge",
			ref: source,
			source: "system",
			actorId: "system",
			tenantId: "system",
			projectId,
		});
		assertGitRef(source, "source branch");
		assertGitRef(target, "target branch");
		const git = this.getGit(projectPath);

		await git.raw(["checkout", "--quiet", target, "--"]);

		// simple-git resolves raw() whenever stderr is empty, and git prints conflicts on stdout (and localises them),
		// so a conflict is detected from repository STATE, never from the error text or the absence of an exception.
		let mergeError: unknown;
		try {
			await git.raw(["merge", "--end-of-options", source]);
		} catch (error) {
			mergeError = error;
		}

		// a conflicted merge always leaves MERGE_HEAD behind, so a clean success needs no extra `status` spawn
		const mergeInProgress = existsSync(join(projectPath, ".git", "MERGE_HEAD"));
		const conflicts = mergeError || mergeInProgress ? (await git.status([NO_SUBMODULES])).conflicted : [];
		if (conflicts.length > 0 || mergeInProgress) {
			// Leave the tree clean: abort the half-done merge
			await git.raw(["merge", "--abort"]).catch((err) => log.warn({ err }, "[git-manager] merge --abort failed"));
			return { success: false, conflicts };
		}
		if (mergeError) throw mergeError;
		return { success: true };
	}

	/**
	 * Kaynak branch'i hedef branch'e merge eder.
	 * merge() fonksiyonunun API dostu alias'ı — route'lardan çağrılmak üzere.
	 * Conflict durumunda { success: false, conflicts: [...] } döner.
	 * Merge başarılıysa hedef branch'e geçişi de gerçekleştirir.
	 */
	async mergeBranch(projectPath: string, sourceBranch: string, targetBranch: string): Promise<MergeResult> {
		return this.merge(projectPath, sourceBranch, targetBranch);
	}

	// -------------------------------------------------------------------------
	// Commit geri alma (revert)
	// -------------------------------------------------------------------------

	/**
	 * Belirli bir commit'i geri alır.
	 * `git revert --no-edit {hash}` komutuyla yeni bir revert commit oluşturur.
	 * Orijinal commit'i silmez; güvenli bir geri alma yöntemidir.
	 */
	async revertCommit(projectPath: string, commitHash: string, projectId = "system"): Promise<string> {
		// P4-2: Policy enforcement before git mutation
		enforceGitPolicy({
			operation: "reset-soft",
			ref: commitHash,
			source: "system",
			actorId: "system",
			tenantId: "system",
			projectId,
		});
		// Hash formatını doğrula — sadece hex karakterlere izin ver
		assertGitSha(commitHash);
		const git = this.getGit(projectPath);

		try {
			// --no-edit: otomatik commit mesajı kullan, editör açma
			await git.raw(["revert", "--no-edit", "--end-of-options", commitHash]);
			// Revert sonrası oluşan commit'in hash'ini döndür
			const log = await git.log({ maxCount: 1 });
			return log.latest?.hash.slice(0, 8) ?? "";
		} catch (error: any) {
			// Merge conflict durumunda revert'i iptal et
			try {
				await git.raw(["revert", "--abort"]);
			} catch {
				// Abort başarısız olursa yoksay
			}
			const msg = error?.message ?? "Revert başarısız oldu";
			throw new Error(`Commit geri alınamadı: ${msg}`);
		}
	}

	/**
	 * Son N commit'i döndürür.
	 * Her kayıtta: hash (kısa), message, date (ISO), author bilgisi bulunur.
	 * getLog() ile aynı işlevi görür — API tutarlılığı için alias olarak eklendi.
	 */
	async getCommitLog(projectPath: string, limit = 20): Promise<GitLogEntry[]> {
		return this.getLog(projectPath, limit);
	}

	// -------------------------------------------------------------------------
	// Log & diff
	// -------------------------------------------------------------------------

	async getLog(projectPath: string, limit = 50): Promise<GitLogEntry[]> {
		const git = this.getGit(projectPath);

		try {
			const log = await git.log({ maxCount: limit });
			return log.all.map((entry) => ({
				hash: entry.hash.slice(0, 8),
				message: entry.message,
				author: entry.author_name,
				date: entry.date,
			}));
		} catch {
			return [];
		}
	}

	async getDiff(projectPath: string, ref?: string): Promise<string> {
		if (ref) assertGitRef(ref, "ref");
		const git = this.getGit(projectPath);

		if (ref) {
			return git.diff(["--no-ext-diff", "--no-textconv", NO_SUBMODULES, "--end-of-options", ref]);
		}
		// Unstaged + staged changes
		return git.diff(["--no-ext-diff", "--no-textconv", NO_SUBMODULES, "HEAD"]);
	}

	async getDiffBetween(projectPath: string, from: string, to: string): Promise<string> {
		assertGitRef(from, "ref");
		assertGitRef(to, "ref");
		const git = this.getGit(projectPath);
		return git.diff(["--no-ext-diff", "--no-textconv", NO_SUBMODULES, "--end-of-options", `${from}...${to}`]);
	}

	// -------------------------------------------------------------------------
	// File tree & content
	// -------------------------------------------------------------------------

	async getFileTree(projectPath: string, subPath = ""): Promise<FileTreeNode[]> {
		// Refuses a symlinked segment on the way: a planted `src -> /elsewhere` must not be listed
		const entries = await readContainedDir(projectPath, subPath);
		const nodes: FileTreeNode[] = [];

		for (const entry of entries) {
			// Skip hidden files/dirs and node_modules
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

			const entryPath = join(subPath, entry.name);

			if (entry.isDirectory()) {
				const children = await this.getFileTree(projectPath, entryPath);
				nodes.push({
					name: entry.name,
					path: entryPath,
					type: "directory",
					children,
				});
			} else {
				nodes.push({
					name: entry.name,
					path: entryPath,
					type: "file",
				});
			}
		}

		// Sort: directories first, then alphabetical
		return nodes.sort((a, b) => {
			if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	async getFileContent(projectPath: string, filePath: string): Promise<string> {
		// O_NOFOLLOW open + descriptor verification: safe against a symlink swapped in after the check
		return (await readContainedFile(projectPath, filePath)).data.toString("utf-8");
	}

	async writeFileContent(projectPath: string, filePath: string, content: string): Promise<void> {
		// Containment is checked before any directory is created
		await writeContainedFile(projectPath, filePath, content, { mkdirs: true });
	}

	// -------------------------------------------------------------------------
	// File create / delete
	// -------------------------------------------------------------------------

	/** Yeni dosya oluşturur. Dosya zaten mevcutsa hata fırlatır. */
	async createFile(projectPath: string, filePath: string, content = ""): Promise<void> {
		// Güvenlik: path traversal engelleme
		const normalized = normalize(filePath);
		if (normalized.includes("..")) {
			throw new Error("Invalid file path: directory traversal not allowed");
		}

		try {
			await writeContainedFile(projectPath, normalized, content, { mkdirs: true, exclusive: true });
		} catch (err: any) {
			if (err?.code === "EEXIST") throw new Error(`File already exists: ${filePath}`);
			throw err;
		}
	}

	/** Belirtilen dosyayı siler. */
	async deleteFile(projectPath: string, filePath: string): Promise<void> {
		const normalized = normalize(filePath);
		if (normalized.includes("..")) {
			throw new Error("Invalid file path: directory traversal not allowed");
		}

		await removeContainedFile(projectPath, normalized);
	}

	// -------------------------------------------------------------------------
	// Git status & commit
	// -------------------------------------------------------------------------

	/** Çalışma dizininin git durumunu döndürür. */
	async getStatus(projectPath: string): Promise<import("./types.js").GitStatus> {
		const git = this.getGit(projectPath);
		try {
			const status = await git.status([NO_SUBMODULES]);
			return {
				modified: status.modified,
				untracked: status.not_added,
				staged: status.staged,
				deleted: status.deleted,
			};
		} catch {
			return { modified: [], untracked: [], staged: [], deleted: [] };
		}
	}

	/**
	 * Değişiklikleri commit eder.
	 * - `files` belirtilirse yalnızca o dosyalar stage edilir.
	 * - `files` belirtilmezse tüm değişiklikler (git add .) eklenir.
	 * - Stage edilecek değişiklik yoksa hata fırlatır.
	 */
	async commitChanges(projectPath: string, message: string, files?: string[], projectId = "system"): Promise<string> {
		// P4-2: Policy enforcement before git mutation
		enforceGitPolicy({
			operation: "commit",
			source: "system",
			actorId: "system",
			tenantId: "system",
			projectId,
		});
		const git = this.getGit(projectPath);

		if (files && files.length > 0) {
			// Path traversal kontrolü
			for (const f of files) {
				const normalized = normalize(f);
				if (normalized.includes("..")) {
					throw new Error(`Invalid file path: ${f}`);
				}
			}
			assertGitPaths(files);
			await this.addFiles(git, files);
		} else {
			await this.addAll(git);
		}

		// Stage edilmiş değişiklik var mı kontrol et
		const status = await git.status([NO_SUBMODULES]);
		if (status.staged.length === 0) {
			throw new Error("Nothing to commit: no staged changes");
		}

		const result = await git.commit(message);
		return result.commit;
	}

	async getFileStats(projectPath: string, filePath: string): Promise<{ size: number; modified: string }> {
		// Parent directories are verified (a symlinked parent is refused), the leaf itself is lstat-ed
		const s = await statContainedFile(projectPath, filePath);
		return { size: s.size, modified: s.mtime.toISOString() };
	}

	// -------------------------------------------------------------------------
	// Docs system helpers
	// -------------------------------------------------------------------------

	/** Initialize docs/ folder structure for a new project */
	async initDocs(projectPath: string): Promise<void> {
		const files: Record<string, string> = {
			"PROJECT.md": "# Project\n\n> Generated by Oscorpex Planner.\n\n## Overview\n\nTBD\n\n## Requirements\n\nTBD\n",
			"ARCHITECTURE.md": "# Architecture\n\n> Generated by Oscorpex Architect Agent.\n\nTBD\n",
			"CODING_STANDARDS.md": "# Coding Standards\n\nTBD\n",
			"API_CONTRACT.md": "# API Contract\n\nTBD\n",
			"CHANGELOG.md": "# Changelog\n\nAll notable changes to this project.\n",
			"DECISIONS.md":
				"# Decision Log\n\n| Date | Decision | Rationale | Agent |\n|------|----------|-----------|-------|\n",
		};

		for (const [name, content] of Object.entries(files)) {
			await writeContainedFile(projectPath, join("docs", name), content, { mkdirs: true });
		}
	}

	/** Read a doc file relative to the project's docs/ folder */
	async readDoc(projectPath: string, docName: string): Promise<string | null> {
		try {
			return (await readContainedFile(projectPath, join("docs", docName))).data.toString("utf-8");
		} catch {
			return null;
		}
	}

	/** Build context string from relevant docs for a given agent role */
	async buildAgentContext(projectPath: string, role: string): Promise<string> {
		const docs: string[] = [];

		// Always include coding standards
		const standards = await this.readDoc(projectPath, "CODING_STANDARDS.md");
		if (standards) docs.push(standards);

		// Role-specific docs
		if (role === "backend" || role === "coder") {
			const api = await this.readDoc(projectPath, "API_CONTRACT.md");
			if (api) docs.push(api);
		}

		if (role === "frontend" || role === "coder") {
			const api = await this.readDoc(projectPath, "API_CONTRACT.md");
			if (api && !docs.includes(api)) docs.push(api);
		}

		if (role === "architect") {
			const arch = await this.readDoc(projectPath, "ARCHITECTURE.md");
			if (arch) docs.push(arch);
		}

		// Always include project overview
		const project = await this.readDoc(projectPath, "PROJECT.md");
		if (project) docs.unshift(project);

		return docs.join("\n\n---\n\n");
	}
}

export const gitManager = new GitManager();
