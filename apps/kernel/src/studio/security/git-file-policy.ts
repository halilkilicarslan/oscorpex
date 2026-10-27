// ---------------------------------------------------------------------------
// P3-3: Git/File Policy Enforcement
// Validates git refs for injection attacks and delegates to tool-policy-enforcer.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import { ToolPolicyDeniedError, enforceToolPolicy } from "./tool-policy-enforcer.js";
import { type WorkspaceScope, assertInsideWorkspace } from "./workspace-resolver.js";

const log = createLogger("git-file-policy");

const SHELL_METACHAR = /[;&|`$(){}[\]<>!\\'"]/;

type GitRiskLevel = "read" | "write" | "execute";

const GIT_OP_RISK: Record<string, GitRiskLevel> = {
	status: "read",
	diff: "read",
	log: "read",
	show: "read",
	"branch-list": "read",
	add: "write",
	commit: "write",
	merge: "write",
	rebase: "write",
	tag: "write",
	"branch-create": "write",
	"branch-delete": "write",
	checkout: "write",
	restore: "write",
	"reset-soft": "write",
	"reset-mixed": "write",
	clean: "write",
	"reset-hard": "execute",
	"push-force": "execute",
	"clean-fd": "execute",
};

export interface EnforceGitPolicyOptions {
	operation: string;
	ref?: string;
	source: "user" | "llm" | "provider" | "system";
	actorId: string;
	tenantId: string;
	projectId: string;
}

export function enforceGitPolicy(opts: EnforceGitPolicyOptions): void {
	const risk = GIT_OP_RISK[opts.operation] ?? "write";

	// Validate ref for shell metacharacters
	if (opts.ref && SHELL_METACHAR.test(opts.ref)) {
		log.warn({ operation: opts.operation, ref: opts.ref.slice(0, 40) }, "[git-policy] shell metacharacters in ref");
		throw new ToolPolicyDeniedError({
			decision: "deny",
			reason: `Git ref contains shell metacharacters: ${opts.ref.slice(0, 40)}`,
			code: "GIT_REF_INJECTION",
		} as Extract<import("@oscorpex/policy-kit").ToolPolicyDecision, { decision: "deny" }>);
	}

	// Validate ref for dangerous flags
	if (opts.ref?.startsWith("--")) {
		log.warn({ operation: opts.operation, ref: opts.ref }, "[git-policy] flag-like ref rejected");
		throw new ToolPolicyDeniedError({
			decision: "deny",
			reason: `Git ref looks like a flag: ${opts.ref}`,
			code: "GIT_REF_FLAG_INJECTION",
		} as Extract<import("@oscorpex/policy-kit").ToolPolicyDecision, { decision: "deny" }>);
	}

	enforceToolPolicy({
		request: {
			actorId: opts.actorId,
			tenantId: opts.tenantId,
			projectId: opts.projectId,
			source: opts.source,
			tool: "git",
			action: opts.operation,
			riskLevel: risk,
		},
	});
}

export interface EnforceFilePolicyOptions {
	operation: "read" | "write" | "delete" | "create_dir" | "rename";
	path: string;
	scope: WorkspaceScope;
	source: "user" | "llm" | "provider" | "system";
	actorId: string;
}

export function enforceFilePolicy(opts: EnforceFilePolicyOptions): void {
	// Workspace boundary check — throws WorkspaceViolationError if outside
	assertInsideWorkspace(opts.scope, opts.path);

	const riskLevel: GitRiskLevel =
		opts.operation === "read" ? "read" : opts.operation === "delete" ? "execute" : "write";

	enforceToolPolicy({
		request: {
			actorId: opts.actorId,
			tenantId: opts.scope.tenantId,
			projectId: opts.scope.projectId,
			source: opts.source,
			tool: "file",
			action: opts.operation,
			riskLevel,
			args: { path: opts.path },
		},
	});
}
