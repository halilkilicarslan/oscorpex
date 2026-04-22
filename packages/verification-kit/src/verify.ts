// @oscorpex/verification-kit — Pure verification logic
// Stateless checks for file existence, file modification, and output non-emptiness.
// No DB or event-bus dependencies — those remain in the kernel's output-verifier.ts.

import type { VerificationStrictness, VerificationType } from "@oscorpex/core";
import type { VerificationDetail, VerificationResult } from "@oscorpex/core";

export type { VerificationStrictness, VerificationType } from "@oscorpex/core";
export type { VerificationDetail, VerificationResult, VerificationReport, GateResult } from "@oscorpex/core";

// Re-export task types needed for verification
export type { TaskOutput } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Pure verification functions (no I/O side effects beyond fs reads)
// ---------------------------------------------------------------------------

/**
 * Check that all claimed created files exist on disk.
 * Returns a VerificationResult with details for each missing file.
 * Pure function — takes repoPath and file list, returns result.
 */
export function verifyFilesExist(
	repoPath: string,
	files: string[],
	existsSync: (path: string) => boolean,
	joinFn: (...paths: string[]) => string,
	isAbsoluteFn: (path: string) => boolean,
): VerificationResult {
	const details: VerificationDetail[] = [];
	let allExist = true;

	for (const file of files) {
		const fullPath = isAbsoluteFn(file) ? file : joinFn(repoPath, file);
		const exists = existsSync(fullPath);
		if (!exists) {
			allExist = false;
			details.push({ file, expected: "exists", actual: "missing" });
		}
	}

	return { type: "files_exist" as VerificationType, passed: allExist, details };
}

/**
 * Check that claimed modified files exist and have non-zero size.
 * Returns a VerificationResult with details for each missing or empty file.
 */
export function verifyFilesModified(
	repoPath: string,
	files: string[],
	existsSync: (path: string) => boolean,
	statSync: (path: string) => { size: number },
	joinFn: (...paths: string[]) => string,
	isAbsoluteFn: (path: string) => boolean,
): VerificationResult {
	const details: VerificationDetail[] = [];
	let allValid = true;

	for (const file of files) {
		const fullPath = isAbsoluteFn(file) ? file : joinFn(repoPath, file);
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

	return { type: "files_modified" as VerificationType, passed: allValid, details };
}

/**
 * Check that the output is not completely empty (at least some artifact or log).
 */
export function verifyOutputNonEmpty(output: {
	filesCreated?: string[];
	filesModified?: string[];
	logs?: string[];
}): VerificationResult {
	const hasFiles = (output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0) > 0;
	const hasLogs = (output.logs?.length ?? 0) > 0;

	if (hasFiles || hasLogs) {
		return { type: "output_non_empty" as VerificationType, passed: true, details: [] };
	}

	return {
		type: "output_non_empty" as VerificationType,
		passed: false,
		details: [{ expected: "non-empty output", actual: "no files and no logs" }],
	};
}

/**
 * Run all verification checks and return results.
 * Pure function — takes pre-bound fs functions for testability.
 */
export function runVerificationChecks(
	repoPath: string,
	output: { filesCreated?: string[]; filesModified?: string[]; logs?: string[] },
	fs: {
		existsSync: (path: string) => boolean;
		statSync: (path: string) => { size: number };
	},
	path: {
		join: (...paths: string[]) => string;
		isAbsolute: (path: string) => boolean;
	},
): VerificationResult[] {
	const results: VerificationResult[] = [];

	if (output.filesCreated && output.filesCreated.length > 0) {
		results.push(verifyFilesExist(repoPath, output.filesCreated, fs.existsSync, path.join, path.isAbsolute));
	}

	if (output.filesModified && output.filesModified.length > 0) {
		results.push(verifyFilesModified(repoPath, output.filesModified, fs.existsSync, fs.statSync, path.join, path.isAbsolute));
	}

	results.push(verifyOutputNonEmpty(output));

	return results;
}

/**
 * Determine whether a verification failure should block task completion.
 * In "strict" mode, all failures are blocking. In "lenient" mode, only
 * empty-output failures are blocking.
 */
export function shouldBlockCompletion(
	results: VerificationResult[],
	strictness: VerificationStrictness,
): { blocked: boolean; failedChecks: string } {
	const failedResults = results.filter((r) => !r.passed);
	if (failedResults.length === 0) return { blocked: false, failedChecks: "" };

	const failedChecks = failedResults
		.map((r) => `${r.type}: ${r.details.map((d) => d.file ?? d.actual).join(", ")}`)
		.join("; ");

	const hasEmptyFail = failedResults.some((r) => r.type === "output_non_empty");
	const hasFileFail = failedResults.some(
		(r) => r.type === "files_exist" || r.type === "files_modified",
	);

	if (hasEmptyFail || (strictness === "strict" && hasFileFail)) {
		return { blocked: true, failedChecks };
	}

	return { blocked: false, failedChecks };
}