// ---------------------------------------------------------------------------
// oscorpex init — Interactive project creation
// ---------------------------------------------------------------------------

import * as readline from "node:readline";
import type { Command } from "commander";
import { type ApiClientOptions, apiPost, formatApiError } from "../api-client.js";
import { bold, cyan, green, red } from "../colors.js";

interface ProjectPayload {
	name: string;
	description: string;
	techStack: string;
}

interface ProjectResponse {
	id: string;
	name: string;
	status: string;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(question, (answer) => resolve(answer.trim()));
	});
}

async function gatherInput(): Promise<ProjectPayload> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		console.log(`\n${bold("Oscorpex — New Project Setup")}\n`);

		const name = await prompt(rl, `${cyan("?")} Project name: `);
		if (!name) {
			throw new Error("Project name is required.");
		}

		const description = await prompt(rl, `${cyan("?")} Description: `);
		if (!description) {
			throw new Error("Project description is required.");
		}

		const techStack = await prompt(rl, `${cyan("?")} Tech stack (e.g. React, Node, PostgreSQL): `);

		return { name, description, techStack };
	} finally {
		rl.close();
	}
}

export function registerInit(program: Command): void {
	program
		.command("init")
		.description("Create a new Oscorpex project interactively")
		.action(async () => {
			const opts = program.opts<{ apiUrl: string; apiKey?: string }>();
			const clientOpts: ApiClientOptions = { apiUrl: opts.apiUrl, apiKey: opts.apiKey };

			let payload: ProjectPayload;
			try {
				payload = await gatherInput();
			} catch (err) {
				console.error(red(`\nInput error: ${formatApiError(err)}`));
				process.exitCode = 1;
				return;
			}

			console.log(`\nCreating project "${payload.name}"…`);

			try {
				const project = await apiPost<ProjectResponse>(
					"/projects",
					{
						name: payload.name,
						description: payload.description,
						techStack: payload.techStack || undefined,
					},
					clientOpts,
				);

				console.log(`\n${green("Project created successfully!")}`);
				console.log(`  ${bold("ID:")}     ${project.id}`);
				console.log(`  ${bold("Name:")}   ${project.name}`);
				console.log(`  ${bold("Status:")} ${project.status}`);
				console.log(`\nRun ${cyan(`oscorpex start ${project.id}`)} to begin execution.\n`);
			} catch (err) {
				console.error(red(`\nFailed to create project: ${formatApiError(err)}`));
				process.exitCode = 1;
			}
		});
}
