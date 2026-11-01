// ---------------------------------------------------------------------------
// Oscorpex — Local Workspace Isolation
// Runs task execution in a temporary workspace and writes back only the
// declared file mutations to the source repository.
// ---------------------------------------------------------------------------

import { cp, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { createLogger } from "./logger.js";
import type { SandboxPolicy } from "./sandbox-manager.js";
import { readContainedFile, writeContainedFile } from "./security/contained-fs.js";
const log = createLogger("isolated-workspace");

const COPY_EXCLUDES = new Set(["node_modules", "dist", "build", ".next", ".turbo", ".oscorpex", "coverage"]);

export interface IsolatedWorkspace {
	readonly isolated: boolean;
	readonly repoPath: string;
	writeBack(files: string[]): Promise<string[]>;
	cleanup(): Promise<void>;
}

function isIsolationEnabled(policy: SandboxPolicy | undefined): boolean {
	if (!policy) return false;
	return policy.isolationLevel !== "none";
}

function isSafeRelativePath(filePath: string): boolean {
	const normalized = normalize(filePath);
	if (
		normalized.length === 0 ||
		isAbsolute(normalized) ||
		normalized.startsWith("..") ||
		normalized.includes(`..${"/"}`)
	) {
		return false;
	}
	// Never write into any `.git` directory (config/hooks of the source repo would run as the kernel); any case
	return !normalized.split(/[\\/]+/).some((segment) => segment.toLowerCase() === ".git");
}

async function copySourceRepo(sourceRepoPath: string, workspacePath: string): Promise<void> {
	await cp(sourceRepoPath, workspacePath, {
		recursive: true,
		preserveTimestamps: true,
		filter: (source) => {
			const name = source.split("/").pop() ?? "";
			return !COPY_EXCLUDES.has(name);
		},
	});
}

export async function prepareIsolatedWorkspace(
	sourceRepoPath: string | undefined,
	taskId: string,
	policy?: SandboxPolicy,
): Promise<IsolatedWorkspace> {
	if (!sourceRepoPath || !isIsolationEnabled(policy)) {
		return {
			isolated: false,
			repoPath: sourceRepoPath ?? "",
			writeBack: async () => [],
			cleanup: async () => {},
		};
	}

	try {
		await stat(sourceRepoPath);
	} catch {
		return {
			isolated: false,
			repoPath: sourceRepoPath,
			writeBack: async () => [],
			cleanup: async () => {},
		};
	}

	// Resolve canonical paths to prevent symlink issues (e.g. macOS /tmp → /private/tmp)
	const canonicalSourceRepo = await realpath(sourceRepoPath);
	const workspaceRootRaw = await mkdtemp(join(tmpdir(), `oscorpex-task-${taskId}-`));
	const workspaceRoot = await realpath(workspaceRootRaw);
	const workspacePath = join(workspaceRoot, "workspace");
	await mkdir(workspacePath, { recursive: true });
	await copySourceRepo(sourceRepoPath, workspacePath);

	return {
		isolated: true,
		repoPath: workspacePath,
		writeBack: async (files: string[]) => {
			const synced: string[] = [];
			const unique = Array.from(new Set(files.filter(Boolean)));

			for (const file of unique) {
				if (!isSafeRelativePath(file)) continue;

				try {
					// O_NOFOLLOW + descriptor check: a symlink (or redirected directory) swapped in after any check
					// is refused before a byte is read
					const { data, mode } = await readContainedFile(workspacePath, file);
					// The destination is verified the same way; directories are only created after the check
					await writeContainedFile(canonicalSourceRepo, file, data, { mkdirs: true, mode, applyMode: true });
				} catch (err) {
					log.warn({ err, file }, "[isolated-workspace] write-back skipped a file");
					continue;
				}
				synced.push(file);
			}

			return synced;
		},
		cleanup: async () => {
			await rm(workspaceRoot, { recursive: true, force: true });
		},
	};
}

export const __testables = {
	isSafeRelativePath,
};
