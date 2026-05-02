// ---------------------------------------------------------------------------
// oscorpex start <projectId> — Trigger project execution pipeline
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { type ApiClientOptions, apiGet, apiPost, formatApiError } from "../api-client.js";
import { bold, colorStatus, cyan, green, red, yellow } from "../colors.js";

interface ExecutionStatus {
	status: string;
	phases?: number;
	tasksTotal?: number;
	tasksCompleted?: number;
}

interface ProjectInfo {
	id: string;
	name: string;
	status: string;
}

export function registerStart(program: Command): void {
	program
		.command("start <projectId>")
		.description("Start the execution pipeline for a project")
		.option("--no-status", "Skip showing pipeline status after starting")
		.action(async (projectId: string, cmdOpts: { status: boolean }) => {
			const opts = program.opts<{ apiUrl: string; apiKey?: string }>();
			const clientOpts: ApiClientOptions = { apiUrl: opts.apiUrl, apiKey: opts.apiKey };

			// Verify project exists first
			let project: ProjectInfo;
			try {
				project = await apiGet<ProjectInfo>(`/projects/${projectId}`, clientOpts);
			} catch (err) {
				console.error(red(`\nProject not found: ${formatApiError(err)}`));
				process.exitCode = 1;
				return;
			}

			console.log(`\nStarting execution for ${bold(project.name)} (${cyan(projectId)})…`);

			// Trigger execution
			try {
				await apiPost<unknown>(`/projects/${projectId}/execute`, {}, clientOpts);
				console.log(green("\nExecution started successfully!"));
			} catch (err) {
				console.error(red(`\nFailed to start execution: ${formatApiError(err)}`));
				process.exitCode = 1;
				return;
			}

			// Optionally show pipeline status
			if (cmdOpts.status !== false) {
				try {
					const status = await apiGet<ExecutionStatus>(`/projects/${projectId}/execution/status`, clientOpts);
					console.log(`\n${bold("Pipeline Status:")}`);
					console.log(`  Status:          ${colorStatus(status.status ?? "unknown")}`);
					if (status.phases !== undefined) {
						console.log(`  Phases:          ${status.phases}`);
					}
					if (status.tasksTotal !== undefined) {
						console.log(`  Tasks total:     ${status.tasksTotal}`);
					}
					if (status.tasksCompleted !== undefined) {
						console.log(`  Tasks completed: ${status.tasksCompleted}`);
					}
				} catch {
					// Non-fatal — status endpoint may not be ready yet
					console.log(yellow("\nPipeline status not yet available. Use `oscorpex status` to check later."));
				}
			}

			console.log(`\nRun ${cyan(`oscorpex status ${projectId}`)} to track progress.\n`);
		});
}
