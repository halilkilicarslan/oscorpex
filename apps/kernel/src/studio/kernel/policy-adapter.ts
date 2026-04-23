// @oscorpex/kernel — PolicyEngine adapter
// Implements the PolicyEngine contract from @oscorpex/core.
// Delegates evaluation to @oscorpex/policy-kit; DB loading + events stay here.

import type { PolicyEngine, PolicyEvaluationInput, PolicyDecision, PolicyAction } from "@oscorpex/core";
import { evaluatePolicyRules, parsePolicies } from "@oscorpex/policy-kit";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";

const log = createLogger("policy-adapter");

class KernelPolicyEngine implements PolicyEngine {
	async evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision> {
		const { run, task } = input;
		const projectId = run.projectId;

		if (!task) {
			return {
				runId: run.id,
				action: "allow",
				reasons: ["No task provided — default allow"],
				policyVersion: "1.0",
				createdAt: new Date().toISOString(),
			};
		}

		const { getProjectSettingsMap } = await import("../db.js");
		const settingsMap = await getProjectSettingsMap(projectId);
		const raw = settingsMap["policy"]?.["rules"];
		const customRules = parsePolicies(raw);

		const result = evaluatePolicyRules(
			task as any,
			settingsMap as Record<string, Record<string, string>>,
			customRules,
		);

		let action: PolicyAction = "allow";
		if (!result.allowed) action = "block";
		else if (result.blocked) action = "require_approval";
		else if (result.violations.length > 0) action = "warn";

		if (result.violations.length > 0) {
			eventBus.emit({
				projectId,
				type: "policy:violation",
				taskId: task.id,
				payload: {
					taskTitle: task.title,
					violations: result.violations,
					blocked: result.blocked,
					evaluatedAt: new Date().toISOString(),
				},
			});
		}

		return {
			runId: run.id,
			taskId: task.id,
			action,
			reasons: result.violations,
			policyVersion: "1.0",
			createdAt: new Date().toISOString(),
		};
	}
}

export const policyEngine = new KernelPolicyEngine();