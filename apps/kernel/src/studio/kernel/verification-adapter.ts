// @oscorpex/kernel — VerificationRunner adapter
// Implements the VerificationRunner contract from @oscorpex/core.
// Delegates pure checks to @oscorpex/verification-kit; DB/event emission stays here.

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { VerificationInput, VerificationReport, VerificationResult, VerificationRunner } from "@oscorpex/core";
import { runVerificationChecks, verifyOutputNonEmpty } from "@oscorpex/verification-kit";
import { eventBus } from "../event-bus.js";

async function persistResult(taskId: string, result: VerificationResult): Promise<void> {
	// Use db repo to avoid direct pg access
	const { recordVerificationResult } = await import("../db.js");
	await recordVerificationResult({
		taskId,
		verificationType: result.type,
		passed: result.passed,
		details: result.details,
	});
}

class KernelVerificationRunner implements VerificationRunner {
	async verify(input: VerificationInput): Promise<VerificationReport> {
		const { task, repoPath, runId } = input;
		const output = task.output;

		if (!output) {
			return {
				runId,
				taskId: task.id,
				passed: false,
				checks: [],
				createdAt: new Date().toISOString(),
			};
		}

		const checks = runVerificationChecks(repoPath, output, { existsSync, statSync }, { join, isAbsolute });

		// Persist all results to DB (gate binding)
		for (const result of checks) {
			await persistResult(task.id, result);
		}

		const passed = checks.every((r) => r.passed);

		const report: VerificationReport = {
			runId,
			taskId: task.id,
			passed,
			checks,
			createdAt: new Date().toISOString(),
		};

		eventBus.emit({
			projectId: task.projectId,
			type: passed ? "verification:passed" : "verification:failed",
			taskId: task.id,
			payload: { report },
		});

		return report;
	}

	async runChecks(input: VerificationInput): Promise<VerificationResult[]> {
		const { task, repoPath } = input;
		const output = task.output;
		if (!output) return [];

		return runVerificationChecks(repoPath, output, { existsSync, statSync }, { join, isAbsolute });
	}
}

export const verificationRunner = new KernelVerificationRunner();
