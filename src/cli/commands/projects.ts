// ---------------------------------------------------------------------------
// oscorpex projects — List all projects in table format
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { type ApiClientOptions, apiGet, formatApiError } from "../api-client.js";
import { bold, colorStatus, cyan, dim, gray, red } from "../colors.js";

interface Project {
	id: string;
	name: string;
	status: string;
	createdAt?: string;
	created_at?: string;
}

interface ProjectsResponse {
	projects?: Project[];
	data?: Project[];
}

function formatDate(iso?: string): string {
	if (!iso) return "—";
	try {
		return new Date(iso).toLocaleDateString();
	} catch {
		return iso;
	}
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape strip
// biome-ignore lint/complexity/useRegexLiterals: RegExp constructor required to avoid control char lint
const ANSI_RE = new RegExp("\x1b\\[[0-9;]*m", "g");

function padEnd(str: string, len: number): string {
	const stripped = str.replace(ANSI_RE, "");
	const pad = Math.max(0, len - stripped.length);
	return str + " ".repeat(pad);
}

function truncate(str: string, max: number): string {
	if (!str) return "";
	return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function renderProjectsTable(projects: Project[]): void {
	if (projects.length === 0) {
		console.log(gray("  No projects found. Run `oscorpex init` to create one.\n"));
		return;
	}

	const COL_ID = 36;
	const COL_NAME = 32;
	const COL_STATUS = 14;
	const COL_CREATED = 12;

	const separator = dim("─".repeat(COL_ID + COL_NAME + COL_STATUS + COL_CREATED + 12));

	const header = [
		padEnd(bold("ID"), COL_ID + 8),
		padEnd(bold("Name"), COL_NAME + 8),
		padEnd(bold("Status"), COL_STATUS + 8),
		bold("Created"),
	].join("  ");

	console.log(`\n${bold("Projects")} ${gray(`(${projects.length} total)`)}`);
	console.log(separator);
	console.log(header);
	console.log(separator);

	for (const project of projects) {
		const createdAt = project.createdAt ?? project.created_at;
		const id = padEnd(cyan(truncate(project.id, COL_ID)), COL_ID + 8);
		const name = padEnd(truncate(project.name ?? "—", COL_NAME), COL_NAME);
		const status = padEnd(colorStatus(project.status ?? "unknown"), COL_STATUS + 8);
		const created = formatDate(createdAt);
		console.log(`${id}  ${name}  ${status}  ${created}`);
	}

	console.log(separator);
	console.log();
}

export function registerProjects(program: Command): void {
	program
		.command("projects")
		.description("List all projects")
		.option("--json", "Output raw JSON")
		.action(async (cmdOpts: { json?: boolean }) => {
			const opts = program.opts<{ apiUrl: string; apiKey?: string }>();
			const clientOpts: ApiClientOptions = { apiUrl: opts.apiUrl, apiKey: opts.apiKey };

			try {
				const raw = await apiGet<ProjectsResponse | Project[]>("/projects", clientOpts);

				// Handle both array and wrapped shapes
				const projects = Array.isArray(raw)
					? raw
					: ((raw as ProjectsResponse).projects ?? (raw as ProjectsResponse).data ?? []);

				if (cmdOpts.json) {
					console.log(JSON.stringify(projects, null, 2));
					return;
				}

				renderProjectsTable(projects);
			} catch (err) {
				console.error(red(`\nFailed to list projects: ${formatApiError(err)}`));
				process.exitCode = 1;
			}
		});
}
