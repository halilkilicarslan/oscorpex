// ---------------------------------------------------------------------------
// Observability — Triggers + Trigger Logs
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { execute, query, queryOne } from "../studio/pg.js";

interface TriggerRow {
	id: string;
	name: string;
	description: string;
	type: string;
	config: string;
	action: string;
	enabled: number;
	last_fired_at: string | null;
	fire_count: number;
	created_at: string;
	updated_at: string;
}

interface TriggerLogRow {
	id: string;
	trigger_id: string;
	status: string;
	input: string | null;
	output: string | null;
	duration_ms: number | null;
	fired_at: string;
}

function parseTriggerRow(row: TriggerRow) {
	return {
		...row,
		enabled: Boolean(row.enabled),
		config: (() => {
			try {
				return JSON.parse(row.config);
			} catch {
				return {};
			}
		})(),
		action: (() => {
			try {
				return JSON.parse(row.action);
			} catch {
				return {};
			}
		})(),
	};
}

function parseTriggerLogRow(row: TriggerLogRow) {
	return {
		...row,
		input: row.input
			? (() => {
					const val = row.input;
					try {
						return JSON.parse(val);
					} catch {
						return val;
					}
				})()
			: null,
		output: row.output
			? (() => {
					const val = row.output;
					try {
						return JSON.parse(val);
					} catch {
						return val;
					}
				})()
			: null,
	};
}

export const triggersRoutes = new Hono();

// GET /api/observability/triggers/stats — MUST be before /:id
triggersRoutes.get("/triggers/stats", async (c) => {
	const [totalRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM triggers");
	const total = Number(totalRow?.n ?? 0);

	const [activeRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM triggers WHERE enabled = 1");
	const active = Number(activeRow?.n ?? 0);

	const [firesRow] = await query<{ n: string }>("SELECT COALESCE(SUM(fire_count), 0) as n FROM triggers");
	const totalFires = Number(firesRow?.n ?? 0);

	const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const [recentRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM trigger_logs WHERE fired_at >= $1", [
		recentCutoff,
	]);
	const recentFires24h = Number(recentRow?.n ?? 0);

	const byTypeRows = await query<{ type: string; cnt: string }>(
		"SELECT type, COUNT(*) as cnt FROM triggers GROUP BY type",
	);
	const byType: Record<string, number> = {
		webhook: 0,
		schedule: 0,
		event: 0,
		condition: 0,
	};
	for (const r of byTypeRows) byType[r.type] = Number(r.cnt);

	return c.json({ total, active, totalFires, recentFires24h, byType });
});

// GET /api/observability/triggers
triggersRoutes.get("/triggers", async (c) => {
	const rows = await query<TriggerRow>("SELECT * FROM triggers ORDER BY created_at DESC");
	return c.json({ triggers: rows.map(parseTriggerRow) });
});

// POST /api/observability/triggers
triggersRoutes.post("/triggers", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		description?: string;
		type: string;
		config: Record<string, unknown>;
		action: Record<string, unknown>;
		enabled?: boolean;
	};

	if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
	if (!body.type) return c.json({ error: "type is required" }, 400);
	if (!body.config) return c.json({ error: "config is required" }, 400);
	if (!body.action) return c.json({ error: "action is required" }, 400);

	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO triggers (id, name, description, type, config, action, enabled, last_fired_at, fire_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 0, $8, $9)`,
		[
			id,
			body.name.trim(),
			body.description?.trim() ?? "",
			body.type,
			JSON.stringify(body.config),
			JSON.stringify(body.action),
			body.enabled !== false ? 1 : 0,
			now,
			now,
		],
	);

	const row = await queryOne<TriggerRow>("SELECT * FROM triggers WHERE id = $1", [id]);
	if (!row) throw new Error("Failed to create trigger");
	return c.json(parseTriggerRow(row), 201);
});

// GET /api/observability/triggers/:id
triggersRoutes.get("/triggers/:id", async (c) => {
	const row = await queryOne<TriggerRow>("SELECT * FROM triggers WHERE id = $1", [c.req.param("id")]);
	if (!row) return c.json({ error: "Not found" }, 404);

	const recentLogs = await query<TriggerLogRow>(
		"SELECT * FROM trigger_logs WHERE trigger_id = $1 ORDER BY fired_at DESC LIMIT 10",
		[row.id],
	);

	return c.json({
		...parseTriggerRow(row),
		recentLogs: recentLogs.map(parseTriggerLogRow),
	});
});

// PUT /api/observability/triggers/:id
triggersRoutes.put("/triggers/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<{ id: string }>("SELECT id FROM triggers WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const body = (await c.req.json()) as {
		name?: string;
		description?: string;
		type?: string;
		config?: Record<string, unknown>;
		action?: Record<string, unknown>;
		enabled?: boolean;
	};

	const now = new Date().toISOString();
	const setClauses: string[] = [];
	const params: unknown[] = [];

	if (body.name !== undefined) {
		setClauses.push(`name = $${params.length + 1}`);
		params.push(body.name.trim());
	}
	if (body.description !== undefined) {
		setClauses.push(`description = $${params.length + 1}`);
		params.push(body.description.trim());
	}
	if (body.type !== undefined) {
		setClauses.push(`type = $${params.length + 1}`);
		params.push(body.type);
	}
	if (body.config !== undefined) {
		setClauses.push(`config = $${params.length + 1}`);
		params.push(JSON.stringify(body.config));
	}
	if (body.action !== undefined) {
		setClauses.push(`action = $${params.length + 1}`);
		params.push(JSON.stringify(body.action));
	}
	if (body.enabled !== undefined) {
		setClauses.push(`enabled = $${params.length + 1}`);
		params.push(body.enabled ? 1 : 0);
	}

	setClauses.push(`updated_at = $${params.length + 1}`);
	params.push(now);
	params.push(id); // WHERE id = $N

	await execute(`UPDATE triggers SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);

	const row = await queryOne<TriggerRow>("SELECT * FROM triggers WHERE id = $1", [id]);
	if (!row) throw new Error("Failed to update trigger");
	return c.json(parseTriggerRow(row));
});

// DELETE /api/observability/triggers/:id
triggersRoutes.delete("/triggers/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<{ id: string }>("SELECT id FROM triggers WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	await execute("DELETE FROM trigger_logs WHERE trigger_id = $1", [id]);
	await execute("DELETE FROM triggers WHERE id = $1", [id]);
	return c.json({ success: true });
});

// PUT /api/observability/triggers/:id/toggle
triggersRoutes.put("/triggers/:id/toggle", async (c) => {
	const id = c.req.param("id");
	const row = await queryOne<{ id: string; enabled: number }>("SELECT id, enabled FROM triggers WHERE id = $1", [id]);
	if (!row) return c.json({ error: "Not found" }, 404);

	const newEnabled = row.enabled === 1 ? 0 : 1;
	const now = new Date().toISOString();
	await execute("UPDATE triggers SET enabled = $1, updated_at = $2 WHERE id = $3", [newEnabled, now, id]);

	const updated = await queryOne<TriggerRow>("SELECT * FROM triggers WHERE id = $1", [id]);
	if (!updated) throw new Error("Failed to toggle trigger");
	return c.json(parseTriggerRow(updated));
});

// POST /api/observability/triggers/:id/test
triggersRoutes.post("/triggers/:id/test", async (c) => {
	const id = c.req.param("id");
	const trigger = await queryOne<TriggerRow>("SELECT * FROM triggers WHERE id = $1", [id]);
	if (!trigger) return c.json({ error: "Not found" }, 404);

	const logId = crypto.randomUUID();
	const now = new Date().toISOString();
	const durationMs = Math.floor(Math.random() * 50) + 10;

	await execute(
		`INSERT INTO trigger_logs (id, trigger_id, status, input, output, duration_ms, fired_at)
     VALUES ($1, $2, 'success', $3, $4, $5, $6)`,
		[
			logId,
			id,
			JSON.stringify({ source: "manual_test" }),
			JSON.stringify({ result: "Test fired successfully" }),
			durationMs,
			now,
		],
	);

	await execute("UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = $1, updated_at = $2 WHERE id = $3", [
		now,
		now,
		id,
	]);

	const logRow = await queryOne<TriggerLogRow>("SELECT * FROM trigger_logs WHERE id = $1", [logId]);
	if (!logRow) throw new Error("Failed to create trigger log");
	return c.json({ success: true, log: parseTriggerLogRow(logRow) });
});

// GET /api/observability/triggers/:id/logs
triggersRoutes.get("/triggers/:id/logs", async (c) => {
	const id = c.req.param("id");
	const triggerExists = await queryOne<{ id: string }>("SELECT id FROM triggers WHERE id = $1", [id]);
	if (!triggerExists) return c.json({ error: "Not found" }, 404);

	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const status = c.req.query("status");

	const params: unknown[] = [id];
	const conditions = ["trigger_id = $1"];

	if (status) {
		conditions.push(`status = $${params.length + 1}`);
		params.push(status);
	}

	const where = `WHERE ${conditions.join(" AND ")}`;

	const [countRow] = await query<{ n: string }>(`SELECT COUNT(*) as n FROM trigger_logs ${where}`, params);
	const total = Number(countRow?.n ?? 0);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rows = await query<TriggerLogRow>(
		`SELECT * FROM trigger_logs ${where} ORDER BY fired_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	return c.json({ logs: rows.map(parseTriggerLogRow), total, limit, offset });
});
