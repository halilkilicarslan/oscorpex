// ---------------------------------------------------------------------------
// Oscorpex — Diff Capture (v4.1)
// Captures git diffs for task-modified files after task completion.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { insertTaskDiffs } from "./db.js";
import type { TaskOutput } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileDiff {
	filePath: string;
	diffContent: string;
	diffType: "created" | "modified" | "deleted";
	linesAdded: number;
	linesRemoved: number;
}

// ---------------------------------------------------------------------------
// Parse unified diff stats
// ---------------------------------------------------------------------------

function countDiffLines(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { added, removed };
}

// ---------------------------------------------------------------------------
// Capture diffs for a single file
// ---------------------------------------------------------------------------

function captureFileDiff(repoPath: string, filePath: string, diffType: "created" | "modified"): FileDiff | null {
	try {
		let diff: string;
		if (diffType === "created") {
			// For new files — use execFileSync with array args to prevent command injection
			try {
				diff = execFileSync("git", ["diff", "--no-color", "--", "/dev/null", filePath], {
					cwd: repoPath,
					encoding: "utf-8",
					timeout: 5000,
				}).trim();
			} catch {
				// Fallback: git show
				try {
					diff = execFileSync("git", ["show", `HEAD:${filePath}`], {
						cwd: repoPath,
						encoding: "utf-8",
						timeout: 5000,
					}).trim();
				} catch {
					diff = "";
				}
			}

			if (!diff) {
				// Fallback: just mark as created with no diff content
				return { filePath, diffContent: `+++ ${filePath}\n(new file)`, diffType, linesAdded: 0, linesRemoved: 0 };
			}
		} else {
			// For modified files — array args prevent shell injection via filePath
			diff = execFileSync("git", ["diff", "--no-color", "HEAD", "--", filePath], {
				cwd: repoPath,
				encoding: "utf-8",
				timeout: 5000,
			}).trim();

			if (!diff) {
				// Try staged diff
				diff = execFileSync("git", ["diff", "--no-color", "--cached", "--", filePath], {
					cwd: repoPath,
					encoding: "utf-8",
					timeout: 5000,
				}).trim();
			}
		}

		if (!diff) return null;

		// Truncate very large diffs (>50KB)
		const maxBytes = 50_000;
		if (Buffer.byteLength(diff, "utf-8") > maxBytes) {
			const { added, removed } = countDiffLines(diff);
			diff = diff.slice(0, maxBytes) + `\n... (truncated, ${added} additions, ${removed} deletions total)`;
		}

		const { added, removed } = countDiffLines(diff);
		return { filePath, diffContent: diff, diffType, linesAdded: added, linesRemoved: removed };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Public API: Capture all diffs for a completed task
// ---------------------------------------------------------------------------

export async function captureTaskDiffs(taskId: string, repoPath: string, output: TaskOutput): Promise<number> {
	const diffs: FileDiff[] = [];

	for (const fp of output.filesCreated) {
		const d = captureFileDiff(repoPath, fp, "created");
		if (d) diffs.push(d);
	}

	for (const fp of output.filesModified) {
		const d = captureFileDiff(repoPath, fp, "modified");
		if (d) diffs.push(d);
	}

	if (diffs.length === 0) return 0;

	return insertTaskDiffs(taskId, diffs);
}
