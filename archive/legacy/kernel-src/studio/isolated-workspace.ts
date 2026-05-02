// ---------------------------------------------------------------------------
// Oscorpex — Local Workspace Isolation
// Runs task execution in a temporary workspace and writes back only the
// declared file mutations to the source repository.
// ---------------------------------------------------------------------------

import { cp, lstat, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import type { SandboxPolicy } from "./sandbox-manager.js";
import { createLogger } from "./logger.js";
const log = createLogger("isolated-workspace");

const COPY_EXCLUDES = new Set([
	"node_modules",
	"dist",
	"build",
	".next",
	".turbo",
	".voltagent",
	"coverage",
]);

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
	return normalized.length > 0 && !normalized.startsWith("..") && !normalized.includes(`..${"/"}`);
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

				const sourceFile = resolve(workspacePath, file);
				// Strict parent check with separator to prevent prefix bypass
				if (sourceFile !== workspacePath && !sourceFile.startsWith(workspacePath + sep)) continue;

				try {
					// Resolve symlinks to prevent symlink traversal attacks
					const realSource = await realpath(sourceFile);
					if (realSource !== workspacePath && !realSource.startsWith(workspacePath + sep)) continue;

					// Reject symlinks pointing outside workspace
					const fileStat = await lstat(sourceFile);
					if (fileStat.isSymbolicLink()) continue;
				} catch {
					continue;
				}

				const targetFile = resolve(canonicalSourceRepo, file);
				if (targetFile !== canonicalSourceRepo && !targetFile.startsWith(canonicalSourceRepo + sep)) continue;

				await mkdir(dirname(targetFile), { recursive: true });
				await cp(sourceFile, targetFile, { force: true, recursive: false, preserveTimestamps: true });
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
