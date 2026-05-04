// @oscorpex/policy-kit — Sandbox enforcement checks
// Pure enforcement functions extracted from kernel's sandbox-manager.ts.
// No DB dependencies — persistence remains in the kernel layer.

import { realpathSync } from "node:fs";
import { normalize, resolve, sep } from "node:path";
import type { SandboxEnforcementMode, SandboxViolation } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Check results
// ---------------------------------------------------------------------------

export interface CheckResult {
	allowed: boolean;
	reason: string;
}

// ---------------------------------------------------------------------------
// Sandbox policy shape for enforcement (lighter than full SandboxPolicy)
// ---------------------------------------------------------------------------

export interface SandboxEnforcementPolicy {
	allowedTools: string[];
	deniedTools: string[];
	filesystemScope: string[];
	maxOutputSizeBytes: number;
	enforcementMode: SandboxEnforcementMode;
}

// ---------------------------------------------------------------------------
// Pure enforcement functions
// ---------------------------------------------------------------------------

/**
 * Check if a tool is allowed by the sandbox policy.
 */
export function checkToolAllowed(policy: SandboxEnforcementPolicy, toolName: string): CheckResult {
	if (policy.deniedTools.includes(toolName)) {
		return { allowed: false, reason: `Tool "${toolName}" is explicitly denied by sandbox policy` };
	}
	if (policy.allowedTools.length > 0 && !policy.allowedTools.includes(toolName)) {
		return { allowed: false, reason: `Tool "${toolName}" is not in the allowed tools list` };
	}
	return { allowed: true, reason: "allowed" };
}

/**
 * Check if a file path is within the sandbox scope.
 * Uses Node.js path module for canonical resolution.
 */
export function checkPathAllowed(policy: SandboxEnforcementPolicy, filePath: string): CheckResult {
	if (policy.filesystemScope.length === 0) {
		return { allowed: true, reason: "no filesystem scope restriction" };
	}

	// Resolve symlinks to prevent traversal via symlink pointing outside scope
	let canonical: string;
	try {
		canonical = realpathSync(resolve(filePath));
	} catch {
		// Path does not exist yet — fall back to normalize(resolve()) for new file creation
		canonical = normalize(resolve(filePath));
	}

	const withinScope = policy.filesystemScope.some((scope) => {
		let canonicalScope: string;
		try {
			canonicalScope = realpathSync(resolve(scope));
		} catch {
			canonicalScope = normalize(resolve(scope));
		}
		return canonical === canonicalScope || canonical.startsWith(canonicalScope + sep);
	});

	if (!withinScope) {
		return { allowed: false, reason: `Path "${filePath}" (resolved: ${canonical}) is outside sandbox scope` };
	}
	return { allowed: true, reason: "within scope" };
}

/**
 * Check if an output size is within the sandbox limit.
 */
export function checkOutputSize(policy: SandboxEnforcementPolicy, sizeBytes: number): CheckResult {
	if (sizeBytes > policy.maxOutputSizeBytes) {
		return { allowed: false, reason: `Output size (${sizeBytes} bytes) exceeds limit (${policy.maxOutputSizeBytes} bytes)` };
	}
	return { allowed: true, reason: "within limit" };
}

/**
 * Build a default sandbox policy for a project.
 */
export function buildDefaultSandboxPolicy(projectId: string): SandboxEnforcementPolicy {
	return {
		allowedTools: [],
		deniedTools: ["rm_rf", "format_disk", "sudo"],
		filesystemScope: [],
		maxOutputSizeBytes: 10_485_760,
		enforcementMode: "hard" as SandboxEnforcementMode,
	};
}

/**
 * Classify a task as security-sensitive based on its title.
 */
export function isSecurityTask(title: string): boolean {
	return /security|auth|permission|secret/i.test(title);
}

/**
 * Determine if enforcement should block based on mode and violations.
 */
export function shouldEnforce(
	enforcementMode: SandboxEnforcementMode,
	violations: SandboxViolation[],
): { blocked: boolean; violation: SandboxViolation | null } {
	if (enforcementMode === "off") return { blocked: false, violation: null };
	if (enforcementMode === "hard" && violations.length > 0) {
		return { blocked: true, violation: violations[0] };
	}
	// soft mode: log only, don't block
	return { blocked: false, violation: violations.length > 0 ? violations[0] : null };
}