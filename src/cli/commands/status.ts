// ---------------------------------------------------------------------------
// oscorpex status <projectId> — Show project info + task table
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { type ApiClientOptions, apiGet, formatApiError } from "../api-client.js";
import { bold, colorStatus, cyan, dim, gray, green, red, yellow } from "../colors.js";

interface ProjectInfo {
	id: string;
	name: string;
	status: string;
	description?: string;
	createdAt?: string;
	updatedAt?: string;
}

interface Task {
	id: string;
	title: string;
	status: string;
	assignedAgent?: string;
	phase?: number | string;
	complexity?: string;
}

interface TasksResponse {
	tasks?: Task[];
	data?: Task[];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape strip
// biome-ignore lint/complexity/useRegexLiterals: RegExp constructor required to avoid control char lint
const ANSI_RE = new RegExp("\x1b\\[[0-9;]*m", "g");

function padEnd(str: string, len: number): string {
	// Strip ANSI codes when measuring length
	const stripped = str.replace(ANSI_RE, "");
	const pad = Math.max(0, len - stripped.length);
	return str + " ".repeat(pad);
}

function truncate(str: string, max: number): string {
	if (!str) return "";
	return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function formatDate(iso?: string): string {
	if (!iso) return gray("—");
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

function renderTaskTable(tasks: Task[]): void {
	if (tasks.length === 0) {
		console.log(gray("  No tasks found."));
		return;
	}

	const COL_ID = 10;
	const COL_TITLE = 40;
	const COL_AGENT = 18;
	const COL_PHASE = 7;
	const COL_STATUS = 14;

	const header = [
		padEnd(bold("ID"), COL_ID + 8), // bold adds ANSI chars
		padEnd(bold("Title"), COL_TITLE + 8),
		padEnd(bold("Agent"), COL_AGENT + 8),
		padEnd(bold("Phase"), COL_PHASE + 8),
		bold("Status"),
	].join("  ");

	const separator = dim("─".repeat(COL_ID + COL_TITLE + COL_AGENT + COL_PHASE + COL_STATUS + 10));

	console.log(separator);
	console.log(header);
	console.log(separator);

	for (const task of tasks) {
		const id = padEnd(gray(truncate(task.id, COL_ID)), COL_ID + 8);
		const title = padEnd(truncate(task.title ?? "", COL_TITLE), COL_TITLE);
		const agent = padEnd(gray(truncate(task.assignedAgent ?? "—", COL_AGENT)), COL_AGENT + 8);
		const phase = padEnd(String(task.phase ?? "—"), COL_PHASE);
		const status = colorStatus(task.status ?? "unknown");
		console.log(`${id}  ${title}  ${agent}  ${phase}  ${status}`);
	}

	console.log(separator);
}

export function registerStatus(program: Command): void {
	program
		.command("status <projectId>")
		.description("Show project info and task statuses")
		.option("--tasks-only", "Show only the task table")
		.action(async (projectId: string, cmdOpts: { tasksOnly?: boolean }) => {
			const opts = program.opts<{ apiUrl: string; apiKey?: string }>();
			const clientOpts: ApiClientOptions = { apiUrl: opts.apiUrl, apiKey: opts.apiKey };

			// Fetch project info
			if (!cmdOpts.tasksOnly) {
				try {
					const project = await apiGet<ProjectInfo>(`/projects/${projectId}`, clientOpts);

					console.log(`\n${bold("Project Information")}`);
					console.log(`  ${bold("ID:")}          ${cyan(project.id)}`);
					console.log(`  ${bold("Name:")}        ${project.name}`);
					console.log(`  ${bold("Status:")}      ${colorStatus(project.status)}`);
					if (project.description) {
						console.log(`  ${bold("Description:")} ${project.description}`);
					}
					console.log(`  ${bold("Created:")}     ${formatDate(project.createdAt)}`);
					console.log(`  ${bold("Updated:")}     ${formatDate(project.updatedAt)}`);
				} catch (err) {
					console.error(red(`\nFailed to fetch project: ${formatApiError(err)}`));
					process.exitCode = 1;
					return;
				}
			}

			// Fetch tasks
			console.log(`\n${bold("Tasks")}`);
			try {
				const raw = await apiGet<TasksResponse | Task[]>(`/projects/${projectId}/tasks`, clientOpts);
				// Handle both {tasks:[]} and [] response shapes
				const tasks = Array.isArray(raw) ? raw : ((raw as TasksResponse).tasks ?? (raw as TasksResponse).data ?? []);
				renderTaskTable(tasks);
			} catch (err) {
				console.error(red(`\nFailed to fetch tasks: ${formatApiError(err)}`));
				process.exitCode = 1;
				return;
			}

			console.log();
		});
}
