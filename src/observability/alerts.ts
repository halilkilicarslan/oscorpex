// ---------------------------------------------------------------------------
// Observability — Alert Rules + Alert History
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { execute, query, queryOne } from "../studio/pg.js";
import { safeParseJSON } from "./_shared.js";

interface AlertRule {
	id: string;
	name: string;
	description: string;
	type: string;
	condition: string;
	channels: string;
	enabled: number;
	cooldown_minutes: number;
	last_triggered_at: string | null;
	created_at: string;
	updated_at: string;
}

interface AlertHistoryRow {
	id: string;
	rule_id: string;
	status: string;
	message: string;
	context: string | null;
	triggered_at: string;
	resolved_at: string | null;
	acknowledged_at: string | null;
	acknowledged_by: string | null;
}

function formatAlertRule(r: AlertRule) {
	return {
		...r,
		enabled: Boolean(r.enabled),
		condition: safeParseJSON(r.condition),
		channels: safeParseJSON(r.channels),
	};
}

function formatAlertHistory(h: AlertHistoryRow) {
	return {
		...h,
		context: h.context ? safeParseJSON(h.context) : null,
	};
}

export const alertsRoutes = new Hono();

// GET /api/observability/alerts
alertsRoutes.get("/alerts", async (c) => {
	const rows = await query<AlertRule>("SELECT * FROM alert_rules ORDER BY created_at DESC");
	return c.json({ rules: rows.map(formatAlertRule) });
});

// GET /api/observability/alerts/stats — MUST be before /alerts/:id
alertsRoutes.get("/alerts/stats", async (c) => {
	const [totalRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM alert_rules");
	const totalRules = Number(totalRow?.n ?? 0);

	const [activeRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM alert_rules WHERE enabled = 1");
	const activeRules = Number(activeRow?.n ?? 0);

	const [totalAlertsRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM alert_history");
	const totalAlerts = Number(totalAlertsRow?.n ?? 0);

	const [unresolvedRow] = await query<{ n: string }>(
		"SELECT COUNT(*) as n FROM alert_history WHERE status = 'triggered'",
	);
	const unresolvedAlerts = Number(unresolvedRow?.n ?? 0);

	const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const [recentRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM alert_history WHERE triggered_at >= $1", [
		since24h,
	]);
	const recentAlerts = Number(recentRow?.n ?? 0);

	return c.json({
		totalRules,
		activeRules,
		totalAlerts,
		unresolvedAlerts,
		recentAlerts,
	});
});

// GET /api/observability/alerts/history — MUST be before /alerts/:id
alertsRoutes.get("/alerts/history", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const ruleId = c.req.query("rule_id");
	const status = c.req.query("status");

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (ruleId) {
		conditions.push(`rule_id = $${params.length + 1}`);
		params.push(ruleId);
	}
	if (status) {
		conditions.push(`status = $${params.length + 1}`);
		params.push(status);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const [countRow] = await query<{ n: string }>(`SELECT COUNT(*) as n FROM alert_history ${where}`, params);
	const total = Number(countRow?.n ?? 0);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rows = await query<AlertHistoryRow>(
		`SELECT * FROM alert_history ${where} ORDER BY triggered_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	const allRules = await query<{ id: string; name: string }>("SELECT id, name FROM alert_rules");
	const ruleNames: Record<string, string> = {};
	for (const r of allRules) ruleNames[r.id] = r.name;

	return c.json({
		history: rows.map((h) => ({
			...formatAlertHistory(h),
			rule_name: ruleNames[h.rule_id] ?? null,
		})),
		total,
	});
});

// PUT /api/observability/alerts/history/:id/acknowledge
alertsRoutes.put("/alerts/history/:id/acknowledge", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<AlertHistoryRow>("SELECT * FROM alert_history WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const body = (await c.req.json().catch(() => ({}))) as {
		acknowledged_by?: string;
	};
	const now = new Date().toISOString();

	await execute(
		"UPDATE alert_history SET status = 'acknowledged', acknowledged_at = $1, acknowledged_by = $2 WHERE id = $3",
		[now, body.acknowledged_by ?? "user", id],
	);

	const updated = await queryOne<AlertHistoryRow>("SELECT * FROM alert_history WHERE id = $1", [id]);
	if (!updated) throw new Error("Failed to update alert history");
	return c.json({ history: formatAlertHistory(updated) });
});

// POST /api/observability/alerts
alertsRoutes.post("/alerts", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		description?: string;
		type: string;
		condition: unknown;
		channels?: unknown[];
		enabled?: boolean;
		cooldown_minutes?: number;
	};

	if (!body.name || !body.type || !body.condition) {
		return c.json({ error: "name, type ve condition zorunludur" }, 400);
	}

	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO alert_rules (id, name, description, type, condition, channels, enabled, cooldown_minutes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			id,
			body.name,
			body.description ?? "",
			body.type,
			JSON.stringify(body.condition),
			JSON.stringify(body.channels ?? []),
			body.enabled !== false ? 1 : 0,
			body.cooldown_minutes ?? 15,
			now,
			now,
		],
	);

	const rule = await queryOne<AlertRule>("SELECT * FROM alert_rules WHERE id = $1", [id]);
	if (!rule) throw new Error("Failed to create alert rule");
	return c.json({ rule: formatAlertRule(rule) }, 201);
});

// PUT /api/observability/alerts/:id/toggle
alertsRoutes.put("/alerts/:id/toggle", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<AlertRule>("SELECT * FROM alert_rules WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const newEnabled = existing.enabled === 1 ? 0 : 1;
	await execute("UPDATE alert_rules SET enabled = $1, updated_at = $2 WHERE id = $3", [
		newEnabled,
		new Date().toISOString(),
		id,
	]);

	const rule = await queryOne<AlertRule>("SELECT * FROM alert_rules WHERE id = $1", [id]);
	if (!rule) throw new Error("Failed to toggle alert rule");
	return c.json({ rule: formatAlertRule(rule) });
});

// PUT /api/observability/alerts/:id
alertsRoutes.put("/alerts/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<AlertRule>("SELECT * FROM alert_rules WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const body = (await c.req.json()) as Partial<{
		name: string;
		description: string;
		type: string;
		condition: unknown;
		channels: unknown[];
		enabled: boolean;
		cooldown_minutes: number;
	}>;

	const now = new Date().toISOString();

	await execute(
		`UPDATE alert_rules SET
      name = $1,
      description = $2,
      type = $3,
      condition = $4,
      channels = $5,
      enabled = $6,
      cooldown_minutes = $7,
      updated_at = $8
    WHERE id = $9`,
		[
			body.name ?? existing.name,
			body.description ?? existing.description,
			body.type ?? existing.type,
			body.condition !== undefined ? JSON.stringify(body.condition) : existing.condition,
			body.channels !== undefined ? JSON.stringify(body.channels) : existing.channels,
			body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
			body.cooldown_minutes ?? existing.cooldown_minutes,
			now,
			id,
		],
	);

	const rule = await queryOne<AlertRule>("SELECT * FROM alert_rules WHERE id = $1", [id]);
	if (!rule) throw new Error("Failed to update alert rule");
	return c.json({ rule: formatAlertRule(rule) });
});

// DELETE /api/observability/alerts/:id
alertsRoutes.delete("/alerts/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<{ id: string }>("SELECT id FROM alert_rules WHERE id = $1", [id]);
	if (!existing) return c.json({ error: "Not found" }, 404);

	// Cascade: delete history first
	await execute("DELETE FROM alert_history WHERE rule_id = $1", [id]);
	await execute("DELETE FROM alert_rules WHERE id = $1", [id]);
	return c.json({ success: true });
});
