// ---------------------------------------------------------------------------
// P1-6: Zod Validation Schemas — critical mutation endpoints
// ---------------------------------------------------------------------------

import { z } from "zod";

// Project schemas
export const UpdateProjectSchema = z
	.object({
		name: z.string().min(1).max(120).optional(),
		description: z.string().max(5000).optional(),
		techStack: z.array(z.string().max(80)).max(20).optional(),
	})
	.strict();

export const CreateProjectSchema = z
	.object({
		name: z.string().min(1).max(120),
		description: z.string().max(5000).optional(),
		techStack: z.array(z.string().max(80)).max(20).optional(),
		template: z.string().max(80).optional(),
	})
	.strict();

// Agent schemas — includes all DB-required optional fields for createAgentConfig
export const CreateAgentSchema = z
	.object({
		name: z.string().min(1).max(80),
		role: z.string().min(1).max(40),
		model: z.string().max(80).optional(),
		systemPrompt: z.string().max(10000).optional(),
		capabilities: z.array(z.string().max(80)).max(20).optional(),
		avatar: z.string().max(200).optional(),
		gender: z.string().max(20).optional(),
		personality: z.string().max(200).optional(),
		cliTool: z.string().max(80).optional(),
		skills: z.array(z.string().max(200)).max(50).optional(),
		// Reaches the route's permission check (platform:admin only) instead of failing with 400
		isPreset: z.boolean().optional(),
	})
	.strict();

/** PUT /agents/:id — same fields and size limits as creation, all optional, unknown keys rejected. */
export const UpdateAgentConfigSchema = CreateAgentSchema.partial().strict();

export const UpdateAgentSchema = z
	.object({
		name: z.string().min(1).max(80).optional(),
		role: z.string().min(1).max(40).optional(),
		model: z.string().max(80).optional(),
		systemPrompt: z.string().max(10000).optional(),
		capabilities: z.array(z.string().max(80)).max(20).optional(),
	})
	.strict();

// Webhook schema
export const CreateWebhookSchema = z
	.object({
		url: z.string().url().max(2000),
		events: z.array(z.string().max(80)).min(1).max(50),
		secret: z.string().max(200).optional(),
	})
	.strict();

// ---------------------------------------------------------------------------
// P2-4: Extended schemas for high-risk mutation routes
// ---------------------------------------------------------------------------

// Approval schemas
// The decision is implied by the route (/approve or /reject); clients send no `decision` field.
export const ApprovalDecisionSchema = z
	.object({
		comment: z.string().max(2000).optional(),
		reason: z.string().max(2000).optional(),
		metadata: z
			.record(z.string(), z.unknown())
			.refine((m) => JSON.stringify(m).length <= 10_000, "metadata must be at most 10KB")
			.optional(),
		artifactIds: z.array(z.string().min(1).max(200)).max(100).optional(),
	})
	.strict();

export const ApprovalRequestSchema = z
	.object({
		taskId: z.string().uuid().optional(),
		type: z.string().max(80).optional(),
		description: z.string().max(5000).optional(),
	})
	.strict();

// Settings schema
export const UpdateSettingsSchema = z
	.object({
		key: z.string().min(1).max(120),
		value: z.unknown(),
	})
	.strict();

// Skill schemas
export const CreateSkillSchema = z
	.object({
		name: z.string().min(1).max(120),
		contentMd: z.string().max(50000),
		triggers: z.array(z.string().max(200)).max(20).optional(),
		applicableRoles: z.array(z.string().max(40)).max(12).optional(),
		category: z.string().max(80).optional(),
		providerHint: z.string().max(80).optional(),
		modelHint: z.string().max(80).optional(),
		maxTokenBudget: z.number().int().min(100).max(100000).optional(),
		isGlobal: z.boolean().optional(),
	})
	.strict();

export const UpdateSkillSchema = z
	.object({
		name: z.string().min(1).max(120).optional(),
		contentMd: z.string().max(50000).optional(),
		triggers: z.array(z.string().max(200)).max(20).optional(),
		applicableRoles: z.array(z.string().max(40)).max(12).optional(),
		category: z.string().max(80).optional(),
		providerHint: z.string().max(80).optional(),
		modelHint: z.string().max(80).optional(),
		maxTokenBudget: z.number().int().min(100).max(100000).optional(),
		isGlobal: z.boolean().optional(),
	})
	.strict();

// Task mutation schema
export const UpdateTaskSchema = z
	.object({
		status: z
			.enum(["queued", "assigned", "running", "done", "failed", "review", "revision", "blocked", "deferred"])
			.optional(),
		assignedAgent: z.string().max(80).optional(),
		priority: z.number().int().min(0).max(100).optional(),
		description: z.string().max(10000).optional(),
	})
	.strict();

// Provider configuration schema
export const UpdateProviderSchema = z
	.object({
		enabled: z.boolean().optional(),
		priority: z.number().int().min(0).max(100).optional(),
		config: z.record(z.string().max(80), z.unknown()).optional(),
	})
	.strict();

// Integration/webhook mutation
export const UpdateWebhookSchema = z
	.object({
		url: z.string().url().max(2000).optional(),
		events: z.array(z.string().max(80)).min(1).max(50).optional(),
		enabled: z.boolean().optional(),
	})
	.strict();

// Template schema
export const CreateTemplateSchema = z
	.object({
		name: z.string().min(1).max(120),
		description: z.string().max(5000).optional(),
		category: z.string().max(80).optional(),
		config: z.record(z.string(), z.unknown()).optional(),
		techStack: z.array(z.string().max(80)).max(50).optional(),
		agentConfig: z.record(z.string(), z.unknown()).optional(),
		phases: z.array(z.unknown()).max(100).optional(),
		// isPublic is platform-admin only (checked in the route); authorId is accepted but ignored (caller is the author)
		isPublic: z.boolean().optional(),
		authorId: z.string().max(200).nullable().optional(),
	})
	.strict();

const TEMPLATE_JSON_MAX_BYTES = 256 * 1024;
const TEMPLATE_JSON_MAX_DEPTH = 12;
const TEMPLATE_PHASES_MAX = 100;

function jsonDepthExceeds(value: unknown, maxDepth: number): boolean {
	const stack: Array<[unknown, number]> = [[value, 1]];
	while (stack.length > 0) {
		const [v, depth] = stack.pop() as [unknown, number];
		if (typeof v !== "object" || v === null) continue;
		if (depth > maxDepth) return true;
		for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth + 1]);
	}
	return false;
}

/** Size / depth / count limits for the free-form template fields (agentConfig, phases). Returns an error message or null. */
export function validateTemplateJsonFields(body: { agentConfig?: unknown; phases?: unknown }): string | null {
	if (body.phases !== undefined) {
		if (!Array.isArray(body.phases)) return "phases must be an array";
		if (body.phases.length > TEMPLATE_PHASES_MAX) return `phases: at most ${TEMPLATE_PHASES_MAX} entries`;
	}
	for (const key of ["agentConfig", "phases"] as const) {
		const value = body[key];
		if (value === undefined) continue;
		if (key === "agentConfig" && (typeof value !== "object" || value === null || Array.isArray(value))) {
			return "agentConfig must be an object";
		}
		if (jsonDepthExceeds(value, TEMPLATE_JSON_MAX_DEPTH)) return `${key}: nesting too deep`;
		if (JSON.stringify(value).length > TEMPLATE_JSON_MAX_BYTES) return `${key}: payload too large`;
	}
	return null;
}

// Plugin schema
export const UpdatePluginSchema = z
	.object({
		enabled: z.boolean().optional(),
		configJson: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

/** Parse and validate request body, return 400 on failure */
export function parseBody<T>(
	schema: z.ZodType<T>,
	body: unknown,
): { success: true; data: T } | { success: false; error: string } {
	const result = schema.safeParse(body);
	if (!result.success) {
		return {
			success: false,
			error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
		};
	}
	return { success: true, data: result.data };
}
