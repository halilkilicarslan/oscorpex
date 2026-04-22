// @oscorpex/core — VerificationRunner contract
// Interface for running verification gates against task outputs.

import type {
	VerificationInput,
	VerificationReport,
	VerificationResult,
} from "../domain/verification.js";

export interface VerificationRunner {
	verify(input: VerificationInput): Promise<VerificationReport>;
	runChecks(input: VerificationInput): Promise<VerificationResult[]>;
}