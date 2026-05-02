// ---------------------------------------------------------------------------
// Observability — Studio Traces (tasks, pipeline_runs, agent_runs)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { query, queryOne } from "../studio/pg.js";
import { safeParseJSON } from "./_shared.js";

export const studioTracesRoutes = new Hono();

studioTracesRoutes.get("/studio/traces", async (c) => {
	try {
		const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
		const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
		const agent = c.req.query("agent");
		const status = c.req.query("status");

		// Pipeline runs as top-level traces
		const pipelineRuns = await query<{
			id: string;
			project_id: string;
			status: string;
			stages_json: string;
			started_at: string | null;
			completed_at: string | null;
			created_at: string;
		}>("SELECT * FROM pipeline_runs ORDER BY started_at DESC");

		// Task-level traces
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (agent) {
			conditions.push(`t.assigned_agent = $${params.length + 1}`);
			params.push(agent);
		}
		if (status) {
			conditions.push(`t.status = $${params.length + 1}`);
			params.push(status);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		const [totalRow] = await query<{ n: string }>(`SELECT COUNT(*) as n FROM tasks t ${where}`, params);

		const limitIdx = params.length + 1;
		const offsetIdx = params.length + 2;
		const tasks = await query<{
			id: string;
			title: string;
			description: string;
			assigned_agent: string;
			status: string;
			complexity: string;
			branch: string;
			output: string | null;
			error: string | null;
			task_type: string;
			started_at: string | null;
			completed_at: string | null;
			project_id: string;
			phase_id: string;
		}>(
			`SELECT t.*, pp.project_id FROM tasks t
     JOIN phases ph ON ph.id = t.phase_id
     JOIN project_plans pp ON pp.id = ph.plan_id
     ${where}
     ORDER BY t.started_at DESC NULLS LAST, t.completed_at DESC NULLS LAST, t.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
			[...params, limit, offset],
		);

		// Agent runs — each run is a sub-span
		const agentRuns = await query<{
			id: string;
			project_id: string;
			agent_id: string;
			cli_tool: string;
			status: string;
			task_prompt: string | null;
			output_summary: string | null;
			pid: number | null;
			exit_code: number | null;
			started_at: string | null;
			stopped_at: string | null;
			created_at: string;
		}>("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 200");

		// Unique agent names for filter dropdown
		const agentNames = await query<{ assigned_agent: string }>(
			"SELECT DISTINCT assigned_agent FROM tasks WHERE assigned_agent != '' ORDER BY assigned_agent",
		);

		// Format tasks as trace-like objects
		const studioTraces = tasks.map((t) => {
			const durationMs =
				t.started_at && t.completed_at ? new Date(t.completed_at).getTime() - new Date(t.started_at).getTime() : null;

			const traceStatus: "success" | "error" | "running" =
				t.status === "done"
					? "success"
					: t.status === "failed"
						? "error"
						: t.status === "in_progress" || t.status === "running"
							? "running"
							: "success";

			const relatedRuns = agentRuns.filter((r) => r.project_id === t.project_id && r.agent_id === t.assigned_agent);

			return {
				trace_id: t.id,
				entity_id: t.assigned_agent || "unassigned",
				entity_type: "studio-task",
				title: t.title,
				start_time: t.started_at ?? t.completed_at ?? new Date().toISOString(),
				end_time: t.completed_at,
				status: traceStatus,
				duration_ms: durationMs,
				complexity: t.complexity,
				task_type: t.task_type,
				branch: t.branch,
				output: t.output ? (t.output.length > 500 ? `${t.output.slice(0, 500)}...` : t.output) : null,
				error: t.error,
				span_count: 1 + relatedRuns.length,
				spans: relatedRuns.map((r) => ({
					span_id: r.id,
					name: r.cli_tool,
					status: r.status,
					start_time: r.started_at,
					end_time: r.stopped_at,
					duration_ms:
						r.started_at && r.stopped_at ? new Date(r.stopped_at).getTime() - new Date(r.started_at).getTime() : null,
					exit_code: r.exit_code,
					output_summary: r.output_summary,
				})),
			};
		});

		return c.json({
			traces: studioTraces,
			pipelines: pipelineRuns.map((p) => ({
				id: p.id,
				project_id: p.project_id,
				status: p.status,
				started_at: p.started_at,
				completed_at: p.completed_at,
				stages: safeParseJSON(p.stages_json),
			})),
			total: Number(totalRow?.n ?? 0),
			agents: agentNames.map((a) => a.assigned_agent),
			limit,
			offset,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg }, 500);
	}
});

// GET /api/observability/studio/traces/stats
studioTracesRoutes.get("/studio/traces/stats", async (c) => {
	const [totalRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM tasks");
	const totalTasks = Number(totalRow?.n ?? 0);

	const [doneRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'done'");
	const doneTasks = Number(doneRow?.n ?? 0);

	const [failedRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'failed'");
	const failedTasks = Number(failedRow?.n ?? 0);

	const [inProgressRow] = await query<{ n: string }>(
		"SELECT COUNT(*) as n FROM tasks WHERE status IN ('in_progress','running')",
	);
	const inProgress = Number(inProgressRow?.n ?? 0);

	// Avg duration of completed tasks
	const completedRows = await query<{
		started_at: string;
		completed_at: string;
	}>("SELECT started_at, completed_at FROM tasks WHERE started_at IS NOT NULL AND completed_at IS NOT NULL");

	let totalDuration = 0;
	for (const r of completedRows) {
		totalDuration += new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
	}
	const avgDurationMs = completedRows.length > 0 ? totalDuration / completedRows.length : null;

	const errorRate = totalTasks > 0 ? Math.round((failedTasks / totalTasks) * 1000) / 10 : 0;

	const topAgents = await query<{ name: string; count: string }>(
		"SELECT assigned_agent as name, COUNT(*) as count FROM tasks WHERE assigned_agent != '' GROUP BY assigned_agent ORDER BY count DESC LIMIT 10",
	);

	return c.json({
		totalTraces: totalTasks,
		avgDurationMs,
		errorRate,
		totalTokens: 0,
		doneTasks,
		failedTasks,
		inProgress,
		topAgents: topAgents.map((r) => ({ name: r.name, count: Number(r.count) })),
	});
});

// GET /api/observability/studio/traces/:taskId
studioTracesRoutes.get("/studio/traces/:taskId", async (c) => {
	const taskId = c.req.param("taskId");

	const task = await queryOne<{
		id: string;
		title: string;
		description: string;
		assigned_agent: string;
		status: string;
		complexity: string;
		branch: string;
		output: string | null;
		error: string | null;
		task_type: string;
		started_at: string | null;
		completed_at: string | null;
		project_id: string;
		phase_id: string;
	}>(
		"SELECT t.*, pp.project_id FROM tasks t JOIN phases ph ON ph.id = t.phase_id JOIN project_plans pp ON pp.id = ph.plan_id WHERE t.id = $1",
		[taskId],
	);

	if (!task) return c.json({ error: "Task not found" }, 404);

	const durationMs =
		task.started_at && task.completed_at
			? new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()
			: null;

	const traceStatus: "success" | "error" | "running" =
		task.status === "done"
			? "success"
			: task.status === "failed"
				? "error"
				: task.status === "in_progress" || task.status === "running"
					? "running"
					: "success";

	const agentRuns = await query<{
		id: string;
		cli_tool: string;
		status: string;
		task_prompt: string | null;
		output_summary: string | null;
		exit_code: number | null;
		started_at: string | null;
		stopped_at: string | null;
	}>("SELECT * FROM agent_runs WHERE project_id = $1 AND agent_id = $2 ORDER BY started_at ASC", [
		task.project_id,
		task.assigned_agent,
	]);

	return c.json({
		trace: {
			trace_id: task.id,
			entity_id: task.assigned_agent || "unassigned",
			entity_type: "studio-task",
			title: task.title,
			start_time: task.started_at ?? task.completed_at ?? new Date().toISOString(),
			end_time: task.completed_at,
			status: traceStatus,
			duration_ms: durationMs,
			span_count: 1 + agentRuns.length,
			total_tokens: null,
		},
		spans: [
			{
				span_id: task.id,
				trace_id: task.id,
				parent_span_id: null,
				entity_id: task.assigned_agent,
				name: task.title,
				start_time: task.started_at ?? task.completed_at ?? new Date().toISOString(),
				end_time: task.completed_at,
				duration_ms: durationMs,
				status_code: task.status === "failed" ? 2 : 0,
				status_message: task.error,
				span_type: "agent" as const,
				llm_model: null,
				tool_name: null,
				prompt_tokens: null,
				completion_tokens: null,
				total_tokens: null,
				input: task.description,
				output: task.output,
				attributes: {
					complexity: task.complexity,
					branch: task.branch,
					task_type: task.task_type,
				},
			},
			...agentRuns.map((r) => ({
				span_id: r.id,
				trace_id: task.id,
				parent_span_id: task.id,
				entity_id: task.assigned_agent,
				name: r.cli_tool,
				start_time: r.started_at ?? task.started_at ?? new Date().toISOString(),
				end_time: r.stopped_at,
				duration_ms:
					r.started_at && r.stopped_at ? new Date(r.stopped_at).getTime() - new Date(r.started_at).getTime() : null,
				status_code: r.exit_code !== null && r.exit_code !== 0 ? 2 : 0,
				status_message: r.exit_code !== null && r.exit_code !== 0 ? `Exit code: ${r.exit_code}` : null,
				span_type: "tool" as const,
				llm_model: null,
				tool_name: r.cli_tool,
				prompt_tokens: null,
				completion_tokens: null,
				total_tokens: null,
				input: r.task_prompt,
				output: r.output_summary,
				attributes: { exit_code: r.exit_code },
			})),
		],
	});
});
