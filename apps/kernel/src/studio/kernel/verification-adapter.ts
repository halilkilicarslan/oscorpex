// @oscorpex/kernel — VerificationRunner adapter
// Implements the VerificationRunner contract from @oscorpex/core.
// Delegates pure checks to @oscorpex/verification-kit; DB/event emission stays here.

import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { VerificationInput, VerificationReport, VerificationResult, VerificationRunner } from "@oscorpex/core";
import { runVerificationChecks, verifyOutputNonEmpty } from "@oscorpex/verification-kit";
import { eventBus } from "../event-bus.js";
import { execute } from "../pg.js";

async function persistResult(taskId: string, result: VerificationResult): Promise<void> {
	await execute(
		`INSERT INTO verification_results (id, task_id, verification_type, status, details, created_at)
		 VALUES ($1, $2, $3, $4, $5, now())`,
		[randomUUID(), taskId, result.type, result.passed ? "passed" : "failed", JSON.stringify(result.details)],
	);
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
