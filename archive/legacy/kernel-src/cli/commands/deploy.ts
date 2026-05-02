// ---------------------------------------------------------------------------
// oscorpex deploy <projectId> — Start the generated app and show its URL
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { type ApiClientOptions, apiGet, apiPost, formatApiError } from "../api-client.js";
import { bold, colorStatus, cyan, green, red, yellow } from "../colors.js";

interface AppStartResponse {
	success?: boolean;
	url?: string;
	port?: number;
	message?: string;
}

interface AppStatusResponse {
	running?: boolean;
	status?: string;
	url?: string;
	port?: number;
	previewUrl?: string;
	pid?: number;
}

export function registerDeploy(program: Command): void {
	program
		.command("deploy <projectId>")
		.description("Start the generated application for a project")
		.option("--status-only", "Only show current app status, do not start")
		.action(async (projectId: string, cmdOpts: { statusOnly?: boolean }) => {
			const opts = program.opts<{ apiUrl: string; apiKey?: string }>();
			const clientOpts: ApiClientOptions = { apiUrl: opts.apiUrl, apiKey: opts.apiKey };

			if (!cmdOpts.statusOnly) {
				console.log(`\nStarting application for project ${cyan(projectId)}…`);

				try {
					const result = await apiPost<AppStartResponse>(`/projects/${projectId}/app/start`, {}, clientOpts);

					if (result.url) {
						console.log(`${green("Application started!")}`);
						console.log(`  ${bold("URL:")} ${cyan(result.url)}`);
					} else if (result.port) {
						console.log(`${green("Application started!")}`);
						console.log(`  ${bold("Port:")} ${result.port}`);
					} else {
						console.log(green(result.message ?? "Application start request accepted."));
					}
				} catch (err) {
					console.error(red(`\nFailed to start application: ${formatApiError(err)}`));
					process.exitCode = 1;
					return;
				}
			}

			// Always show current status
			console.log(`\n${bold("Application Status")}`);
			try {
				const status = await apiGet<AppStatusResponse>(`/projects/${projectId}/app/status`, clientOpts);

				const running = status.running ?? status.status === "running";
				console.log(`  ${bold("Running:")} ${running ? green("yes") : red("no")}`);

				if (status.status) {
					console.log(`  ${bold("Status:")}  ${colorStatus(status.status)}`);
				}
				if (status.url) {
					console.log(`  ${bold("URL:")}     ${cyan(status.url)}`);
				}
				if (status.previewUrl) {
					console.log(`  ${bold("Preview:")} ${cyan(status.previewUrl)}`);
				}
				if (status.port) {
					console.log(`  ${bold("Port:")}    ${status.port}`);
				}
				if (status.pid) {
					console.log(`  ${bold("PID:")}     ${status.pid}`);
				}

				if (!running) {
					console.log(yellow(`\nApp is not running. Use ${cyan(`oscorpex deploy ${projectId}`)} to start it.`));
				}
			} catch (err) {
				console.error(red(`\nFailed to fetch app status: ${formatApiError(err)}`));
				process.exitCode = 1;
				return;
			}

			console.log();
		});
}
