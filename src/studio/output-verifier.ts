// ---------------------------------------------------------------------------
// Oscorpex — Output Verification Gate
// Verifies that execution artifacts actually exist on disk and match claimed output.
// Runs after CLI execution, before task completion.
// ---------------------------------------------------------------------------

import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { execute } from "./pg.js";
import { eventBus } from "./event-bus.js";
import type { TaskOutput } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationType = "files_exist" | "files_modified" | "output_non_empty";

export interface VerificationDetail {
	file?: string;
	expected: string;
	actual: string;
}

export interface VerificationResult {
	type: VerificationType;
	passed: boolean;
	details: VerificationDetail[];
}

export interface OutputVerificationReport {
	taskId: string;
	allPassed: boolean;
	results: VerificationResult[];
}

// ---------------------------------------------------------------------------
// Persistence — store results in verification_results table
// ---------------------------------------------------------------------------

async function persistResult(taskId: string, result: VerificationResult): Promise<void> {
	await execute(
		`INSERT INTO verification_results (id, task_id, verification_type, status, details, created_at)
		 VALUES ($1, $2, $3, $4, $5, now())`,
		[
			randomUUID(),
			taskId,
			result.type,
			result.passed ? "passed" : "failed",
			JSON.stringify(result.details),
		],
	);
}

// ---------------------------------------------------------------------------
// Verification checks
// ---------------------------------------------------------------------------

/** Check that all claimed created files exist on disk */
function verifyFilesExist(repoPath: string, files: string[]): VerificationResult {
	const details: VerificationDetail[] = [];
	let allExist = true;

	for (const file of files) {
		const fullPath = isAbsolute(file) ? file : join(repoPath, file);
		const exists = existsSync(fullPath);
		if (!exists) {
			allExist = false;
			details.push({ file, expected: "exists", actual: "missing" });
		}
	}

	return { type: "files_exist", passed: allExist, details };
}

/** Check that claimed modified files exist and have non-zero size */
function verifyFilesModified(repoPath: string, files: string[]): VerificationResult {
	const details: VerificationDetail[] = [];
	let allValid = true;

	for (const file of files) {
		const fullPath = isAbsolute(file) ? file : join(repoPath, file);
		if (!existsSync(fullPath)) {
			allValid = false;
			details.push({ file, expected: "exists and modified", actual: "missing" });
			continue;
		}
		const stat = statSync(fullPath);
		if (stat.size === 0) {
			allValid = false;
			details.push({ file, expected: "non-empty", actual: "empty (0 bytes)" });
		}
	}

	return { type: "files_modified", passed: allValid, details };
}

/** Check that the output is not completely empty (at least some artifact or log) */
function verifyOutputNonEmpty(output: TaskOutput): VerificationResult {
	const hasFiles = (output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0) > 0;
	const hasLogs = (output.logs?.length ?? 0) > 0;

	if (hasFiles || hasLogs) {
		return { type: "output_non_empty", passed: true, details: [] };
	}

	return {
		type: "output_non_empty",
		passed: false,
		details: [{ expected: "non-empty output", actual: "no files and no logs" }],
	};
}

// ---------------------------------------------------------------------------
// Main verification entry point
// ---------------------------------------------------------------------------

/**
 * Verify execution artifacts before allowing task completion.
 * Returns a report with all verification results.
 * Does NOT throw — caller decides how to handle failures.
 */
export async function verifyTaskOutput(
	taskId: string,
	repoPath: string,
	output: TaskOutput,
): Promise<OutputVerificationReport> {
	const results: VerificationResult[] = [];

	// 1. Verify created files exist
	if (output.filesCreated && output.filesCreated.length > 0) {
		results.push(verifyFilesExist(repoPath, output.filesCreated));
	}

	// 2. Verify modified files exist and are non-empty
	if (output.filesModified && output.filesModified.length > 0) {
		results.push(verifyFilesModified(repoPath, output.filesModified));
	}

	// 3. Verify output is not completely empty
	results.push(verifyOutputNonEmpty(output));

	// Persist all results
	for (const result of results) {
		await persistResult(taskId, result);
	}

	const allPassed = results.every((r) => r.passed);

	// Emit verification event (v7.0 Section 13)
	eventBus.emit({
		projectId: "",
		type: allPassed ? "verification:passed" : "verification:failed",
		taskId,
		payload: {
			allPassed,
			checks: results.length,
			failed: results.filter((r) => !r.passed).map((r) => r.type),
		},
	});

	return { taskId, allPassed, results };
}
