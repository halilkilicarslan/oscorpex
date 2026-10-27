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
	})
	.strict();

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
export const ApprovalDecisionSchema = z
	.object({
		decision: z.enum(["approved", "rejected"]),
		comment: z.string().max(2000).optional(),
		reason: z.string().max(2000).optional(),
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
	})
	.strict();

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
