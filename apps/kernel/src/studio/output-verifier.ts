// ---------------------------------------------------------------------------
// Oscorpex — Artifact Existence Gate (output-verifier)
//
// Scope: Verifies that execution artifacts exist on disk and are non-empty.
// Pure verification logic is in @oscorpex/verification-kit; this module
// handles persistence (DB) and event emission (kernel layer).
// ---------------------------------------------------------------------------

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
	type VerificationResult,
	type VerificationStrictness,
	shouldBlockCompletion,
	verifyFilesExist,
	verifyFilesModified,
	verifyOutputNonEmpty,
} from "@oscorpex/verification-kit";
import { getProjectSetting, recordVerificationResult } from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { TaskOutput } from "./types.js";
const log = createLogger("output-verifier");

// Re-export types and functions from verification-kit for backward compatibility
export type { VerificationStrictness, VerificationType } from "@oscorpex/verification-kit";
export type { VerificationDetail, VerificationResult } from "@oscorpex/verification-kit";

export interface OutputVerificationReport {
	taskId: string;
	allPassed: boolean;
	results: VerificationResult[];
}

// ---------------------------------------------------------------------------
// Persistence — store results in verification_results table
// ---------------------------------------------------------------------------

async function persistResult(taskId: string, result: VerificationResult): Promise<void> {
	await recordVerificationResult({
		taskId,
		verificationType: result.type,
		passed: result.passed,
		details: result.details,
	});
}

// ---------------------------------------------------------------------------
// Main verification entry point
// ---------------------------------------------------------------------------

/**
 * Resolve verification strictness from project settings.
 * Default: "strict" (v8.0 — file existence failures are hard fails).
 */
export async function resolveStrictness(projectId: string): Promise<VerificationStrictness> {
	const setting = await getProjectSetting(projectId, "verification", "strictness");
	if (setting === "lenient") return "lenient";
	return "strict"; // default: strict
}

/**
 * Verify execution artifacts before allowing task completion.
 * Uses pure verification functions from @oscorpex/verification-kit,
 * then persists results to DB and emits verification events.
 * Does NOT throw — caller decides how to handle failures.
 */
export async function verifyTaskOutput(
	taskId: string,
	repoPath: string,
	output: TaskOutput,
	options?: { projectId?: string; strictness?: VerificationStrictness },
): Promise<OutputVerificationReport> {
	const results: VerificationResult[] = [];

	// 1. Verify created files exist
	if (output.filesCreated && output.filesCreated.length > 0) {
		results.push(verifyFilesExist(repoPath, output.filesCreated, existsSync, join, isAbsolute));
	}

	// 2. Verify modified files exist and are non-empty
	if (output.filesModified && output.filesModified.length > 0) {
		results.push(verifyFilesModified(repoPath, output.filesModified, existsSync, statSync, join, isAbsolute));
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
		projectId: options?.projectId ?? taskId,
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
