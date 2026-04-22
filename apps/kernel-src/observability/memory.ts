// ---------------------------------------------------------------------------
// Observability — Memory API (VoltAgent memory tables)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { execute, query, queryOne } from "../studio/pg.js";
import { safeParseJSON } from "./_shared.js";

interface MemoryConversation {
	id: string;
	resource_id: string;
	user_id: string;
	title: string;
	metadata: string;
	created_at: string;
	updated_at: string;
	message_count?: number;
	last_message_at?: string | null;
}

interface MemoryMessage {
	conversation_id: string;
	message_id: string;
	user_id: string;
	role: string;
	parts: string;
	metadata: string | null;
	format_version: number;
	created_at: string;
}

interface MemoryStep {
	id: string;
	conversation_id: string;
	user_id: string;
	agent_id: string;
	agent_name: string | null;
	operation_id: string | null;
	step_index: number;
	type: string;
	role: string;
	content: string | null;
	arguments: string | null;
	result: string | null;
	usage: string | null;
	sub_agent_id: string | null;
	sub_agent_name: string | null;
	created_at: string;
}

interface WorkflowState {
	id: string;
	workflow_id: string;
	workflow_name: string;
	status: string;
	input: string | null;
	context: string | null;
	workflow_state: string | null;
	suspension: string | null;
	events: string | null;
	output: string | null;
	cancellation: string | null;
	user_id: string | null;
	conversation_id: string | null;
	metadata: string | null;
	created_at: string;
	updated_at: string;
}

export const memoryRoutes = new Hono();

// GET /api/observability/memory/stats
memoryRoutes.get("/memory/stats", async (c) => {
	const [convRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM voltagent_memory_conversations");
	const totalConversations = Number(convRow?.n ?? 0);

	const [msgRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM voltagent_memory_messages");
	const totalMessages = Number(msgRow?.n ?? 0);

	const [stepRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM voltagent_memory_steps");
	const totalSteps = Number(stepRow?.n ?? 0);

	const [wfRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM voltagent_memory_workflow_states");
	const totalWorkflows = Number(wfRow?.n ?? 0);

	const byAgent = await query<{
		name: string;
		conversations: number;
		messages: number;
	}>(
		`SELECT
      c.resource_id as name,
      COUNT(DISTINCT c.id) as conversations,
      COUNT(m.message_id) as messages
    FROM voltagent_memory_conversations c
    LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
    GROUP BY c.resource_id
    ORDER BY conversations DESC`,
	);

	return c.json({
		totalConversations,
		totalMessages,
		totalSteps,
		byAgent,
		totalWorkflows,
	});
});

// GET /api/observability/memory/conversations
memoryRoutes.get("/memory/conversations", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const agent = c.req.query("agent");

	let rowSql: string;
	let countSql: string;
	let rowParams: unknown[];
	let countParams: unknown[];

	if (agent) {
		rowSql = `SELECT
      c.*,
      COUNT(m.message_id) as message_count,
      MAX(m.created_at) as last_message_at
    FROM voltagent_memory_conversations c
    LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
    WHERE c.resource_id = $1
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT $2 OFFSET $3`;
		rowParams = [agent, limit, offset];

		countSql = "SELECT COUNT(*) as n FROM voltagent_memory_conversations c WHERE c.resource_id = $1";
		countParams = [agent];
	} else {
		rowSql = `SELECT
      c.*,
      COUNT(m.message_id) as message_count,
      MAX(m.created_at) as last_message_at
    FROM voltagent_memory_conversations c
    LEFT JOIN voltagent_memory_messages m ON m.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT $1 OFFSET $2`;
		rowParams = [limit, offset];

		countSql = "SELECT COUNT(*) as n FROM voltagent_memory_conversations c";
		countParams = [];
	}

	const rows = await query<MemoryConversation>(rowSql, rowParams);
	const [countRow] = await query<{ n: string }>(countSql, countParams);
	const total = Number(countRow?.n ?? 0);

	const conversations = rows.map((r) => ({
		...r,
		metadata: safeParseJSON(r.metadata),
	}));

	return c.json({ conversations, total });
});

// GET /api/observability/memory/conversations/:id
memoryRoutes.get("/memory/conversations/:id", async (c) => {
	const id = c.req.param("id");

	const conversation = await queryOne<MemoryConversation>(
		"SELECT * FROM voltagent_memory_conversations WHERE id = $1",
		[id],
	);

	if (!conversation) {
		return c.json({ error: "Not found" }, 404);
	}

	const messages = await query<MemoryMessage>(
		"SELECT * FROM voltagent_memory_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
		[id],
	);

	const steps = await query<MemoryStep>(
		"SELECT * FROM voltagent_memory_steps WHERE conversation_id = $1 ORDER BY step_index ASC, created_at ASC",
		[id],
	);

	return c.json({
		conversation: {
			...conversation,
			metadata: safeParseJSON(conversation.metadata),
		},
		messages: messages.map((m) => ({
			...m,
			parts: safeParseJSON(m.parts),
			metadata: m.metadata ? safeParseJSON(m.metadata) : null,
		})),
		steps: steps.map((s) => ({
			...s,
			arguments: s.arguments ? safeParseJSON(s.arguments) : null,
			result: s.result ? safeParseJSON(s.result) : null,
			usage: s.usage ? safeParseJSON(s.usage) : null,
		})),
	});
});

// GET /api/observability/memory/conversations/:id/messages
memoryRoutes.get("/memory/conversations/:id/messages", async (c) => {
	const id = c.req.param("id");

	const messages = await query<MemoryMessage>(
		"SELECT * FROM voltagent_memory_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
		[id],
	);

	return c.json({
		messages: messages.map((m) => ({
			...m,
			parts: safeParseJSON(m.parts),
			metadata: m.metadata ? safeParseJSON(m.metadata) : null,
		})),
	});
});

// GET /api/observability/memory/workflows
memoryRoutes.get("/memory/workflows", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const status = c.req.query("status");

	let rowSql: string;
	let countSql: string;
	let rowParams: unknown[];
	let countParams: unknown[];

	if (status) {
		rowSql =
			"SELECT * FROM voltagent_memory_workflow_states WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3";
		rowParams = [status, limit, offset];
		countSql = "SELECT COUNT(*) as n FROM voltagent_memory_workflow_states WHERE status = $1";
		countParams = [status];
	} else {
		rowSql = "SELECT * FROM voltagent_memory_workflow_states ORDER BY created_at DESC LIMIT $1 OFFSET $2";
		rowParams = [limit, offset];
		countSql = "SELECT COUNT(*) as n FROM voltagent_memory_workflow_states";
		countParams = [];
	}

	const rows = await query<WorkflowState>(rowSql, rowParams);
	const [countRow] = await query<{ n: string }>(countSql, countParams);
	const total = Number(countRow?.n ?? 0);

	const workflows = rows.map((w) => ({
		...w,
		input: w.input ? safeParseJSON(w.input) : null,
		output: w.output ? safeParseJSON(w.output) : null,
		events: w.events ? safeParseJSON(w.events) : null,
		context: w.context ? safeParseJSON(w.context) : null,
		metadata: w.metadata ? safeParseJSON(w.metadata) : null,
	}));

	return c.json({ workflows, total });
});

// DELETE /api/observability/memory/conversations/:id
memoryRoutes.delete("/memory/conversations/:id", async (c) => {
	const id = c.req.param("id");

	const existing = await queryOne<{ id: string }>("SELECT id FROM voltagent_memory_conversations WHERE id = $1", [id]);

	if (!existing) {
		return c.json({ error: "Not found" }, 404);
	}

	// Cascade delete steps and messages manually in case FK is not enforced
	await execute("DELETE FROM voltagent_memory_steps WHERE conversation_id = $1", [id]);
	await execute("DELETE FROM voltagent_memory_messages WHERE conversation_id = $1", [id]);
	await execute("DELETE FROM voltagent_memory_conversations WHERE id = $1", [id]);

	return c.json({ success: true });
});
