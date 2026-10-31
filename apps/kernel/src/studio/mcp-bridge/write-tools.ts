// ---------------------------------------------------------------------------
// P6-D, P6-E, P6-F, P6-G: MCP Write Tool Handlers
//
// Write tools validate input and workspace constraints, then return a
// "requires approval" payload. Actual execution happens in a separate
// approval-confirmed flow (not in this module).
// ---------------------------------------------------------------------------

import { z } from "zod";
import { createLogger } from "../logger.js";
import { assertInsideWorkspace, resolveWorkspacePath } from "../security/workspace-resolver.js";
import type { McpToolHandler } from "./types.js";
import { registerWriteTool } from "./write-tool-registry.js";
import type { McpWriteToolDefinition } from "./write-tool-registry.js";

const log = createLogger("mcp-write-tools");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const FileWriteSchema = z
	.object({
		path: z.string().min(1).max(500),
		content: z.string().max(200_000),
		mode: z.enum(["create", "overwrite"]).default("create"),
	})
	.strict();

const DocsGenerateSchema = z
	.object({
		type: z.enum(["readme", "changelog", "api-docs"]),
		projectId: z.string().min(1),
	})
	.strict();

const TaskCommentSchema = z
	.object({
		taskId: z.string().min(1),
		comment: z.string().min(1).max(5000),
	})
	.strict();

const TaskUpdateMetadataSchema = z
	.object({
		taskId: z.string().min(1),
		metadata: z.record(z.string().max(100), z.unknown()),
	})
	.strict();

const GitCreateBranchSchema = z
	.object({
		branchName: z.string().min(1).max(100),
		fromRef: z.string().max(100).optional(),
	})
	.strict();

// ---------------------------------------------------------------------------
// Branch name validation — only safe characters, no shell metacharacters
// ---------------------------------------------------------------------------

/** Allowlist: alphanumeric plus `/`, `_`, `.`, `-`. Must start and end with alphanumeric. */
const SAFE_BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9\/_.-]{0,98}[a-zA-Z0-9]$/;

const FORBIDDEN_BRANCH_PATTERNS: ReadonlyArray<RegExp> = [
	/\.\./, // path traversal
	/^-/, // flag injection (leading dash)
	/--/, // double dash (option separator)
	/[;&|`$(){}[\]<>!\\'"]/, // shell metacharacters
	/\s/, // whitespace
];

function validateBranchName(name: string): { valid: boolean; reason?: string } {
	if (!SAFE_BRANCH_RE.test(name)) {
		return { valid: false, reason: "Branch name contains invalid characters or format" };
	}
	for (const pattern of FORBIDDEN_BRANCH_PATTERNS) {
		if (pattern.test(name)) {
			return { valid: false, reason: `Branch name contains forbidden pattern: ${pattern.source}` };
		}
	}
	return { valid: true };
}

// ---------------------------------------------------------------------------
// Helper — format zod issues into a single readable string
// ---------------------------------------------------------------------------

function formatZodIssues(issues: z.ZodIssue[]): string {
	return issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
}

// ---------------------------------------------------------------------------
// P6-D: file.write
// ---------------------------------------------------------------------------

export const fileWrite: McpToolHandler = async (inv) => {
	const parsed = FileWriteSchema.safeParse(inv.args);
	if (!parsed.success) {
		return {
			ok: false,
			error: { code: "INVALID_INPUT", message: formatZodIssues(parsed.error.issues) },
		};
	}

	const { path, content, mode } = parsed.data;
	const scope = { tenantId: inv.tenantId, projectId: inv.projectId };

	// Workspace path resolution + scope assertion
	let fullPath: string;
	try {
		fullPath = resolveWorkspacePath(scope, path);
		assertInsideWorkspace(scope, fullPath);
	} catch (err) {
		log.warn({ err, path }, "[mcp-write-tools] file.write workspace violation");
		return {
			ok: false,
			error: {
				code: "WORKSPACE_VIOLATION",
				message: err instanceof Error ? err.message : String(err),
			},
		};
	}

	// Mode guard — "create" must not overwrite an existing file
	if (mode === "create") {
		const { existsSync } = await import("node:fs");
		if (existsSync(fullPath)) {
			return {
				ok: false,
				error: {
					code: "FILE_EXISTS",
					message: `File already exists: ${path}. Use mode "overwrite" to replace it.`,
				},
			};
		}
	}

	log.info({ path, mode, contentLength: content.length }, "[mcp-write-tools] file.write validated");

	return {
		ok: true,
		data: {
			action: "file.write",
			path,
			contentLength: content.length,
			mode,
			message: "File write validated. Requires approval to execute.",
		},
	};
};

// ---------------------------------------------------------------------------
// P6-E: docs.generate
// ---------------------------------------------------------------------------

export const docsGenerate: McpToolHandler = async (inv) => {
	const parsed = DocsGenerateSchema.safeParse(inv.args);
	if (!parsed.success) {
		return {
			ok: false,
			error: { code: "INVALID_INPUT", message: formatZodIssues(parsed.error.issues) },
		};
	}

	log.info({ type: parsed.data.type, projectId: parsed.data.projectId }, "[mcp-write-tools] docs.generate validated");

	return {
		ok: true,
		data: {
			action: "docs.generate",
			type: parsed.data.type,
			projectId: parsed.data.projectId,
			message: "Documentation generation validated. Requires approval to execute.",
		},
	};
};

// ---------------------------------------------------------------------------
// P6-F: task.comment
// ---------------------------------------------------------------------------

export const taskComment: McpToolHandler = async (inv) => {
	const parsed = TaskCommentSchema.safeParse(inv.args);
	if (!parsed.success) {
		return {
			ok: false,
			error: { code: "INVALID_INPUT", message: formatZodIssues(parsed.error.issues) },
		};
	}

	log.info(
		{ taskId: parsed.data.taskId, commentLength: parsed.data.comment.length },
		"[mcp-write-tools] task.comment validated",
	);

	return {
		ok: true,
		data: {
			action: "task.comment",
			taskId: parsed.data.taskId,
			commentLength: parsed.data.comment.length,
			message: "Task comment validated. Requires approval to execute.",
		},
	};
};

// ---------------------------------------------------------------------------
// P6-F: task.updateMetadata
// ---------------------------------------------------------------------------

export const taskUpdateMetadata: McpToolHandler = async (inv) => {
	const parsed = TaskUpdateMetadataSchema.safeParse(inv.args);
	if (!parsed.success) {
		return {
			ok: false,
			error: { code: "INVALID_INPUT", message: formatZodIssues(parsed.error.issues) },
		};
	}

	const metadataKeys = Object.keys(parsed.data.metadata);
	log.info({ taskId: parsed.data.taskId, metadataKeys }, "[mcp-write-tools] task.updateMetadata validated");

	return {
		ok: true,
		data: {
			action: "task.updateMetadata",
			taskId: parsed.data.taskId,
			metadataKeys,
			message: "Task metadata update validated. Requires approval to execute.",
		},
	};
};

// ---------------------------------------------------------------------------
// P6-G: git.createBranch
// ---------------------------------------------------------------------------

export const gitCreateBranch: McpToolHandler = async (inv) => {
	const parsed = GitCreateBranchSchema.safeParse(inv.args);
	if (!parsed.success) {
		return {
			ok: false,
			error: { code: "INVALID_INPUT", message: formatZodIssues(parsed.error.issues) },
		};
	}

	const branchValidation = validateBranchName(parsed.data.branchName);
	if (!branchValidation.valid) {
		return {
			ok: false,
			error: { code: "INVALID_BRANCH_NAME", message: branchValidation.reason! },
		};
	}

	const fromRef = parsed.data.fromRef ?? "HEAD";
	log.info({ branchName: parsed.data.branchName, fromRef }, "[mcp-write-tools] git.createBranch validated");

	return {
		ok: true,
		data: {
			action: "git.createBranch",
			branchName: parsed.data.branchName,
			fromRef,
			message: "Branch creation validated. Requires approval to execute.",
		},
	};
};

// ---------------------------------------------------------------------------
// Registration helper — call once during bridge initialisation
// ---------------------------------------------------------------------------

const WRITE_TOOL_DEFINITIONS = [
	{
		def: {
			name: "file.write",
			description: "Write a file to workspace",
			riskLevel: "write",
			requiresApproval: true,
			requiresCheckpoint: true,
			supportsRollbackDryRun: true,
		} satisfies McpWriteToolDefinition,
		handler: fileWrite,
	},
	{
		def: {
			name: "docs.generate",
			description: "Generate project documentation",
			riskLevel: "write",
			requiresApproval: true,
			requiresCheckpoint: true,
			supportsRollbackDryRun: true,
		} satisfies McpWriteToolDefinition,
		handler: docsGenerate,
	},
	{
		def: {
			name: "task.comment",
			description: "Add a comment to a task",
			riskLevel: "write",
			requiresApproval: true,
			requiresCheckpoint: true,
			supportsRollbackDryRun: true,
		} satisfies McpWriteToolDefinition,
		handler: taskComment,
	},
	{
		def: {
			name: "task.updateMetadata",
			description: "Update task metadata fields",
			riskLevel: "write",
			requiresApproval: true,
			requiresCheckpoint: true,
			supportsRollbackDryRun: true,
		} satisfies McpWriteToolDefinition,
		handler: taskUpdateMetadata,
	},
	{
		def: {
			name: "git.createBranch",
			description: "Create a new git branch",
			riskLevel: "write",
			requiresApproval: true,
			requiresCheckpoint: true,
			supportsRollbackDryRun: true,
		} satisfies McpWriteToolDefinition,
		handler: gitCreateBranch,
	},
] as const;

export function registerAllWriteTools(): void {
	for (const { def, handler } of WRITE_TOOL_DEFINITIONS) {
		registerWriteTool(def, handler);
	}
}
